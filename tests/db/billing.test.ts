/**
 * Phase 10 plans and billing (ADR 0008 prices, ADR 0023). A new org is on a 14-day Growth trial (30 before 2026-11-19); plan
 * limits (AI, WhatsApp) are decided in SQL; only platform admins set subscriptions, and that is audited.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  admin,
  asService,
  asUser,
  closePool,
  createOrg,
  createUser,
  type TestOrg,
  type TestUser,
} from './harness';

afterAll(closePool);

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

describe('plans and billing', () => {
  let org: TestOrg;
  let manager: TestUser;
  let operator: TestUser;
  beforeAll(async () => {
    org = await createOrg({ branches: ['Main', 'Second'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    operator = await createUser('operator');
    await admin(`insert into public.platform_admins (user_id) values ($1)`, [operator.id]);
  });

  const allowed = (fn: string, at: string) =>
    asService((s) => s.q<{ ok: boolean }>(`select public.${fn}($1, $2) as ok`, [org.id, at]));
  const billing = (at: string) =>
    asUser(org.owner, (s) => s.q<Row>('select * from public.metric_billing($1, $2)', [org.id, at]));

  it('a new org is on a 14-day Growth trial with AI and WhatsApp; after it, both stop', async () => {
    const [b] = await billing(inDays(1));
    expect([b!.plan_code, b!.status, n(b!.branches), n(b!.monthly_amount_poisha)]).toEqual([
      'growth',
      'trialing',
      2,
      900000,
    ]);
    expect((await allowed('org_ai_allowed', inDays(1)))[0]!.ok).toBe(true);
    expect((await allowed('org_ai_allowed', inDays(13)))[0]!.ok).toBe(true);
    expect((await allowed('org_ai_allowed', inDays(15)))[0]!.ok).toBe(false);
    expect((await allowed('org_ai_allowed', inDays(31)))[0]!.ok).toBe(false);
    expect((await allowed('org_whatsapp_allowed', inDays(31)))[0]!.ok).toBe(false);
    const [late] = await billing(inDays(31));
    expect(late!.status).toBe('trial_expired');
  });

  it('only a platform admin sets the subscription; Starter has no AI or WhatsApp; audited', async () => {
    const denied = await asUser(org.owner, (s) =>
      s.attempt('select public.admin_set_subscription($1, $2, $3, $4, $5)', [
        org.id,
        'chain',
        'active',
        0,
        null,
      ]),
    );
    expect(denied.ok ? 'ok' : denied.code).toBe('42501');
    await asUser(
      operator,
      (s) =>
        s.q('select public.admin_set_subscription($1, $2, $3, $4, $5)', [
          org.id,
          'starter',
          'active',
          0,
          '2026-12-31',
        ]),
      { commit: true },
    );
    expect((await allowed('org_ai_allowed', inDays(1)))[0]!.ok).toBe(false);
    expect((await allowed('org_whatsapp_allowed', inDays(1)))[0]!.ok).toBe(false);
    // Pilot: Growth at 50% off — 2 branches × ৳4,500 × 0.5 = ৳4,500 a month.
    await asUser(
      operator,
      (s) =>
        s.q('select public.admin_set_subscription($1, $2, $3, $4, $5)', [
          org.id,
          'growth',
          'active',
          5000,
          '2026-12-31',
        ]),
      { commit: true },
    );
    const [b] = await billing(inDays(40));
    expect([b!.plan_code, b!.status, n(b!.monthly_amount_poisha)]).toEqual([
      'growth',
      'active',
      450000,
    ]);
    expect((await allowed('org_ai_allowed', inDays(40)))[0]!.ok).toBe(true);
    const audit = await admin<Row>(
      `select action from public.audit_log where org_id = $1 and entity = 'subscription'`,
      [org.id],
    );
    expect(audit).toHaveLength(2);
  });

  it('billing is for owner and accountant; the admin list is for operators; admins are unreadable', async () => {
    expect(
      (
        await asUser(manager, (s) =>
          s.attempt('select * from public.metric_billing($1, $2)', [org.id, inDays(1)]),
        )
      ).ok,
    ).toBe(false);
    const list = await asUser(operator, (s) =>
      s.q<Row>('select * from public.admin_orgs($1)', [inDays(1)]),
    );
    expect(list.some((r) => r.org_id === org.id)).toBe(true);
    expect(Object.keys(list[0]!)).not.toContain('net_poisha');
    expect(
      (
        await asUser(org.owner, (s) =>
          s.attempt('select * from public.admin_orgs($1)', [inDays(1)]),
        )
      ).ok,
    ).toBe(false);
    const peek = await asUser(org.owner, (s) => s.attempt('select * from public.platform_admins'));
    expect(peek.ok).toBe(false);
    const [me] = await asUser(operator, (s) =>
      s.q<{ a: boolean }>('select public.am_platform_admin() as a'),
    );
    expect(me!.a).toBe(true);
  });
});

describe('AI usage meter', () => {
  let org: TestOrg;
  let manager: TestUser;
  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
  });
  // 2026-11-19 10:00 Dhaka is business date 2026-11-19; 02:00 the next night still belongs to it.
  const at = '2026-11-19T04:00:00Z';
  const usage = (when: string, cap = 1_000_000, days = 7) =>
    asUser(org.owner, (s) =>
      s.q<Row>('select * from public.metric_ai_usage($1, $2, $3, $4)', [org.id, when, cap, days]),
    );

  it('shows each day’s share of the allowance, today last, capped at 100, with the 04:00 reset', async () => {
    await admin(
      `insert into public.ai_usage (org_id, usage_date, model, feature, requests, cost_usd_micros) values
         ($1, '2026-11-19', 'm', 'chat', 3, 250000), ($1, '2026-11-19', 'm', 'brief', 1, 120000),
         ($1, '2026-11-17', 'm', 'chat', 9, 1300000)`,
      [org.id],
    );
    const rows = await usage(at);
    expect(rows).toHaveLength(7);
    const today = rows[6]!;
    expect([today.is_today, n(today.requests), n(today.used_pct)]).toEqual([true, 4, 37]);
    expect(today.is_today).toBe(true);
    expect(new Date(String(today.resets_at)).toISOString()).toBe('2026-11-19T22:00:00.000Z');
    expect(n(rows[4]!.used_pct)).toBe(100);
    expect(n(rows[5]!.requests)).toBe(0);
    // 02:00 Dhaka on the 20th is still the 19th's business day.
    const late = await usage('2026-11-19T20:00:00Z');
    expect(late[6]!.is_today).toBe(true);
    expect(n(late[6]!.used_pct)).toBe(37);
  });

  it('is for owner and accountant only, and refuses a bad cap', async () => {
    const denied = await asUser(manager, (s) =>
      s.attempt('select * from public.metric_ai_usage($1, $2, $3, $4)', [org.id, at, 1_000_000, 7]),
    );
    expect(denied.ok ? 'ok' : denied.code).toBe('42501');
    const bad = await asUser(org.owner, (s) =>
      s.attempt('select * from public.metric_ai_usage($1, $2, $3, $4)', [org.id, at, 0, 7]),
    );
    expect(bad.ok ? 'ok' : bad.code).toBe('22023');
  });
});
