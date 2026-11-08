'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { parsePercentBps } from '@/modules/discounts/codes';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';
import { parseTakaInRange, parseWhole } from './member-card';

/**
 * Member card (ADR 0041): the owner's rules, hand changes to a customer's points, and a new card link.
 * The database decides who may: loyalty_settings is written by the owner only (RLS); adjust_points
 * and reset_member_card check the role themselves and write the audit log.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const refresh = (orgSlug: string) => revalidatePath(`/${orgSlug}/settings/member-card`);

export async function saveMemberRulesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .object({
      orgId: z.uuid(),
      orgSlug: z.string().regex(SLUG),
      isOn: z.literal('on').optional(),
      earnPoints: z.string().max(10),
      earnEvery: z.string().max(14),
      pointValue: z.string().max(10),
      minRedeem: z.string().max(10),
      discountOn: z.literal('on').optional(),
      discountPercent: z.string().max(10),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const d = parsed.data;
  const earnPoints = parseWhole(d.earnPoints, 1, 1000);
  const earnEvery = parseTakaInRange(d.earnEvery, 100, 10_000_000);
  const pointValue = parseTakaInRange(d.pointValue, 1, 100_000);
  const minRedeem = parseWhole(d.minRedeem, 1, 1_000_000);
  if (earnPoints === null || earnEvery === null) return { error: 'memberEarnRule' };
  if (pointValue === null) return { error: 'memberPointValue' };
  if (minRedeem === null) return { error: 'memberMinRedeem' };
  const discountBps = parsePercentBps(d.discountPercent);
  if (discountBps === null) return { error: 'discountPercent' };

  const supabase = await createClient();
  const { error } = await supabase.from('loyalty_settings').upsert({
    org_id: d.orgId,
    is_on: d.isOn === 'on',
    earn_points: earnPoints,
    earn_every_poisha: earnEvery,
    point_value_poisha: pointValue,
    min_redeem_points: minRedeem,
    discount_on: d.discountOn === 'on',
    discount_bps: discountBps,
  });
  if (error) return { error: mapDbError(error) };
  refresh(d.orgSlug);
  return { ok: true };
}

export async function adjustPointsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({
      orgId: z.uuid(),
      orgSlug: z.string().regex(SLUG),
      customerId: z.uuid(),
      direction: z.enum(['add', 'remove']),
      points: z.string().max(10),
      note: z.string().trim().max(200),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const d = parsed.data;
  const points = parseWhole(d.points, 1, 1_000_000);
  if (points === null) return { error: 'memberPoints' };
  if (d.note === '') return { error: 'memberReason' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('adjust_points', {
    p_org: d.orgId,
    p_customer: d.customerId,
    p_points: d.direction === 'add' ? points : -points,
    p_note: d.note,
  });
  if (error) {
    if (error.message?.includes('points_below_zero')) return { error: 'memberBelowZero' };
    return { error: mapDbError(error) };
  }
  refresh(d.orgSlug);
  return { ok: true };
}

export async function resetMemberCardAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG), customerId: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('reset_member_card', {
    p_org: parsed.data.orgId,
    p_customer: parsed.data.customerId,
  });
  if (error) console.error('member card reset', error.code);
  refresh(parsed.data.orgSlug);
}
