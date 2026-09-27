/**
 * Phase 10 compliance reminders, the sales-VAT summary and staff-lite (ROADMAP Phase 10; ADR 0023).
 * Reminders fire once per threshold; VAT's due day is org config; advances are money; attendance is the
 * branch manager's; everything audited that the non-negotiables say must be.
 */
import { randomUUID } from 'node:crypto';
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

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const dhaka = (date: string, time = '13:00') => new Date(`${date}T${time}:00+06:00`).toISOString();
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const TODAY = '2026-07-06';
const NOW = dhaka(TODAY, '12:00');

async function id(sql: string, params: unknown[]) {
  const [row] = await admin<{ id: string }>(sql, params);
  return row!.id;
}

describe('compliance', () => {
  let org: TestOrg;
  let manager: TestUser;
  let cashier: TestUser;
  const lic: Record<string, string> = {};
  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    cashier = await addMember(org, 'cashier', [org.branchIds[0]!]);
    for (const [key, days] of [
      ['expired', -3],
      ['week', 5],
      ['month', 20],
      ['twoMonths', 45],
      ['later', 100],
    ] as const) {
      lic[key] = await asUser(
        org.owner,
        async (s) =>
          (
            await s.q<{ id: string }>(
              `insert into public.licences (org_id, kind, expires_on) values ($1, $2, $3) returning id`,
              [org.id, `Licence ${key}`, addDays(TODAY, days)],
            )
          )[0]!.id,
        { commit: true },
      );
    }
  });

  it('bands each licence by days left and puts the next VAT return on the org’s due day', async () => {
    const rows = await asUser(manager, (s) =>
      s.q<Row>('select *, due_on::text as due from public.metric_compliance($1, $2, $3)', [
        org.id,
        null,
        NOW,
      ]),
    );
    const status = Object.fromEntries(
      rows.map((r) => [r.label as string, [r.status, r.days_left]]),
    );
    expect(status).toMatchObject({
      'Licence expired': ['expired', -3],
      'Licence week': ['urgent', 5],
      'Licence month': ['due', 20],
      'Licence twoMonths': ['upcoming', 45],
      'Licence later': ['ok', 100],
    });
    const vat = rows.find((r) => r.kind === 'vat_return')!;
    expect([vat.label, vat.due, vat.days_left]).toEqual(['2026-06', '2026-07-15', 9]);
    // After the due day, the next return is next month's; the day is config, not law.
    await admin(`update public.org_settings set vat_return_due_day = 5 where org_id = $1`, [
      org.id,
    ]);
    const later = await asUser(manager, (s) =>
      s.q<Row>('select *, due_on::text as due from public.metric_compliance($1, $2, $3)', [
        org.id,
        null,
        NOW,
      ]),
    );
    const v2 = later.find((r) => r.kind === 'vat_return')!;
    expect([v2.label, v2.due]).toEqual(['2026-07', '2026-08-05']);
    await admin(`update public.org_settings set vat_return_due_day = 15 where org_id = $1`, [
      org.id,
    ]);
    expect(
      (
        await asUser(cashier, (s) =>
          s.attempt('select * from public.metric_compliance($1, $2, $3)', [org.id, null, NOW]),
        )
      ).ok,
    ).toBe(false);
  });

  it('reminders carry one key per threshold, so a daily job sends each once', async () => {
    const run = () =>
      asService((s) =>
        s.q<Row>('select * from public.job_compliance_reminders($1, $2) order by reminder_key', [
          org.id,
          NOW,
        ]),
      );
    const first = await run();
    const byLabel = Object.fromEntries(
      first.map((r) => [r.label as string, String(r.reminder_key).split(':').pop()]),
    );
    expect(byLabel).toEqual({
      'Licence expired': 'expired',
      'Licence week': '7',
      'Licence month': '30',
      'Licence twoMonths': '60',
    });
    expect((await run()).map((r) => r.reminder_key)).toEqual(first.map((r) => r.reminder_key));
    const res = await asUser(manager, (s) =>
      s.attempt('select * from public.job_compliance_reminders($1, $2)', [org.id, NOW]),
    );
    expect(res.ok).toBe(false);
  });

  it('only the owner edits licences, and every change is audited', async () => {
    const res = await asUser(manager, (s) =>
      s.attempt(`update public.licences set number = 'X-1' where id = $1`, [lic.later]),
    );
    expect(res.ok ? res.rowCount : 0).toBe(0);
    await asUser(
      org.owner,
      (s) => s.q(`update public.licences set number = 'TL-42' where id = $1`, [lic.later]),
      { commit: true },
    );
    const audit = await admin<Row>(
      `select action from public.audit_log where org_id = $1 and entity = 'licence' order by created_at`,
      [org.id],
    );
    expect(audit.map((a) => a.action)).toContain('licence.update');
  });

  it('a manager scoped to one branch sees only that branch’s licences, plus org-wide ones; the accountant sees all', async () => {
    const chain = await createOrg({ branches: ['Dhanmondi', 'Uttara'] });
    const [dhanmondi, uttara] = chain.branchIds as [string, string];
    const dhManager = await addMember(chain, 'manager', [dhanmondi]);
    const accountant = await addMember(chain, 'accountant');
    const orgWide = await id(
      `insert into public.licences (org_id, kind, expires_on) values ($1, 'Trade licence', $2) returning id`,
      [chain.id, addDays(TODAY, 90)],
    );
    const dhOnly = await id(
      `insert into public.licences (org_id, branch_id, kind, expires_on) values ($1, $2, 'Fire (Dhanmondi)', $3) returning id`,
      [chain.id, dhanmondi, addDays(TODAY, 90)],
    );
    const utOnly = await id(
      `insert into public.licences (org_id, branch_id, kind, expires_on) values ($1, $2, 'Fire (Uttara)', $3) returning id`,
      [chain.id, uttara, addDays(TODAY, 90)],
    );
    const seenByManager = await asUser(dhManager, (s) =>
      s.q<{ id: string }>('select ref_id as id from public.metric_compliance($1, $2, $3)', [
        chain.id,
        null,
        NOW,
      ]),
    );
    expect(new Set(seenByManager.map((r) => r.id))).toEqual(new Set([orgWide, dhOnly, null]));
    expect(seenByManager.some((r) => r.id === utOnly)).toBe(false);
    const seenByAccountant = await asUser(accountant, (s) =>
      s.q<{ id: string }>('select ref_id as id from public.metric_compliance($1, $2, $3)', [
        chain.id,
        null,
        NOW,
      ]),
    );
    expect(seenByAccountant.map((r) => r.id)).toEqual(
      expect.arrayContaining([orgWide, dhOnly, utOnly]),
    );
    // Direct table access is scoped the same way — the metric function isn't the only guard.
    const direct = await asUser(dhManager, (s) =>
      s.q<{ id: string }>('select id from public.licences where org_id = $1', [chain.id]),
    );
    expect(new Set(direct.map((r) => r.id))).toEqual(new Set([orgWide, dhOnly]));
  });
});

