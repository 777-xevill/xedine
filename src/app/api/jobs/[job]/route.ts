import { timingSafeEqual } from 'node:crypto';
import { after, NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { now } from '@/lib/time/clock';
import { addDays, businessDate, DEFAULT_CUTOFF_MINUTES, weekday } from '@/lib/time/business-date';
import { queueBrief } from '@/modules/briefs/jobs/briefs';
import { sendComplianceReminders } from '@/modules/compliance/jobs/reminders';
import { runAutoCampaigns, sendFeedbackRequests } from '@/modules/customers/jobs/retention';
import { runOutbox } from '@/modules/messaging/jobs/outbox';
import { runSocialTick } from '@/modules/social/jobs/autopilot';

/**
 * Scheduled-job entry point (ADR 0004). pg_cron calls this with a shared secret; the job is claimed in
 * job_runs so a double fire is a no-op, and its outcome is always recorded.
 *
 * close_business_day fans out per organization (ADR 0015 §6): each org's just-closed business day (its own
 * cutoff) gets its own claim, so one org failing never blocks the rest and a retry only redoes what failed.
 */
const KNOWN_JOBS = new Set([
  'refresh_today',
  'close_business_day',
  'morning_brief',
  'evening_close',
  'send_outbox',
  'feedback_requests',
  'benchmarks',
  'social_tick',
]);

// The social autopilot renders posters and reels in a headless browser: give it the plan's full 5 minutes.
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.JOB_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Supabase = ReturnType<typeof createServiceRoleClient>;

async function closeEveryOrg(supabase: Supabase, at: Date) {
  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, org_settings(default_cutoff_minutes)');
  if (error) throw error;
  const outcomes: { org: string; status: string }[] = [];
  for (const org of orgs ?? []) {
    // A one-to-one embed comes back as an object or a one-row array depending on how it is detected.
    const embedded = org.org_settings as unknown;
    const settings = (Array.isArray(embedded) ? embedded[0] : embedded) as {
      default_cutoff_minutes: number;
    } | null;
    const closed = addDays(
      businessDate(at, settings?.default_cutoff_minutes ?? DEFAULT_CUTOFF_MINUTES),
      -1,
    );
    const { data: runId } = await supabase.rpc('job_run_begin', {
      p_job: 'close_business_day',
      p_org: org.id,
      p_period: closed,
    });
    if (!runId) {
      outcomes.push({ org: org.id as string, status: 'already_ran' });
      continue;
    }
    const { error: runError } = await supabase.rpc('job_close_business_day', {
      p_org: org.id,
      p_date: closed,
    });
    await supabase.rpc('job_run_finish', {
      p_run: runId,
      p_status: runError ? 'failed' : 'succeeded',
      p_error: runError ? runError.message.slice(0, 500) : null,
    });
    outcomes.push({ org: org.id as string, status: runError ? 'failed' : 'ok' });
  }
  return outcomes;
}

/**
 * Morning (09:00 Dhaka): refresh each org's insights for today, then queue its brief — with the weekly
 * review on the org's first day of the week. Evening (23:00): the day's close. Per-org claims, as above.
 */
async function briefEveryOrg(supabase: Supabase, at: Date, kind: 'morning' | 'evening') {
  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, org_settings(default_cutoff_minutes, week_start)');
  if (error) throw error;
  const outcomes: { org: string; status: string }[] = [];
  for (const org of orgs ?? []) {
    const embedded = org.org_settings as unknown;
    const settings = (Array.isArray(embedded) ? embedded[0] : embedded) as {
      default_cutoff_minutes: number;
      week_start: number;
    } | null;
    const today = businessDate(at, settings?.default_cutoff_minutes ?? DEFAULT_CUTOFF_MINUTES);
    const job = kind === 'morning' ? 'morning_brief' : 'evening_close';
    const { data: runId } = await supabase.rpc('job_run_begin', {
      p_job: job,
      p_org: org.id,
      p_period: today,
    });
    if (!runId) {
      outcomes.push({ org: org.id as string, status: 'already_ran' });
      continue;
    }
    try {
      if (kind === 'morning') {
        await supabase.rpc('job_refresh_insights', { p_org: org.id, p_date: today });
        await queueBrief(supabase, org.id as string, 'morning', at);
        if (weekday(today) === (settings?.week_start ?? 6))
          await queueBrief(supabase, org.id as string, 'weekly', at);
        // Campaigns the owner approved to run by themselves (Phase 8; off unless switched on).
        await runAutoCampaigns(supabase, org.id as string, at);
        // Licence and VAT-return reminders to the owner (Phase 10; once per threshold).
        await sendComplianceReminders(supabase, org.id as string, at);
      } else {
        await queueBrief(supabase, org.id as string, 'evening', at);
      }
      await supabase.rpc('job_run_finish', { p_run: runId, p_status: 'succeeded', p_error: null });
      outcomes.push({ org: org.id as string, status: 'ok' });
    } catch (e) {
      await supabase.rpc('job_run_finish', {
        p_run: runId,
        p_status: 'failed',
        p_error: e instanceof Error ? e.message.slice(0, 500) : 'failed',
      });
      outcomes.push({ org: org.id as string, status: 'failed' });
    }
  }
  return outcomes;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { job } = await params;
  if (!KNOWN_JOBS.has(job)) return NextResponse.json({ error: 'unknown job' }, { status: 404 });

  const supabase = createServiceRoleClient();
  const at = now();
  // The dispatcher's own claim: one per 10-minute slot (refresh) or per business day (close).
  const period =
    job === 'refresh_today' || job === 'social_tick'
      ? at.toISOString().slice(0, 15)
      : job === 'send_outbox' || job === 'feedback_requests'
        ? at.toISOString().slice(0, 16)
        : job === 'benchmarks'
          ? businessDate(at).slice(0, 7)
          : businessDate(at);
  const { data: runId, error } = await supabase.rpc('job_run_begin', {
    p_job: job,
    p_org: null,
    p_period: period,
  });
  if (error) return NextResponse.json({ error: 'could not claim run' }, { status: 500 });
  if (!runId) return NextResponse.json({ status: 'already_ran', period });

  if (job === 'social_tick') {
    // pg_net gives up after 30 s, so answer at once and do the work after the response (ADR 0040).
    after(async () => {
      try {
        const done = await runSocialTick(supabase, at);
        await supabase.rpc('job_run_finish', {
          p_run: runId,
          p_status: done.failed > 0 ? 'failed' : 'succeeded',
          p_error: done.failed > 0 ? `${done.failed} post(s) failed` : null,
        });
      } catch (e) {
        await supabase.rpc('job_run_finish', {
          p_run: runId,
          p_status: 'failed',
          p_error: e instanceof Error ? e.message.slice(0, 500) : 'failed',
        });
      }
    });
    return NextResponse.json({ status: 'started', period }, { status: 202 });
  }

  try {
    if (job === 'feedback_requests') {
      // Per org, idempotent in SQL (one link per order, one per customer per week): no per-org claim needed.
      const { data: orgs, error: orgError } = await supabase.from('organizations').select('id');
      if (orgError) throw orgError;
      let queued = 0;
      for (const org of orgs ?? [])
        queued += await sendFeedbackRequests(supabase, org.id as string, at);
      await supabase.rpc('job_run_finish', { p_run: runId, p_status: 'succeeded', p_error: null });
      return NextResponse.json({ period, queued });
    }
    if (job === 'benchmarks') {
      // Monthly (Phase 9): last month's anonymous percentile snapshot; k >= 5 is enforced in SQL.
      const month = `${addDays(`${businessDate(at).slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
      const { data: cells, error: snapError } = await supabase.rpc('job_benchmark_snapshot', {
        p_period: month,
      });
      if (snapError) throw snapError;
      await supabase.rpc('job_run_finish', { p_run: runId, p_status: 'succeeded', p_error: null });
      return NextResponse.json({ period, month, cells });
    }
    if (job === 'send_outbox') {
      const drained = await runOutbox();
      await supabase.rpc('job_run_finish', { p_run: runId, p_status: 'succeeded', p_error: null });
      return NextResponse.json({ period, ...drained });
    }
    // refresh_today has nothing to precompute yet: metrics read live tables (ADR 0015 §7).
    const orgs =
      job === 'close_business_day'
        ? await closeEveryOrg(supabase, at)
        : job === 'morning_brief'
          ? await briefEveryOrg(supabase, at, 'morning')
          : job === 'evening_close'
            ? await briefEveryOrg(supabase, at, 'evening')
            : [];
    const failed = orgs.filter((o) => o.status === 'failed').length;
    await supabase.rpc('job_run_finish', {
      p_run: runId,
      p_status: failed > 0 ? 'failed' : 'succeeded',
      p_error: failed > 0 ? `${failed} organization(s) failed` : null,
    });
    return NextResponse.json({ status: 'ok', period, orgs: orgs.length, failed });
  } catch (e) {
    await supabase.rpc('job_run_finish', {
      p_run: runId,
      p_status: 'failed',
      p_error: e instanceof Error ? e.message.slice(0, 500) : 'failed',
    });
    return NextResponse.json({ error: 'job failed' }, { status: 500 });
  }
}
