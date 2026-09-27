'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { aiErrorKey } from '@/lib/llm-gateway';
import { parseTakaToPoisha } from '@/lib/money';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';
import { extractPurchase, PURCHASE_EXTRACT_PROMPT } from './extraction';
import {
  parseQuantity,
  parseReferenceCsv,
  reviewLines,
  toBase,
  type BaseUnit,
  type IngredientRef,
  type PurchaseUnit,
} from './lines';

/**
 * Purchases (ROADMAP Phase 5). Recording, confirming and voiding are audited RPCs in SQL; only the
 * owner and the branch's purchaser may record (prices are money, ADR 0007). AI drafts are rows in
 * purchase_drafts that move nothing until a person confirms them.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const refresh = (slug: string) => {
  revalidatePath(`/${slug}/purchases`);
  revalidatePath(`/${slug}/stock`);
};
const UNITS = ['kg', 'g', 'l', 'ml', 'pcs', 'dozen'] as const;

async function ingredientBases(orgId: string): Promise<Map<string, BaseUnit>> {
  const supabase = await createClient();
  const { data } = await supabase.from('ingredients').select('id, base').eq('org_id', orgId);
  return new Map((data ?? []).map((i) => [i.id as string, i.base as BaseUnit]));
}

type PurchaseLine = { ingredient_id: string; qty_base: number; line_total_poisha: number };

/** Rows named line-<i>-ingredient / -qty / -unit / -total; blank rows are skipped, bad ones refused. */
function readPurchaseLines(
  formData: FormData,
  bases: Map<string, BaseUnit>,
): PurchaseLine[] | null {
  const lines: PurchaseLine[] = [];
  for (let i = 0; i < 40; i++) {
    const ingredient = String(formData.get(`line-${i}-ingredient`) ?? '');
    const qtyText = String(formData.get(`line-${i}-qty`) ?? '').trim();
    const totalText = String(formData.get(`line-${i}-total`) ?? '').trim();
    if (!ingredient && !qtyText && !totalText) continue;
    const unit = String(formData.get(`line-${i}-unit`) ?? '') as PurchaseUnit;
    const baseUnit = bases.get(ingredient);
    const qty = parseQuantity(qtyText);
    const total = parseTakaToPoisha(totalText);
    if (!baseUnit || qty === null || !(UNITS as readonly string[]).includes(unit)) return null;
    const qtyBase = toBase(qty, unit, baseUnit);
    if (qtyBase === null || total === null || total < 0) return null;
    lines.push({ ingredient_id: ingredient, qty_base: qtyBase, line_total_poisha: total });
  }
  return lines;
}

const purchaseFields = base.extend({
  branchId: z.uuid(),
  supplierId: z.union([z.uuid(), z.literal('')]),
  supplierName: z.string().trim().max(120).optional(),
  purchasedOn: z.string().regex(DATE),
});

