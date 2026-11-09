'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/** Daily compliance checks (ADR 0043). The list is written under RLS; a record only by its SQL function. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const entries = (formData: FormData) => Object.fromEntries(formData);
const done = (slug: string): FormState => {
  revalidatePath(`/${slug}/daily-checks`);
  return { ok: true };
};

export async function recordCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      branchId: z.uuid(),
      checkId: z.uuid(),
      status: z.enum(['done', 'problem']),
      note: z.string().trim().max(500).optional(),
      date: z.union([z.string().regex(DATE), z.literal('')]).optional(),
    })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('record_compliance_check', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId,
    p_check: parsed.data.checkId,
    p_status: parsed.data.status,
    p_note: parsed.data.note || null,
    p_date: parsed.data.date || null,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/complaints`);
  return done(parsed.data.orgSlug);
}

export async function addCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      name: z.string().trim().min(1).max(120),
      category: z.enum(['hygiene', 'inspection', 'document']).default('hygiene'),
      frequency: z.enum(['daily', 'weekly', 'monthly']),
      needsNote: z.literal('on').optional(),
    })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.from('compliance_checks').insert({
    org_id: parsed.data.orgId,
    name: parsed.data.name,
    category: parsed.data.category,
    frequency: parsed.data.frequency,
    needs_note: parsed.data.needsNote === 'on',
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

export async function addStarterChecksAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_starter_compliance_checks', {
    p_org: parsed.data.orgId,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

/** Switched off rather than deleted, so old records keep their meaning. */
export async function setCheckActiveAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({ checkId: z.uuid(), active: z.enum(['true', 'false']) })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('compliance_checks')
    .update({ is_active: parsed.data.active === 'true' })
    .eq('org_id', parsed.data.orgId)
    .eq('id', parsed.data.checkId)
    .select('id');
  if (error) return { error: mapDbError(error) };
  if (!data || data.length === 0) return { error: 'notAllowed' };
  return done(parsed.data.orgSlug);
}
