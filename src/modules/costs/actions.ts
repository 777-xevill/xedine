'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { parseTakaToPoisha } from '@/lib/money';
import { businessDate } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Setup for the flash P&L (ROADMAP Phase 2): the assumed food cost until recipes exist, fixed costs and
 * salaries. All money-gated tables (ADR 0007): RLS lets only the owner write them.
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

export async function setAssumedFoodCostAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({ pct: z.coerce.number().min(0).max(100) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.from('org_cost_settings').upsert({
    org_id: parsed.data.orgId,
    assumed_food_cost_bps: Math.round(parsed.data.pct * 100),
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

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
    effective_from: businessDate(now()),
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
  const today = businessDate(now());
  const { error } = await supabase
    .from('fixed_costs')
    .update({ effective_to: today })
    .eq('id', parsed.data.id)
    .eq('org_id', parsed.data.orgId);
  if (error) console.error('fixed cost end', error.code);
  refresh(parsed.data.orgSlug);
}

export async function setSalaryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      branchId: z.uuid(),
      staffId: z.uuid(),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      salary: taka,
      allowances: z.union([z.literal(''), taka]),
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
  const { error } = await supabase.from('salary_entries').upsert(
    {
      org_id: parsed.data.orgId,
      branch_id: parsed.data.branchId,
      staff_id: parsed.data.staffId,
      month: `${parsed.data.month}-01`,
      salary_poisha: parsed.data.salary,
      allowances_poisha: parsed.data.allowances === '' ? 0 : parsed.data.allowances,
    },
    { onConflict: 'org_id,staff_id,month' },
  );
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}
