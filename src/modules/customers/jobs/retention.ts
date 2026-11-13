import 'server-only';
import type { createServiceRoleClient } from '@/lib/db/service-role';
import { createTranslator } from 'next-intl';
import { publicEnv } from '@/lib/env';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { pushCampaign, pushToCustomers } from './push';

/**
 * Retention jobs (ROADMAP Phase 8), as the service role for one explicit org at a time:
 *  - post-meal feedback links for customers who consented (one per customer per week, SQL decides who);
 *  - campaigns the owner approved AND switched to run by themselves (auto_run; off by default, ADR 0021).
 * Customers hear from Xedine only as a notification on the phone where they allowed it (ADR 0052), never on
 * WhatsApp.
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
  if (rows.length === 0) return 0;
  const [{ data: customers }, { data: org }] = await Promise.all([
    sb
      .from('customers')
      .select('id, phone')
      .eq('org_id', orgId)
      .in(
        'phone',
        rows.map((r) => r.to_phone),
      ),
    sb.from('organizations').select('name').eq('id', orgId).maybeSingle(),
  ]);
  const idOf = new Map((customers ?? []).map((c) => [c.phone as string, c.id as string]));
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const title = (org?.name as string | undefined) ?? 'Xedine';
  await pushToCustomers(
    sb,
    orgId,
    rows.flatMap((r) => {
      const customerId = idOf.get(r.to_phone);
      if (!customerId) return [];
      const t = createTranslator({
        locale: r.lang === 'en' ? 'en' : 'bn',
        messages: r.lang === 'en' ? en : bn,
        namespace: 'customers',
      });
      return [
        {
          customerId,
          title,
          body: t('feedbackPush', { restaurant: title }),
          url: `${site}/f/${r.token}`,
          tag: `feedback-${r.feedback_id}`,
        },
      ];
    }),
  );
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
    // Also ring the phones of customers who asked for notifications (ADR 0048); a failure never undoes the run.
    await pushCampaign(sb, c.id as string, at).catch((e: unknown) =>
      console.error('campaign push', e instanceof Error ? e.message : 'failed'),
    );
  }
  return (campaigns ?? []).length;
}
