'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Platform admin: set an org's plan, status and pilot discount (ROADMAP Phase 10, ADR 0023). The SQL
 * function refuses anyone who is not a platform admin and audits every change; this only validates input.
 */
export async function setSubscriptionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .object({
      orgId: z.uuid(),
      plan: z.enum(['starter', 'growth', 'chain']),
      status: z.enum(['trialing', 'active', 'past_due', 'canceled']),
      discountPct: z.coerce.number().min(0).max(100),
      periodEnd: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_subscription', {
    p_org: parsed.data.orgId,
    p_plan: parsed.data.plan,
    p_status: parsed.data.status,
    p_discount_bps: Math.round(parsed.data.discountPct * 100),
    p_period_end: parsed.data.periodEnd || null,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath('/admin');
  return { ok: true };
}

/**
 * Platform admin: approve or decline an owner's request for a new branch (ADR 0036). Approving creates the
 * branch and its default Kitchen station inside the SQL function, which refuses non-admins and audits it.
 */
export async function decideBranchRequestAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .object({
      requestId: z.uuid(),
      decision: z.enum(['approve', 'decline']),
      note: z.string().trim().max(300),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_decide_branch_request', {
    p_request: parsed.data.requestId,
    p_approve: parsed.data.decision === 'approve',
    p_note: parsed.data.note || undefined,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath('/admin');
  return { ok: true };
}
