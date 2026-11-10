/**
 * The social autopilot's 10-minute tick (ADR 0040), run by the GitHub Actions workflow `social-tick`
 * because a Cloudflare Worker cannot run Chromium or ffmpeg (ADR 0044). Same job as before: it is claimed
 * in job_runs per 10-minute slot (a double fire is a no-op) and its outcome is always recorded.
 *
 *   pnpm social:tick        needs SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL (+ the AI and
 *                           Meta/TikTok keys the autopilot already uses) in the environment or .env.local.
 *
 * Runs with scripts/stub-server-only.mjs so the `server-only` marker import is a no-op outside Next.
 */
import { createServiceRoleClient } from '@/lib/db/service-role';
import { now } from '@/lib/time/clock';
import { runSocialTick } from '@/modules/social/jobs/autopilot';

async function main() {
  const supabase = createServiceRoleClient();
  const at = now();
  const period = at.toISOString().slice(0, 15);
  const { data: runId, error } = await supabase.rpc('job_run_begin', {
    p_job: 'social_tick',
    p_org: null,
    p_period: period,
  });
  if (error) throw new Error('could not claim run');
  if (!runId) {
    console.log(`social_tick ${period}: already ran`);
    return;
  }
  try {
    const done = await runSocialTick(supabase, at);
    await supabase.rpc('job_run_finish', {
      p_run: runId,
      p_status: done.failed > 0 ? 'failed' : 'succeeded',
      p_error: done.failed > 0 ? `${done.failed} post(s) failed` : null,
    });
    console.log(`social_tick ${period}:`, JSON.stringify(done));
  } catch (e) {
    await supabase.rpc('job_run_finish', {
      p_run: runId,
      p_status: 'failed',
      p_error: e instanceof Error ? e.message.slice(0, 500) : 'failed',
    });
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
