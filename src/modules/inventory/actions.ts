'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import {
  parseQuantity,
  toBase,
  type BaseUnit,
  type PurchaseUnit,
} from '@/modules/purchasing/lines';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Stock counts and waste (ROADMAP Phase 5). Every write is an audited RPC that checks the caller's
 * branch and role in SQL; these actions only parse forms and convert units to base units. (Transfers
 * between branches keep their RPCs, but have no screen since ADR 0026.)
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const UNITS = ['kg', 'g', 'l', 'ml', 'pcs', 'dozen'] as const;
const refresh = (slug: string) => {
  revalidatePath(`/${slug}/stock`);
  revalidatePath(`/${slug}`);
};

async function ingredientBases(orgId: string): Promise<Map<string, BaseUnit>> {
  const supabase = await createClient();
  const { data } = await supabase.from('ingredients').select('id, base').eq('org_id', orgId);
  return new Map((data ?? []).map((i) => [i.id as string, i.base as BaseUnit]));
}

/** A typed quantity in a unit the ingredient accepts → base units; null if either does not fit. */
function qtyBase(text: string, unit: string, baseUnit: BaseUnit | undefined): number | null {
  const qty = parseQuantity(text);
  if (qty === null || !baseUnit || !(UNITS as readonly string[]).includes(unit)) return null;
  if (qty === 0) return 0;
  return toBase(qty, unit as PurchaseUnit, baseUnit);
}

// ---------------------------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------------------------
export async function startCountAction(formData: FormData): Promise<void> {
  const parsed = base
    .extend({ branchId: z.uuid(), kind: z.enum(['guided_weekly', 'full', 'spot']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('start_stock_count', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId,
    p_kind: parsed.data.kind,
  });
  if (error || !data) {
    console.error('start count', error?.code);
    return;
  }
  redirect(`/${parsed.data.orgSlug}/stock/count/${data as string}`);
}

/**
 * Saves every filled row (qty-<ingredient> + unit-<ingredient>); a cleared row removes its line. With
 * submit=1 the count is then submitted, which is final.
 */
export async function saveCountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base.extend({ countId: z.uuid() }).safeParse({
    orgId: formData.get('orgId'),
    orgSlug: formData.get('orgSlug'),
    countId: formData.get('countId'),
  });
  if (!parsed.success) return { error: 'invalidInput' };
  const bases = await ingredientBases(parsed.data.orgId);
  const supabase = await createClient();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('qty-')) continue;
    const ingredient = key.slice(4);
    const text = String(value).trim();
    const touched = formData.get(`touched-${ingredient}`) === '1';
    if (text === '' && !touched) continue;
    const qty =
      text === ''
        ? null
        : qtyBase(text, String(formData.get(`unit-${ingredient}`) ?? ''), bases.get(ingredient));
    if (text !== '' && qty === null) return { error: 'quantityInvalid' };
    const { error } = await supabase.rpc('save_count_line', {
      p_count: parsed.data.countId,
      p_ingredient: ingredient,
      p_qty: qty,
    });
    if (error) return { error: mapDbError(error) };
  }
  if (formData.get('submit') === '1') {
    const { error } = await supabase.rpc('submit_stock_count', { p_count: parsed.data.countId });
    if (error)
      return { error: error.message.includes('at least one') ? 'countEmpty' : mapDbError(error) };
    refresh(parsed.data.orgSlug);
    redirect(`/${parsed.data.orgSlug}/stock?counted=1`);
  }
  revalidatePath(`/${parsed.data.orgSlug}/stock/count/${parsed.data.countId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Waste
// ---------------------------------------------------------------------------------------------
export async function logWasteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      branchId: z.uuid(),
      target: z.string().regex(/^(ingredient|item):[0-9a-f-]{36}$/),
      qty: z.string().trim().min(1),
      unit: z.string(),
      reasonId: z.uuid(),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'wasteInvalid' };
  const [kind, id] = parsed.data.target.split(':') as ['ingredient' | 'item', string];
  let qty: number | null;
  if (kind === 'ingredient') {
    qty = qtyBase(
      parsed.data.qty,
      parsed.data.unit,
      (await ingredientBases(parsed.data.orgId)).get(id),
    );
  } else {
    qty = parseQuantity(parsed.data.qty);
  }
  if (!qty || qty <= 0) return { error: 'quantityInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('log_waste', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId,
    p_ingredient: kind === 'ingredient' ? id : null,
    p_menu_item: kind === 'item' ? id : null,
    p_qty: qty,
    p_reason: parsed.data.reasonId,
    p_note: parsed.data.note || null,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// The loss line (ADR 0027)
// ---------------------------------------------------------------------------------------------
/** The owner's loss line, typed as a percent (Bangla or Latin digits). org_settings RLS: owner only. */
export async function setLossLineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base.extend({ pct: z.string().trim().min(1) }).safeParse({
    orgId: formData.get('orgId'),
    orgSlug: formData.get('orgSlug'),
    pct: String(formData.get('pct') ?? '').replace('%', ''),
  });
  if (!parsed.success) return { error: 'lossLineInvalid' };
  const pct = parseQuantity(parsed.data.pct);
  if (pct === null || pct < 0.1 || pct > 20) return { error: 'lossLineInvalid' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_settings')
    .update({ loss_line_bps: Math.round(pct * 100) })
    .eq('org_id', parsed.data.orgId)
    .select('org_id');
  if (error) return { error: mapDbError(error) };
  if (!data || data.length === 0) return { error: 'notAllowed' };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}
