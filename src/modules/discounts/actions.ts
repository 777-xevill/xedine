'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';
import { normalizeCode, parseEndDate, parseMaxUses, parsePercentBps, CODE_PATTERN } from './codes';

/**
 * Discount codes (ADR 0038): the owner or a manager makes, turns off and deletes them. The database
 * decides who may (RLS on discount_codes: owner and manager); a cashier only ever uses one at the till.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const refresh = (orgSlug: string) => revalidatePath(`/${orgSlug}/discount-codes`);

export async function createDiscountCodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .object({
      orgId: z.uuid(),
      orgSlug: z.string().regex(SLUG),
      code: z.string().max(40),
      percent: z.string().max(10),
      maxUses: z.string().max(10),
      endsOn: z.string().max(10),
      note: z.string().trim().max(120),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const code = normalizeCode(parsed.data.code);
  if (!CODE_PATTERN.test(code)) return { error: 'discountCodeShape' };
  const percentBps = parsePercentBps(parsed.data.percent);
  if (percentBps === null) return { error: 'discountPercent' };
  const maxUses = parseMaxUses(parsed.data.maxUses);
  if (maxUses === 'bad') return { error: 'discountUses' };
  const endsOn = parseEndDate(parsed.data.endsOn);
  if (endsOn === 'bad') return { error: 'discountEnd' };

  const supabase = await createClient();
  const { error } = await supabase.from('discount_codes').insert({
    org_id: parsed.data.orgId,
    code,
    percent_bps: percentBps,
    max_uses: maxUses,
    ends_on: endsOn,
    note: parsed.data.note === '' ? null : parsed.data.note,
  });
  if (error) return { error: error.code === '23505' ? 'discountCodeTaken' : mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function toggleDiscountCodeAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ orgSlug: z.string().regex(SLUG), id: z.uuid(), active: z.enum(['true', 'false']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('discount_codes')
    .update({ is_active: parsed.data.active !== 'true' })
    .eq('id', parsed.data.id);
  if (error) console.error('discount code toggle', error.code);
  refresh(parsed.data.orgSlug);
}

export async function deleteDiscountCodeAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ orgSlug: z.string().regex(SLUG), id: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  // Bills that used the code keep their discount; they just lose the link to it (FK set null).
  const { error } = await supabase.from('discount_codes').delete().eq('id', parsed.data.id);
  if (error) console.error('discount code delete', error.code);
  refresh(parsed.data.orgSlug);
}
