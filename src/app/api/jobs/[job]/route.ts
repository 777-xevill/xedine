import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { now } from '@/lib/time/clock';
import { addDays, businessDate, DEFAULT_CUTOFF_MINUTES } from '@/lib/time/business-date';

/**
 * Scheduled-job entry point (ADR 0004). pg_cron calls this with a shared secret; the job is claimed in
 * job_runs so a double fire is a no-op, and its outcome is always recorded.
 *
 * close_business_day fans out per organization (ADR 0015 §6): each org's just-closed business day (its own
 * cutoff) gets its own claim, so one org failing never blocks the rest and a retry only redoes what failed.
 */
const KNOWN_JOBS = new Set(['refresh_today', 'close_business_day']);

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

export async function POST(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { job } = await params;
  if (!KNOWN_JOBS.has(job)) return NextResponse.json({ error: 'unknown job' }, { status: 404 });

  const supabase = createServiceRoleClient();
  const at = now();
  // The dispatcher's own claim: one per 10-minute slot (refresh) or per business day (close).
  const period = job === 'refresh_today' ? at.toISOString().slice(0, 15) : businessDate(at);
  const { data: runId, error } = await supabase.rpc('job_run_begin', {
    p_job: job,
    p_org: null,
    p_period: period,
  });
  if (error) return NextResponse.json({ error: 'could not claim run' }, { status: 500 });
  if (!runId) return NextResponse.json({ status: 'already_ran', period });

  try {
    // refresh_today has nothing to precompute yet: metrics read live tables (ADR 0015 §7).
    const orgs = job === 'close_business_day' ? await closeEveryOrg(supabase, at) : [];
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
