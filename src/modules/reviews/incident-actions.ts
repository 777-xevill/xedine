'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/** Complaints and incidents (ADR 0043). Every write is an audited SQL function that checks the role. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SEVERITY = z.enum(['low', 'medium', 'high']);
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const incident = base.extend({ incidentId: z.uuid() });
const entries = (formData: FormData) => Object.fromEntries(formData);
const done = (slug: string): FormState => {
  revalidatePath(`/${slug}/complaints`);
  return { ok: true };
};

/** One form: Save keeps the case open, Resolve closes it (and is refused until the story is complete). */
export async function saveIncidentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = incident
    .extend({
      intent: z.enum(['save', 'resolve']),
      status: z.enum(['open', 'in_progress']),
      severity: SEVERITY,
      rootCause: z.string().trim().max(2000).optional(),
      customerResolution: z.string().trim().max(2000).optional(),
    })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const d = parsed.data;
  const supabase = await createClient();
  const { error: saveError } = await supabase.rpc('update_incident', {
    p_org: d.orgId,
    p_incident: d.incidentId,
    p_status: d.status,
    p_severity: d.severity,
    p_root_cause: d.rootCause || null,
    p_customer_resolution: d.customerResolution || null,
  });
  if (saveError) return { error: mapDbError(saveError) };
  if (d.intent === 'resolve') {
    const { error } = await supabase.rpc('resolve_incident', {
      p_org: d.orgId,
      p_incident: d.incidentId,
      p_root_cause: d.rootCause ?? '',
      p_customer_resolution: d.customerResolution ?? '',
    });
    if (error) return { error: mapDbError(error) };
  }
  return done(d.orgSlug);
}

export async function addIncidentActionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = incident
    .extend({
      kind: z.enum(['corrective', 'note']),
      body: z.string().trim().min(1).max(1000),
      dueOn: z.union([z.string().regex(DATE), z.literal('')]).optional(),
    })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'incidentNeedsActionText' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_incident_action', {
    p_org: parsed.data.orgId,
    p_incident: parsed.data.incidentId,
    p_kind: parsed.data.kind,
    p_body: parsed.data.body,
    p_due_on: parsed.data.dueOn || null,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

export async function completeIncidentActionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.extend({ actionId: z.uuid() }).safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('complete_incident_action', {
    p_org: parsed.data.orgId,
    p_action: parsed.data.actionId,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

export async function reopenIncidentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = incident
    .extend({ reason: z.string().trim().min(3).max(300) })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'incidentNeedsReason' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('reopen_incident', {
    p_org: parsed.data.orgId,
    p_incident: parsed.data.incidentId,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}
