import 'server-only';
import type { createServiceRoleClient } from '@/lib/db/service-role';
import { publicEnv } from '@/lib/env';
import { queueMessage } from '@/modules/messaging/jobs/outbox';

/**
 * Retention jobs (ROADMAP Phase 8), as the service role for one explicit org at a time:
 *  - post-meal feedback links for customers who consented (one per customer per week, SQL decides who);
 *  - campaigns the owner approved AND switched to run by themselves (auto_run; off by default, ADR 0021).
 * Nothing is sent from here: messages go to the outbox, which the WhatsApp transport drains.
 */
type Supabase = ReturnType<typeof createServiceRoleClient>;

export async function sendFeedbackRequests(sb: Supabase, orgId: string, at: Date): Promise<number> {
  const { data, error } = await sb.rpc('job_feedback_requests', {
    p_org: orgId,
    p_now: at.toISOString(),
  });
  if (error) throw error;
  const rows = (data ?? []) as {
    feedback_id: string;
    to_phone: string;
    token: string;
    lang: string;
  }[];
  for (const r of rows) {
    await queueMessage(sb, {
      orgId,
      toPhone: r.to_phone,
      templateKey: 'feedback_request',
      language: r.lang === 'en' ? 'en' : 'bn',
      body: `${publicEnv().NEXT_PUBLIC_SITE_URL}/f/${r.token}`,
      idempotencyKey: `feedback:${r.feedback_id}`,
    });
  }
  return rows.length;
}

export async function runAutoCampaigns(sb: Supabase, orgId: string, at: Date): Promise<number> {
  const { data: campaigns, error } = await sb
    .from('campaigns')
    .select('id')
    .eq('org_id', orgId)
    .eq('auto_run', true)
    .in('status', ['approved', 'running']);
  if (error) throw error;
  for (const c of campaigns ?? []) {
    const { error: runError } = await sb.rpc('run_campaign', {
      p_campaign: c.id,
      p_now: at.toISOString(),
    });
    if (runError) throw runError;
  }
  return (campaigns ?? []).length;
}
