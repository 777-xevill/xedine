'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { parseTakaToPoisha } from '@/lib/money';
import { businessDate } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import { normalizeBdPhone } from '@/lib/messaging/phone';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';
import { FEATURE_KEYS, parseFeatures } from '@/modules/tenancy/navigation';

/** Owner-only restaurant setup: receipt header, channels + commissions (money-gated), reason codes. */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v));
const refresh = (orgSlug: string) => revalidatePath(`/${orgSlug}/settings`);

export async function updateReceiptSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      legalName: text(160),
      bin: text(40),
      address: text(300),
      phone: text(40),
      footer: text(300),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.from('org_receipt_settings').upsert({
    org_id: parsed.data.orgId,
    legal_name: parsed.data.legalName,
    bin: parsed.data.bin,
    address: parsed.data.address,
    phone: parsed.data.phone,
    footer: parsed.data.footer,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function createBranchAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({ name: z.string().trim().min(1).max(80), area: text(80) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  // Owner-only by RLS. The owner's own "all branches" access covers the new branch at once.
  const { error } = await supabase.from('branches').insert({
    org_id: parsed.data.orgId,
    name: parsed.data.name,
    area: parsed.data.area,
  });
  if (error) return { error: error.code === '23505' ? 'nameTaken' : mapDbError(error) };
  // Every page's branch switcher reads the branch list.
  revalidatePath(`/${parsed.data.orgSlug}`, 'layout');
  return { ok: true };
}

const CHANNEL_KINDS = [
  'dine_in',
  'takeaway',
  'own_delivery',
  'foodpanda',
  'pathao_food',
  'custom',
] as const;

export async function createChannelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({ name: z.string().trim().min(1).max(60), kind: z.enum(CHANNEL_KINDS) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('channels')
    .insert({ org_id: parsed.data.orgId, name: parsed.data.name, kind: parsed.data.kind });
  if (error) return { error: error.code === '23505' ? 'nameTaken' : mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function toggleChannelActiveAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ orgSlug: z.string().regex(SLUG), id: z.uuid(), active: z.enum(['true', 'false']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('channels')
    .update({ is_active: parsed.data.active !== 'true' })
    .eq('id', parsed.data.id);
  if (error) console.error('channel toggle', error.code);
  refresh(parsed.data.orgSlug);
}

const percentToBps = (pct: number) => Math.round(pct * 100);

/** Commission terms from today (money-gated table, ADR 0007). A new row per change keeps history. */
export async function setChannelCommissionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      channelId: z.uuid(),
      commissionPct: z.coerce.number().min(0).max(100),
      fixedFee: z.string().max(20),
      packaging: z.string().max(20),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const money = (v: string) => (v.trim() === '' ? 0 : parseTakaToPoisha(v));
  const fixedFee = money(parsed.data.fixedFee);
  const packaging = money(parsed.data.packaging);
  if (fixedFee === null || fixedFee < 0 || packaging === null || packaging < 0) {
    return { error: 'invalidPrice' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('channel_commissions').upsert(
    {
      org_id: parsed.data.orgId,
      channel_id: parsed.data.channelId,
      commission_bps: percentToBps(parsed.data.commissionPct),
      fixed_fee_poisha: fixedFee,
      packaging_poisha: packaging,
      // Asia/Dhaka calendar date (cutoff 0): commission terms change at midnight, not at 04:00.
      effective_from: businessDate(now(), 0),
    },
    { onConflict: 'org_id,channel_id,effective_from' },
  );
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

const REASON_KINDS = ['void', 'discount', 'refund'] as const;

export async function createReasonCodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      kind: z.enum(REASON_KINDS),
      label: z.string().trim().min(1).max(80),
      labelBn: text(80),
      requiresApproval: z.enum(['on']).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const code = parsed.data.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  const supabase = await createClient();
  const { error } = await supabase.from('reason_codes').insert({
    org_id: parsed.data.orgId,
    kind: parsed.data.kind,
    code: code || `reason_${crypto.randomUUID().slice(0, 8)}`,
    label: parsed.data.label,
    label_bn: parsed.data.labelBn,
    requires_manager_approval: parsed.data.requiresApproval === 'on',
  });
  if (error) return { error: error.code === '23505' ? 'nameTaken' : mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function toggleReasonActiveAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ orgSlug: z.string().regex(SLUG), id: z.uuid(), active: z.enum(['true', 'false']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('reason_codes')
    .update({ is_active: parsed.data.active !== 'true' })
    .eq('id', parsed.data.id);
  if (error) console.error('reason toggle', error.code);
  refresh(parsed.data.orgSlug);
}

export async function deleteReasonCodeAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ orgSlug: z.string().regex(SLUG), id: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  // Past voids, discounts and refunds keep their rows; they just lose the reason label (FK set null).
  const { error } = await supabase.from('reason_codes').delete().eq('id', parsed.data.id);
  if (error) console.error('reason delete', error.code);
  refresh(parsed.data.orgSlug);
}

export async function ensureDefaultsAction(formData: FormData): Promise<void> {
  const parsed = base.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('ensure_org_defaults', { p_org: parsed.data.orgId });
  if (error) console.error('defaults', error.code);
  refresh(parsed.data.orgSlug);
  revalidatePath(`/${parsed.data.orgSlug}/branch`);
}

/**
 * The owner's WhatsApp for briefs and questions (ADR 0017). Opting in is explicit and revocable;
 * without it nothing is sent (CLAUDE.md #8).
 */
export async function setOwnerWhatsappAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      phone: z.string().trim().max(40),
      language: z.enum(['bn', 'en']),
      consent: z.literal('on').optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const phone = parsed.data.phone ? normalizeBdPhone(parsed.data.phone) : null;
  if (parsed.data.phone && !phone) return { error: 'phoneInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.from('org_profile').upsert({
    org_id: parsed.data.orgId,
    owner_whatsapp: phone,
    brief_language: parsed.data.language,
    owner_whatsapp_opt_in_at: phone && parsed.data.consent ? now().toISOString() : null,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

/**
 * Settings → Features (ADR 0024): switch an optional module's sidebar links on or off. Presentation
 * only — access is still decided by RLS and each page. Owner-only through org_settings' RLS: a
 * non-owner's update matches no row, which is reported as not allowed.
 */
export async function toggleFeatureAction(formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ feature: z.enum(FEATURE_KEYS), on: z.enum(['true', 'false']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const { orgId, orgSlug, feature, on } = parsed.data;
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from('org_settings')
    .select('enabled_features')
    .eq('org_id', orgId)
    .single();
  if (readError) return { error: mapDbError(readError) };
  const enabled = new Set(parseFeatures(current.enabled_features));
  if (on === 'true') enabled.add(feature);
  else enabled.delete(feature);
  const { data: updated, error } = await supabase
    .from('org_settings')
    .update({ enabled_features: FEATURE_KEYS.filter((k) => enabled.has(k)) })
    .eq('org_id', orgId)
    .select('org_id');
  if (error) return { error: mapDbError(error) };
  if (!updated?.length) return { error: 'notAllowed' };
  // The sidebar lives in the org layout, so refresh the whole org tree.
  revalidatePath(`/${orgSlug}`, 'layout');
  return { ok: true };
}