export async function recordPurchaseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = purchaseFields.safeParse({
    orgId: formData.get('orgId'),
    orgSlug: formData.get('orgSlug'),
    branchId: formData.get('branchId'),
    supplierId: formData.get('supplierId') ?? '',
    supplierName: formData.get('supplierName') ?? undefined,
    purchasedOn: formData.get('purchasedOn'),
  });
  if (!parsed.success) return { error: 'invalidInput' };
  const lines = readPurchaseLines(formData, await ingredientBases(parsed.data.orgId));
  if (!lines || lines.length === 0) return { error: 'purchaseLinesInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('record_purchase', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId,
    p_supplier: parsed.data.supplierId || null,
    p_supplier_name: parsed.data.supplierName || null,
    p_purchased_on: parsed.data.purchasedOn,
    p_lines: lines,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** A photo of the chit, or the purchaser's words (typed or dictated) → a draft for review. */
export async function draftPurchaseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      branchId: z.uuid(),
      text: z.string().max(4000).optional(),
      spoken: z.string().optional(),
    })
    .safeParse({
      orgId: formData.get('orgId'),
      orgSlug: formData.get('orgSlug'),
      branchId: formData.get('branchId'),
      text: formData.get('text') ?? undefined,
      spoken: formData.get('spoken') ?? undefined,
    });
  if (!parsed.success) return { error: 'invalidInput' };
  const photo = formData.get('photo');
  let image: { mediaType: (typeof IMAGE_TYPES)[number]; base64: string } | undefined;
  if (photo instanceof File && photo.size > 0) {
    if (!(IMAGE_TYPES as readonly string[]).includes(photo.type) || photo.size > MAX_IMAGE_BYTES)
      return { error: 'photoInvalid' };
    image = {
      mediaType: photo.type as (typeof IMAGE_TYPES)[number],
      base64: Buffer.from(await photo.arrayBuffer()).toString('base64'),
    };
  }
  const text = parsed.data.text?.trim();
  if (!image && !text) return { error: 'purchaseInputRequired' };

  const supabase = await createClient();
  // Only a purchaser of this branch (or the owner) may spend the org's AI allowance on a purchase.
  const { data: canBuy } = await supabase.rpc('can_record_purchase', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId,
  });
  if (canBuy !== true) return { error: 'notAllowed' };
  const { data: ingredients } = await supabase
    .from('ingredients')
    .select('id, name, name_bn, base')
    .eq('org_id', parsed.data.orgId)
    .eq('is_active', true);
  let drafted;
  try {
    drafted = await extractPurchase({ orgId: parsed.data.orgId, text, image });
  } catch (e) {
    return { error: aiErrorKey(e) };
  }
  const review = reviewLines(drafted.extracted.lines, (ingredients ?? []) as IngredientRef[]);
  const { error } = await supabase.from('purchase_drafts').insert({
    org_id: parsed.data.orgId,
    branch_id: parsed.data.branchId,
    source: image ? 'photo' : parsed.data.spoken === '1' ? 'voice' : 'import',
    raw_text: text ?? null,
    extracted: {
      supplier: drafted.extracted.supplier,
      date: drafted.extracted.date,
      notes: drafted.extracted.notes,
      lines: review,
      model: drafted.model,
      prompt: { key: PURCHASE_EXTRACT_PROMPT.key, version: drafted.promptVersion },
    },
    confidence: {
      flagged: review.filter((l) => l.flags.length > 0).length,
      lines: review.length,
    },
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true, data: { count: String(review.length) } };
}

export async function confirmPurchaseDraftAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = purchaseFields.extend({ draftId: z.uuid() }).safeParse({
    orgId: formData.get('orgId'),
    orgSlug: formData.get('orgSlug'),
    branchId: formData.get('branchId'),
    supplierId: formData.get('supplierId') ?? '',
    supplierName: formData.get('supplierName') ?? undefined,
    purchasedOn: formData.get('purchasedOn'),
    draftId: formData.get('draftId'),
  });
  if (!parsed.success) return { error: 'invalidInput' };
  const lines = readPurchaseLines(formData, await ingredientBases(parsed.data.orgId));
  if (!lines || lines.length === 0) return { error: 'purchaseLinesInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('confirm_purchase_draft', {
    p_draft: parsed.data.draftId,
    p_supplier: parsed.data.supplierId || null,
    p_supplier_name: parsed.data.supplierName || null,
    p_purchased_on: parsed.data.purchasedOn,
    p_lines: lines,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function discardPurchaseDraftAction(formData: FormData): Promise<void> {
  const parsed = base.extend({ draftId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('discard_purchase_draft', { p_draft: parsed.data.draftId });
  if (error) console.error('purchase draft discard', error.code);
  refresh(parsed.data.orgSlug);
}

export async function voidPurchaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ purchaseId: z.uuid(), reason: z.string().trim().min(1).max(500) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'reasonRequired' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('void_purchase', {
    p_purchase: parsed.data.purchaseId,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function addSupplierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(20).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.from('suppliers').insert({
    org_id: parsed.data.orgId,
    name: parsed.data.name,
    phone: parsed.data.phone || null,
  });
  if (error) return { error: error.code === '23505' ? 'nameTaken' : mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

/** Market reference prices pasted as CSV → Price Watch's market line for lone branches (owner). */
export async function importReferencePricesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({ csv: z.string().max(100_000) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const { rows, bad } = parseReferenceCsv(parsed.data.csv);
  if (rows.length === 0) return { error: 'referenceCsvInvalid' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('import_reference_prices', {
    p_org: parsed.data.orgId,
    p_rows: rows,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  const r = (data ?? {}) as { imported?: number; skipped?: number };
  return {
    ok: true,
    data: { imported: String(r.imported ?? 0), skipped: String((r.skipped ?? 0) + bad.length) },
  };
}
