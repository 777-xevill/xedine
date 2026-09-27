/**
 * Phase 4 (ADR 0017): jobs and webhooks read metrics as the service role for one explicit org; the
 * insight feed shows at most three insights a day, never the same finding twice, and the owner's
 * dismiss/snooze follows through to the finding.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  admin,
  asService,
  asUser,
  closePool,
  createOrg,
  type TestOrg,
  type TestUser,
} from './harness';

afterAll(closePool);
const n = (v: unknown) => Number(v ?? 0);

describe('service role reads metrics for an explicit org', () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await createOrg({ branches: ['Dhanmondi', 'Mirpur'] });
  });

  it('sees every branch and money figures; an unknown org is an error, not an empty answer', async () => {
    const rows = await asService((s) =>
      s.q(`select * from public.metric_sales($1, null, '2026-09-21', '2026-09-21')`, [org.id]),
    );
    expect(rows.filter((r) => r.branch_id !== null)).toHaveLength(2);
    const pnl = await asService((s) =>
      s.attempt(`select * from public.metric_flash_pnl($1, null, now())`, [org.id]),
    );
    expect(pnl.ok).toBe(true);
    const unknown = await asService((s) =>
      s.attempt(
        `select * from public.metric_sales(gen_random_uuid(), null, '2026-09-21', '2026-09-21')`,
      ),
    );
    expect(unknown.ok).toBe(false);
  });

  it('metric_window gives business dates to members only', async () => {
    const [w] = await asUser(org.owner, (s) =>
      s.q<{ from_date: string; to_date: string }>(
        `select from_date::text, to_date::text from public.metric_window($1, 'last_7d', '2026-09-21T17:30:00Z')`,
        [org.id],
      ),
    );
    expect(w).toEqual({ from_date: '2026-09-15', to_date: '2026-09-21' });
    const stranger = await createOrg({ branches: ['X'] });
    const r = await asUser(stranger.owner, (s) =>
      s.attempt(`select * from public.metric_window($1, 'today', now())`, [org.id]),
    );
    expect(r.ok).toBe(false);
  });
});

describe('the insight feed', () => {
  let org: TestOrg;
  let manager: TestUser;
  const findings: string[] = [];

  beforeAll(async () => {
    org = await createOrg({ branches: ['Dhanmondi'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    for (const [i, impact] of [500000, 400000, 300000, 200000, 100000].entries()) {
      const [f] = await admin<{ id: string }>(
        `insert into public.findings (org_id, branch_id, type, period_start, period_end, impact_poisha, confidence, subject_key)
         values ($1, $2, 'void.after_kot', '2026-09-14', '2026-09-20', $3, 'high', $4) returning id`,
        [org.id, org.branchIds[0], impact, `staff-${i}`],
      );
      findings.push(f!.id);
    }
  });

  const refresh = (date: string) =>
    asService(
      (s) => s.q<{ n: number }>(`select public.job_refresh_insights($1, $2) as n`, [org.id, date]),
      {
        commit: true,
      },
    );

  it('shows at most three a day, biggest first, and never the same finding twice', async () => {
    expect(n((await refresh('2026-09-21'))[0]!.n)).toBe(3);
    expect(n((await refresh('2026-09-21'))[0]!.n)).toBe(0);
    expect(n((await refresh('2026-09-22'))[0]!.n)).toBe(2);
    expect(n((await refresh('2026-09-23'))[0]!.n)).toBe(0);
    const shown = await admin<{ finding_id: string; shown_on: string }>(
      `select finding_id, shown_on::text from public.insight_feed where org_id = $1 order by shown_on, rank desc`,
      [org.id],
    );
    expect(shown.map((s) => s.finding_id)).toEqual(findings);
  });

  it('only the owner answers an insight; dismissing needs a reason and dismisses the finding', async () => {
    const [insight] = await admin<{ id: string; finding_id: string }>(
      `select id, finding_id from public.insight_feed where org_id = $1 order by rank desc limit 1`,
      [org.id],
    );
    const byManager = await asUser(manager, (s) =>
      s.attempt(`select public.insight_action($1, 'dismiss', 'no')`, [insight!.id]),
    );
    expect(byManager.ok).toBe(false);
    const noReason = await asUser(org.owner, (s) =>
      s.attempt(`select public.insight_action($1, 'dismiss')`, [insight!.id]),
    );
    expect(noReason.ok).toBe(false);
    await asUser(
      org.owner,
      (s) => s.q(`select public.insight_action($1, 'dismiss', 'covered by CCTV')`, [insight!.id]),
      {
        commit: true,
      },
    );
    const [f] = await admin<{ status: string; reason: string }>(
      `select status::text, reason from public.findings where id = $1`,
      [insight!.finding_id],
    );
    expect(f).toEqual({ status: 'dismissed', reason: 'covered by CCTV' });
  });

  it('only the service role runs the refresh job', async () => {
    const r = await asUser(org.owner, (s) =>
      s.attempt(`select public.job_refresh_insights($1, '2026-09-24')`, [org.id]),
    );
    expect(r.ok).toBe(false);
  });
});
