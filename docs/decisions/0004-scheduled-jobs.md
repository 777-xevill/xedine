# ADR 0004 — Scheduled jobs runner

- Date: 2026-09-22
- Status: accepted

## Context
ARCHITECTURE.md needs jobs at four cadences: today's aggregates every 5–15 min, a business-day close after the ~04:00 cutoff, briefs at 09:00 and 23:00, and monthly benchmark snapshots. It left the choice open between "Vercel Cron (or Supabase pg_cron)". The two are not equivalent on the tiers we're on: Vercel's Hobby plan cannot invoke a cron more than once a day, which rules out the 5–15 min refresh that Phase 2's Health Monitor depends on.

## Decision
**Supabase `pg_cron` schedules the work; the job logic lives in authenticated Next.js route handlers.**

- `pg_cron` entries call the app's job routes over HTTP with a shared secret in a header (`pg_net` from the database).
- Job routes are server-only, verify the secret, and use the service role **with explicit `org_id` filters**.
- Every run writes to `job_runs` and is **idempotent per (job, org, period)** — a double-fire must be a no-op, not a double-count.
- Long work is chunked: the scheduler triggers a dispatcher that enqueues per-org work rather than processing every org in one invocation.
- Cron schedules are stored in UTC; per-org Asia/Dhaka timing (cutoff hour, brief times) is resolved inside the job from `org_settings`, not by the schedule.

## Alternatives considered
- **Vercel Cron** — the schedule would live in `vercel.json` next to the code, which is the nicest developer experience. Rejected because sub-daily invocations require Vercel Pro (~$20/mo), and paying that in Phase 0 buys nothing else we need yet.
- **GitHub Actions scheduled workflows** — free on a private repo with a 5-minute minimum, but the scheduler sits outside the app, fires late under platform load, and puts a production secret in CI.

## Consequences
- Easier: the full job cadence works on free tiers; scheduling survives a hosting change because it lives in the database, not the host.
- Harder: `pg_cron`/`pg_net` calls are fire-and-forget — the database does not see HTTP failures, so **`job_runs` plus an alert on missing runs is the only safety net** and must exist from Phase 0, not be retrofitted. Cron entries are database state, so they need a migration to create and must be reflected in the seed/reset path.
- The free `dev` Supabase project pauses when idle, which silently stops its cron. Do not use `dev` cron behaviour as evidence that a schedule works.
- **Revisit at Pilot gate A:** if job fan-out across orgs gets slow, move the dispatcher to a queue (Supabase Queues or a worker) while keeping `pg_cron` as the trigger.
