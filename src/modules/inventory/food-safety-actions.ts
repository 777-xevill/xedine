'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Food safety (ADR 0043). Every write goes through an audited SQL function that checks the caller's role;
 * these actions only validate the form.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const entries = (formData: FormData) => Object.fromEntries(formData);
const done = (slug: string): FormState => {
  revalidatePath(`/${slug}/food-safety`);
  return { ok: true };
};

export async function holdIngredientAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      branchId: z.uuid(),
      ingredientId: z.uuid(),
      reason: z.string().trim().min(3).max(300),
    })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'foodSafetyReasonNeeded' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('hold_ingredient', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId,
    p_ingredient: parsed.data.ingredientId,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

export async function releaseHoldAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ holdId: z.uuid(), note: z.string().trim().min(3).max(300) })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'foodSafetyReasonNeeded' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('release_ingredient_hold', {
    p_org: parsed.data.orgId,
    p_hold: parsed.data.holdId,
    p_note: parsed.data.note,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

export async function setLotExpiryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      lotKind: z.enum(['purchase', 'transfer']),
      lotId: z.uuid(),
      expiresOn: z.string().regex(DATE),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_lot_expiry', {
    p_org: parsed.data.orgId,
    p_kind: parsed.data.lotKind,
    p_lot: parsed.data.lotId,
    p_expires: parsed.data.expiresOn,
    p_note: parsed.data.note || null,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

/** "Thrown away": what is probably left of an out-of-date lot is written off as spoiled. */
export async function throwAwayLotAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ branchId: z.uuid(), ingredientId: z.uuid(), qty: z.coerce.number().positive() })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { data: reason, error: reasonError } = await supabase
    .from('reason_codes')
    .select('id')
    .eq('org_id', parsed.data.orgId)
    .eq('kind', 'waste')
    .eq('code', 'spoiled')
    .maybeSingle();
  if (reasonError) return { error: mapDbError(reasonError) };
  if (!reason) return { error: 'generic' };
  const { error } = await supabase.rpc('log_waste', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId,
    p_ingredient: parsed.data.ingredientId,
    p_menu_item: null,
    p_qty: parsed.data.qty,
    p_reason: reason.id,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/stock`);
  return done(parsed.data.orgSlug);
}

/** One form for the whole list: only the rows whose number changed are written. */
export async function saveShelfLivesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsedBase = base.safeParse({
    orgId: formData.get('orgId'),
    orgSlug: formData.get('orgSlug'),
  });
  if (!parsedBase.success) return { error: 'invalidInput' };
  const changes: { id: string; days: number | null }[] = [];
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith('days:') || typeof raw !== 'string') continue;
    const id = key.slice('days:'.length);
    if (!z.uuid().safeParse(id).success) return { error: 'invalidInput' };
    const value = raw.trim();
    if (value === String(formData.get(`was:${id}`) ?? '')) continue;
    const days = value === '' ? null : Number(value);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650))
      return { error: 'foodSafetyShelfLifeRange' };
    changes.push({ id, days });
  }
  const supabase = await createClient();
  for (const c of changes) {
    const { error } = await supabase.rpc('set_shelf_life', {
      p_org: parsedBase.data.orgId,
      p_ingredient: c.id,
      p_days: c.days,
    });
    if (error) return { error: mapDbError(error) };
  }
  return done(parsedBase.data.orgSlug);
}

export async function setBlockExpiredAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.extend({ block: z.enum(['on', 'off']) }).safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_settings')
    .update({ food_safety_block_expired: parsed.data.block === 'on' })
    .eq('org_id', parsed.data.orgId)
    .select('org_id');
  if (error) return { error: mapDbError(error) };
  if (!data || data.length === 0) return { error: 'notAllowed' };
  return done(parsed.data.orgSlug);
}
