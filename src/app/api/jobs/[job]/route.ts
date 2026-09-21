import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { now } from '@/lib/time/clock';
import { businessDate } from '@/lib/time/business-date';

/**
 * Scheduled-job entry point (ADR 0004). pg_cron calls this with a shared secret; the job is claimed in
 * job_runs so a double fire is a no-op, and its outcome is always recorded. Real work arrives in Phase 2+.
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

export async function POST(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { job } = await params;
  if (!KNOWN_JOBS.has(job)) return NextResponse.json({ error: 'unknown job' }, { status: 404 });

  const supabase = createServiceRoleClient();
  // Global jobs use a period per 10-minute slot (refresh) or per business day (close); org fan-out arrives in Phase 2.
  const at = now();
  const period = job === 'refresh_today' ? at.toISOString().slice(0, 15) : businessDate(at);
  const { data: runId, error } = await supabase.rpc('job_run_begin', {
    p_job: job,
    p_org: null,
    p_period: period,
  });
  if (error) return NextResponse.json({ error: 'could not claim run' }, { status: 500 });
  if (!runId) return NextResponse.json({ status: 'already_ran', period });

  await supabase.rpc('job_run_finish', { p_run: runId, p_status: 'succeeded', p_error: null });
  return NextResponse.json({ status: 'ok', period });
}
