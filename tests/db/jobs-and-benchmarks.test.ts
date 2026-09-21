/** ADR 0004: jobs are idempotent per (job, org, period) and a missing run must be detectable. Also the k >= 5 privacy floor. */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { admin, asAnon, asService, asUser, closePool, createOrg } from './harness';

afterAll(closePool);

const begin = (job: string, org: string | null, period: string) =>
  asService(
    async (s) =>
      (
        await s.q<{ id: string | null }>('select public.job_run_begin($1, $2, $3) as id', [
          job,
          org,
          period,
        ])
      )[0]!.id,
    { commit: true },
  );

const finish = (
  run: string,
  status: 'succeeded' | 'failed' | 'skipped',
  error: string | null = null,
) =>
  asService(
    (s) => s.q('select public.job_run_finish($1, $2::public.job_status, $3)', [run, status, error]),
    { commit: true },
  );

describe('job_run_begin is idempotent per (job, org, period)', () => {
  it('claims once; a duplicate fire is a no-op', async () => {
    const org = await createOrg();
    const job = `t-${randomUUID().slice(0, 8)}`;
    const first = await begin(job, org.id, '2026-09-21');
    expect(first).toBeTruthy();
    expect(await begin(job, org.id, '2026-09-21')).toBeNull();
    expect(await begin(job, org.id, '2026-09-22')).toBeTruthy(); // a different period is a different run
    expect(await begin(job, null, '2026-09-21')).toBeTruthy(); // global runs are separate from per-org runs
    expect(await begin(job, null, '2026-09-21')).toBeNull(); // …and idempotent too (NULLS NOT DISTINCT)
  });

  it('a succeeded run is never repeated; a failed run can be retried and counts its attempts', async () => {
    const job = `t-${randomUUID().slice(0, 8)}`;
    const run = (await begin(job, null, 'p1'))!;
    await finish(run, 'failed', 'boom');
    const retry = await begin(job, null, 'p1');
    expect(retry).toBe(run);
    await finish(run, 'succeeded');
    expect(await begin(job, null, 'p1')).toBeNull();
    const [row] = await admin<{ attempts: number; status: string; error: string | null }>(
      'select attempts, status, error from public.job_runs where id = $1',
      [run],
    );
    expect(row).toEqual({ attempts: 2, status: 'succeeded', error: null });
  });

  it('a run stuck in "running" for over 30 minutes can be taken over', async () => {
    const job = `t-${randomUUID().slice(0, 8)}`;
    const run = (await begin(job, null, 'p1'))!;
    expect(await begin(job, null, 'p1')).toBeNull(); // fresh: still owned
    await admin(
      `update public.job_runs set started_at = now() - interval '31 minutes' where id = $1`,
      [run],
    );
    expect(await begin(job, null, 'p1')).toBe(run);
  });

  it('is not callable by signed-in users or anonymous visitors', async () => {
    const org = await createOrg();
    const asOwner = await asUser(org.owner, (s) =>
      s.attempt(`select public.job_run_begin('x', null, 'p')`),
    );
    expect(asOwner.ok).toBe(false);
    if (!asOwner.ok) expect(asOwner.code).toBe('42501');
    const anon = await asAnon((s) => s.attempt(`select public.job_health()`));
    expect(anon.ok).toBe(false);
  });
});

describe('job_health: a missing run is detectable', () => {
  const health = (job: string) =>
    asService(
      async (s) =>
        (
          await s.q<{ is_overdue: boolean; last_success_at: Date | null }>(
            'select * from public.job_health() where job = $1',
            [job],
          )
        )[0],
    );

  it('is overdue with no successful run, healthy after one, overdue again when stale', async () => {
    const job = `health-${randomUUID().slice(0, 8)}`;
    await admin(
      `insert into public.job_schedules (job, cron_expr, expected_every) values ($1, '* * * * *', interval '10 minutes')`,
      [job],
    );
    expect((await health(job))!.is_overdue).toBe(true);

    await admin(
      `insert into public.job_runs (job, period_key, status, finished_at) values ($1, 'p1', 'succeeded', now())`,
      [job],
    );
    expect((await health(job))!.is_overdue).toBe(false);

    await admin(
      `update public.job_runs set finished_at = now() - interval '25 minutes' where job = $1`,
      [job],
    );
    expect((await health(job))!.is_overdue).toBe(true); // older than 2 × expected_every
  });

  it('failed runs do not count as healthy', async () => {
    const job = `health-${randomUUID().slice(0, 8)}`;
    await admin(
      `insert into public.job_schedules (job, cron_expr, expected_every) values ($1, '* * * * *', interval '10 minutes')`,
      [job],
    );
    await admin(
      `insert into public.job_runs (job, period_key, status, finished_at) values ($1, 'p1', 'failed', now())`,
      [job],
    );
    expect((await health(job))!.is_overdue).toBe(true);
  });

  it('the shipped schedules exist (ADR 0004: refresh every 10 min, close after the 04:30 cutoff)', async () => {
    const rows = await admin<{ job: string; cron_expr: string }>(
      `select job, cron_expr from public.job_schedules where job in ('refresh_today', 'close_business_day') order by job`,
    );
    expect(rows).toEqual([
      { job: 'close_business_day', cron_expr: '30 22 * * *' },
      { job: 'refresh_today', cron_expr: '*/10 * * * *' },
    ]);
  });
});

describe('benchmark_snapshots can never describe fewer than five restaurants (k >= 5)', () => {
  const insert = (k: number | null, isReference: boolean) =>
    admin(
      `insert into public.benchmark_snapshots (period, segment, metric_id, p50, k, is_reference) values (current_date, '{}', 'gp.pct', 60, $1, $2)`,
      [k, isReference],
    );

  it('rejects k < 5, and a missing k, for peer-derived rows', async () => {
    await expect(insert(4, false)).rejects.toMatchObject({ code: '23514' });
    await expect(insert(0, false)).rejects.toMatchObject({ code: '23514' });
    await expect(insert(null, false)).rejects.toMatchObject({ code: '23514' }); // a CHECK passes on NULL unless coalesced
  });

  it('accepts k >= 5, and labelled industry-reference rows', async () => {
    await insert(5, false);
    await insert(null, true);
  });

  it('clients can read snapshots but never write them', async () => {
    const org = await createOrg();
    const read = await asUser(org.owner, (s) =>
      s.q('select * from public.benchmark_snapshots limit 1'),
    );
    expect(Array.isArray(read)).toBe(true);
    const write = await asUser(org.owner, (s) =>
      s.attempt(
        `insert into public.benchmark_snapshots (period, segment, metric_id, k) values (current_date, '{}', 'x', 9)`,
      ),
    );
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.code).toBe('42501');
  });

  it('has no organization column, so a snapshot cannot point at a tenant', async () => {
    const cols = await admin<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'benchmark_snapshots'`,
    );
    expect(cols.map((c) => c.column_name)).not.toContain('org_id');
  });
});