describe('sales-VAT summary and staff-lite', () => {
  let org: TestOrg;
  let manager: TestUser;
  let otherManager: TestUser;
  let accountant: TestUser;
  let main: string;
  let staffA: string;
  let staffB: string;
  beforeAll(async () => {
    org = await createOrg({ branches: ['Main', 'Second'] });
    main = org.branchIds[0]!;
    manager = await addMember(org, 'manager', [main]);
    otherManager = await addMember(org, 'manager', [org.branchIds[1]!]);
    accountant = await addMember(org, 'accountant');
    const channel = await id(
      `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
      [org.id],
    );
    staffA = await id(
      `insert into public.staff (org_id, branch_id, display_name) values ($1, $2, 'Rafiq') returning id`,
      [org.id, main],
    );
    staffB = await id(
      `insert into public.staff (org_id, branch_id, display_name) values ($1, $2, 'Karim') returning id`,
      [org.id, main],
    );
    // Two VAT-exclusive orders at 15% and one VAT-inclusive at 5%, by two cashiers.
    for (const [staff, net, vat, rate, incl] of [
      [staffA, 100000, 15000, 1500, false],
      [staffA, 200000, 30000, 1500, false],
      [staffB, 95238, 4762, 500, true],
    ] as const)
      await admin(
        `insert into public.orders (id, org_id, branch_id, channel_id, staff_id, order_status, payment_status, placed_at,
           gross_poisha, net_before_discount_poisha, net_poisha, vat_poisha, total_poisha, price_includes_vat, vat_rate_bps)
         values ($1,$2,$3,$4,$5,'completed','paid',$6,$7,$7,$7,$8,$9,$10,$11)`,
        [
          randomUUID(),
          org.id,
          main,
          channel,
          staff,
          dhaka('2026-06-10'),
          net,
          vat,
          net + vat,
          incl,
          rate,
        ],
      );
  });

  it('sums the stored decomposition by VAT basis (owner and accountant only)', async () => {
    const rows = await asUser(accountant, (s) =>
      s.q<Row>('select * from public.metric_vat_summary($1, null, $2, $3)', [
        org.id,
        '2026-06-01',
        '2026-06-30',
      ]),
    );
    expect(
      rows.map((r) => [
        n(r.vat_rate_bps),
        r.price_includes_vat,
        n(r.orders),
        n(r.net_poisha),
        n(r.vat_poisha),
      ]),
    ).toEqual([
      [500, true, 1, 95238, 4762],
      [1500, false, 2, 300000, 45000],
    ]);
    const res = await asUser(manager, (s) =>
      s.attempt('select * from public.metric_vat_summary($1, null, $2, $3)', [
        org.id,
        '2026-06-01',
        '2026-06-30',
      ]),
    );
    expect(res.ok).toBe(false);
  });

  it('advances: owner records, balances are money, and each entry is audited', async () => {
    await asUser(
      org.owner,
      (s) =>
        s.q(
          `insert into public.advances (org_id, branch_id, staff_id, amount_poisha, occurred_on)
           values ($1,$2,$3,500000,'2026-06-01'), ($1,$2,$3,-200000,'2026-06-20')`,
          [org.id, main, staffA],
        ),
      { commit: true },
    );
    const [bal] = await asUser(accountant, (s) =>
      s.q<Row>('select * from public.metric_advance_balances($1, null)', [org.id]),
    );
    expect([
      bal!.display_name,
      n(bal!.given_poisha),
      n(bal!.repaid_poisha),
      n(bal!.balance_poisha),
    ]).toEqual(['Rafiq', 500000, 200000, 300000]);
    const res = await asUser(manager, (s) =>
      s.attempt('select * from public.metric_advance_balances($1, null)', [org.id]),
    );
    expect(res.ok ? 'ok' : res.code).toBe('42501');
    const [{ c }] = (await admin<{ c: number }>(
      `select count(*)::int as c from public.audit_log where org_id = $1 and action = 'advance.insert'`,
      [org.id],
    )) as [{ c: number }];
    expect(c).toBe(2);
  });

  it('attendance: the branch manager marks (re-marking updates); other branches cannot', async () => {
    const mark = (u: TestUser, staff: string, date: string, status: string) =>
      asUser(
        u,
        (s) => s.attempt('select public.mark_attendance($1, $2, $3)', [staff, date, status]),
        {
          commit: true,
        },
      );
    expect((await mark(manager, staffA, '2026-06-01', 'absent')).ok).toBe(true);
    expect((await mark(manager, staffA, '2026-06-01', 'present')).ok).toBe(true);
    expect((await mark(manager, staffA, '2026-06-02', 'leave')).ok).toBe(true);
    expect((await mark(manager, staffB, '2026-06-02', 'half_day')).ok).toBe(true);
    expect((await mark(otherManager, staffA, '2026-06-03', 'present')).ok).toBe(false);
    const rows = await asUser(manager, (s) =>
      s.q<Row>('select * from public.metric_attendance($1, null, $2, $3)', [
        org.id,
        '2026-06-01',
        '2026-06-03',
      ]),
    );
    const by = Object.fromEntries(
      rows.map((r) => [
        r.display_name as string,
        [n(r.present), n(r.half_day), n(r.on_leave), n(r.absent), n(r.unmarked)],
      ]),
    );
    expect(by).toEqual({ Karim: [0, 1, 0, 0, 2], Rafiq: [1, 0, 1, 0, 1] });
  });

  it('sales per staff come from the same exceptions metric the leak detector uses', async () => {
    const rows = await asUser(manager, (s) =>
      s.q<Row>('select * from public.metric_staff_sales($1, null, $2, $3)', [
        org.id,
        '2026-06-01',
        '2026-06-30',
      ]),
    );
    expect(rows.map((r) => [r.staff_name, n(r.orders), n(r.completed_net_poisha)])).toEqual([
      ['Rafiq', 2, 300000],
      ['Karim', 1, 95238],
    ]);
  });
});
