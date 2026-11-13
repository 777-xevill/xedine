'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { now } from '@/lib/time/clock';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';
import { pushCampaignAfterRun } from './jobs/push';

/**
 * Campaigns (ROADMAP Phase 8). Sends go through run_campaign (consent, caps, holdout, push only). RLS
 * decides every write.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const refresh = (slug: string) => {
  revalidatePath(`/${slug}/campaigns`);
  revalidatePath(`/${slug}/customers`);
};

// ---------------------------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------------------------
export async function createCampaignAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      name: z.string().trim().min(1).max(120),
      kind: z.enum(['thank_you', 'second_visit', 'win_back', 'custom']),
      segment: z.enum(['all', 'new', 'returning', 'regular', 'at_risk', 'lost']).optional(),
      branchId: z.union([z.uuid(), z.literal('')]).optional(),
      holdoutPct: z.coerce.number().int().min(0).max(50),
      bodyBn: z.string().trim().max(900).optional(),
      bodyEn: z.string().trim().max(900).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success || (!parsed.data.bodyBn && !parsed.data.bodyEn))
    return { error: 'campaignInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.from('campaigns').insert({
    org_id: parsed.data.orgId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    holdout_pct: parsed.data.holdoutPct,
    audience: { segment: parsed.data.segment ?? 'all', branch_id: parsed.data.branchId || null },
    body_bn: parsed.data.bodyBn || null,
    body_en: parsed.data.bodyEn || null,
    template_key: 'campaign',
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function approveCampaignAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.extend({ campaignId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_campaign', { p_campaign: parsed.data.campaignId });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function runCampaignAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base.extend({ campaignId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const at = now();
  const { data, error } = await supabase.rpc('run_campaign', {
    p_campaign: parsed.data.campaignId,
    p_now: at.toISOString(),
  });
  if (error) return { error: mapDbError(error) };
  // The same offer also rings the phones of customers who asked for notifications (ADR 0048).
  await pushCampaignAfterRun(parsed.data.campaignId, at);
  refresh(parsed.data.orgSlug);
  const r = (data ?? {}) as Record<string, number>;
  return {
    ok: true,
    data: {
      queued: String(r.queued ?? 0),
      holdout: String(r.holdout ?? 0),
      noConsent: String(r.no_consent ?? 0),
      capped: String(r.capped ?? 0),
    },
  };
}

export async function setAutoRunAction(formData: FormData): Promise<void> {
  const parsed = base
    .extend({ campaignId: z.uuid(), autoRun: z.enum(['true', 'false']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('campaigns')
    .update({ auto_run: parsed.data.autoRun === 'true' })
    .eq('id', parsed.data.campaignId)
    .eq('org_id', parsed.data.orgId);
  if (error) console.error('campaign auto-run', error.code);
  refresh(parsed.data.orgSlug);
}
