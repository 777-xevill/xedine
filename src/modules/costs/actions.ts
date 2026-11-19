'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { parseTakaToPoisha } from '@/lib/money';
import { orgToday } from '@/modules/tenancy/context';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Setup for the flash P&L (ROADMAP Phase 2): fixed costs and salaries (the food cost comes from the dish ingredients
 * and the bazar prices, ADR 0037). All money-gated tables (ADR 0007): RLS lets only the owner write them.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const refresh = (slug: string) => {
  revalidatePath(`/${slug}/costs`);
  revalidatePath(`/${slug}`);
};
const taka = z.string().transform((v, ctx) => {
  const p = parseTakaToPoisha(v);
  if (p === null || p < 0) {
    ctx.addIssue({ code: 'custom', message: 'price' });
    return z.NEVER;
  }
  return p;
});

const FIXED_KINDS = ['rent', 'utilities', 'gas', 'fuel', 'internet', 'other'] as const;

export async function addFixedCostAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      branchId: z.union([z.uuid(), z.literal('')]),
      kind: z.enum(FIXED_KINDS),
      label: z.string().trim().max(120),
      monthly: taka,
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues.some((i) => i.path[0] === 'monthly')
        ? 'invalidPrice'
        : 'invalidInput',
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('fixed_costs').insert({
    org_id: parsed.data.orgId,
    branch_id: parsed.data.branchId || null,
    kind: parsed.data.kind,
    label: parsed.data.label || null,
    monthly_poisha: parsed.data.monthly,
    effective_from: await orgToday(parsed.data.orgId),
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

/** A fixed cost ends (moving out, cancelling a line) rather than disappearing from past days' P&L. */
export async function endFixedCostAction(formData: FormData): Promise<void> {
  const parsed = base.extend({ id: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const today = await orgToday(parsed.data.orgId);
  const { error } = await supabase
    .from('fixed_costs')
    .update({ effective_to: today })
    .eq('id', parsed.data.id)
    .eq('org_id', parsed.data.orgId);
  if (error) console.error('fixed cost end', error.code);
  refresh(parsed.data.orgSlug);
}

const METHODS = ['cash', 'bkash', 'nagad', 'bank', 'other'] as const;
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthStart = (month: string) => `${month}-01`;

/** Rent or a bill: a new amount starts today, so earlier days keep the old one (ADR 0060). */
export async function updateFixedCostAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      id: z.uuid(),
      kind: z.enum(FIXED_KINDS),
      label: z.string().trim().max(120),
      monthly: taka,
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues.some((i) => i.path[0] === 'monthly')
        ? 'invalidPrice'
        : 'invalidInput',
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_fixed_cost', {
    p_org: parsed.data.orgId,
    p_id: parsed.data.id,
    p_kind: parsed.data.kind,
    p_label: parsed.data.label,
    p_monthly: parsed.data.monthly,
    p_today: await orgToday(parsed.data.orgId),
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

/** One person's pay for a month: salary, extra pay and a private note. Keeps what was already paid. */
export async function setSalaryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      staffId: z.uuid(),
      month: MONTH,
      salary: taka,
      allowances: z.union([z.literal(''), taka]),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues.some((i) => i.path[0] === 'salary' || i.path[0] === 'allowances')
        ? 'invalidPrice'
        : 'invalidInput',
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_salary', {
    p_org: parsed.data.orgId,
    p_staff: parsed.data.staffId,
    p_month: monthStart(parsed.data.month),
    p_salary: parsed.data.salary,
    p_allowances: parsed.data.allowances === '' ? 0 : parsed.data.allowances,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { error: error.code === '23514' ? 'salaryBelowPaid' : mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

/**
 * Mark a person's pay paid: the whole amount (empty), or part of it. The day and the way (cash, bKash,
 * Nagad, bank) are kept, so the owner needs no paper.
 */
export async function markSalaryPaidAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      staffId: z.uuid(),
      month: MONTH,
      amount: z.union([z.literal(''), taka]),
      paidOn: DAY,
      method: z.enum(METHODS),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues.some((i) => i.path[0] === 'amount')
        ? 'invalidPrice'
        : 'invalidInput',
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_salary_paid', {
    p_org: parsed.data.orgId,
    p_staff: parsed.data.staffId,
    p_month: monthStart(parsed.data.month),
    p_amount: parsed.data.amount === '' ? null : parsed.data.amount,
    p_paid_on: parsed.data.paidOn,
    p_method: parsed.data.method,
  });
  if (error) return { error: error.code === '23514' ? 'salaryOverPaid' : mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

/** Undo a payment (back to not paid). */
export async function unmarkSalaryPaidAction(formData: FormData): Promise<void> {
  const parsed = base
    .extend({ staffId: z.uuid(), month: MONTH })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_salary_paid', {
    p_org: parsed.data.orgId,
    p_staff: parsed.data.staffId,
    p_month: monthStart(parsed.data.month),
    p_amount: 0,
    p_paid_on: null,
    p_method: null,
  });
  if (error) console.error('unmark salary paid', error.code);
  refresh(parsed.data.orgSlug);
}

/** Everyone still owed, paid in full on one day the same way. */
export async function markAllSalariesPaidAction(formData: FormData): Promise<void> {
  const parsed = base
    .extend({ month: MONTH, paidOn: DAY, method: z.enum(METHODS) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_salaries_paid', {
    p_org: parsed.data.orgId,
    p_month: monthStart(parsed.data.month),
    p_paid_on: parsed.data.paidOn,
    p_method: parsed.data.method,
  });
  if (error) console.error('mark all salaries paid', error.code);
  refresh(parsed.data.orgSlug);
}

/** Same pay as last month for everyone who has none this month. */
export async function copySalariesAction(formData: FormData): Promise<void> {
  const parsed = base.extend({ month: MONTH }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('copy_salaries_from_previous_month', {
    p_org: parsed.data.orgId,
    p_month: monthStart(parsed.data.month),
  });
  if (error) console.error('copy salaries', error.code);
  refresh(parsed.data.orgSlug);
}

/**
 * Food cost for dishes without ingredients (ADR 0066): until every dish has its ingredients, the flash P&L
 * counts this share of their sales as food cost. Never set, it was 0% and profit read as if food were free.
 * Owner only (RLS); the change is audited by the org_cost_settings trigger.
 */
export async function setAssumedFoodCostAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.extend({ pct: z.string().trim() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const latin = parsed.data.pct.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  if (!/^\d{1,3}(\.\d)?$/.test(latin) || Number(latin) > 100) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('org_cost_settings')
    .update({ assumed_food_cost_bps: Math.round(Number(latin) * 100) })
    .eq('org_id', parsed.data.orgId);
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}
