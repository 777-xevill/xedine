/**
 * Phase 9 branch intelligence and benchmarking (METRICS.md "Benchmarks"; ADR 0022).
 * Branch gaps are computed in ৳; the manager scorecard is money-free; no benchmark output can describe
 * fewer than five restaurants — not a cell, and not the difference between two published cells.
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
const FROM = '2026-06-01';
const TO = '2026-06-30';

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}
const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;

async function channel(org: TestOrg, name: string, kind: string) {
  return id(`insert into public.channels (org_id, name, kind) values ($1, $2, $3) returning id`, [
    org.id,
    name,
    kind,
  ]);
}

async function item(org: TestOrg, name: string) {
  const cat = await id(
    `insert into public.menu_categories (org_id, name) values ($1, $2) returning id`,
    [org.id, `Cat ${name}`],
  );
  return id(
    `insert into public.menu_items (org_id, category_id, name, base_price_poisha) values ($1, $2, $3, 50000) returning id`,
    [org.id, cat, name],
  );
}

async function order(
  org: TestOrg,
  branch: string,
  channelId: string,
  date: string,
  opts: { net?: number; discount?: number; items?: { id: string; name: string }[] } = {},
) {
  const orderId = randomUUID();
  const net = opts.net ?? 500000;
  const discount = opts.discount ?? 0;
  await admin(
    `insert into public.orders (id, org_id, branch_id, channel_id, order_status, payment_status, placed_at,
       gross_poisha, net_before_discount_poisha, discount_net_poisha, net_poisha, total_poisha,
       price_includes_vat, vat_rate_bps)
     values ($1,$2,$3,$4,'completed','paid',$5,$6,$6,$7,$8,$8,false,0)`,
    [orderId, org.id, branch, channelId, dhaka(date), net + discount, discount, net],
  );
  for (const it of opts.items ?? [])
    await admin(
      `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, name_snapshot, quantity,
         unit_price_poisha, gross_poisha, net_before_discount_poisha, net_poisha, total_poisha)
       values ($1,$2,$3,$4,$5,1,$6,$6,$6,$6,$6)`,
      [org.id, branch, orderId, it.id, it.name, net / (opts.items?.length ?? 1)],
    );
}

async function salary(org: TestOrg, branch: string, month: string, poisha: number) {
  const staff = await id(
    `insert into public.staff (org_id, branch_id, display_name) values ($1, $2, 'Cook') returning id`,
    [org.id, branch],
  );
  await admin(
    `insert into public.salary_entries (org_id, branch_id, staff_id, month, salary_poisha) values ($1,$2,$3,$4,$5)`,
    [org.id, branch, staff, month, poisha],
  );
}

describe('branch league, gaps in ৳, scorecards, like-for-like and transfers', () => {
  let org: TestOrg;
  let manager: TestUser;
  let accountant: TestUser;
  let main: string;
  let second: string;
  beforeAll(async () => {
    org = await createOrg({ branches: ['Main', 'Second'] });
    [main, second] = org.branchIds as [string, string];
    manager = await addMember(org, 'manager', [main]);
    accountant = await addMember(org, 'accountant');
    const dine = await channel(org, 'Dine-in', 'dine_in');
    const panda = await channel(org, 'foodpanda', 'foodpanda');
    const kacchi = { id: await item(org, 'Kacchi'), name: 'Kacchi' };
    const onlyMain = { id: await item(org, 'Borhani'), name: 'Borhani' };
    for (let d = 0; d < 10; d++) {
      const day = addDays(FROM, d);
      // Main: 3 orders a day (one on foodpanda), no discounts. Second: 2 a day, each ৳1,000 off ৳6,000.
      await order(org, main, dine, day, { items: [kacchi] });
      await order(org, main, dine, day, { items: [kacchi, onlyMain] });
      await order(org, main, panda, day, { items: [kacchi] });
      await order(org, second, dine, day, { discount: 100000, items: [kacchi] });
      await order(org, second, dine, day, { discount: 100000, items: [kacchi] });
    }
    // Labour for June: Main ৳30,000, Second ৳60,000.
    await salary(org, main, FROM, 3_000_000);
    await salary(org, second, FROM, 6_000_000);
    // Transfers: one arrives 10% short the next day; one is still on the road.
    const ing = await id(
      `insert into public.ingredients (org_id, name, base) values ($1, 'Chicken', 'g') returning id`,
      [org.id],
    );
    await admin(
      `insert into public.ingredient_price_history (org_id, ingredient_id, effective_from, cost_poisha, per_base_qty)
       values ($1, $2, '2026-01-01', 30000, 1000)`,
      [org.id, ing],
    );
    const short = await id(
      `insert into public.transfers (org_id, from_branch_id, to_branch_id, status, sent_at, received_at)
       values ($1,$2,$3,'received',$4,$5) returning id`,
      [org.id, main, second, dhaka('2026-06-10', '10:00'), dhaka('2026-06-11', '10:00')],
    );
    await admin(
      `insert into public.transfer_lines (org_id, transfer_id, ingredient_id, qty_base_sent, qty_base_received)
       values ($1,$2,$3,10000,9000)`,
      [org.id, short, ing],
    );
    const open = await id(
      `insert into public.transfers (org_id, from_branch_id, to_branch_id, status, sent_at)
       values ($1,$2,$3,'sent',$4) returning id`,
      [org.id, second, main, dhaka('2026-06-20', '10:00')],
    );
    await admin(
      `insert into public.transfer_lines (org_id, transfer_id, ingredient_id, qty_base_sent) values ($1,$2,$3,5000)`,
      [org.id, open, ing],
    );
  });

  it('the league puts each branch side by side from the metric functions', async () => {
    const rows = await asUser(org.owner, (s) =>
      s.q<Row>('select * from public.metric_branch_league($1, $2, $3)', [org.id, FROM, TO]),
    );
    const m = rows.find((r) => r.branch_id === main)!;
    const s2 = rows.find((r) => r.branch_id === second)!;
    expect([n(m.orders), n(m.net_poisha), n(m.days_open), n(m.net_per_day_poisha)]).toEqual([
      30, 15_000_000, 10, 1_500_000,
    ]);
    expect(n(m.delivery_share_bps)).toBe(3333);
    expect([n(s2.discount_bps), n(m.discount_bps)]).toEqual([1667, 0]);
    // Labour ÷ sales: 30,000 ÷ 1,50,000 = 20%; 60,000 ÷ 1,00,000 = 60%.
    expect([n(m.labour_bps), n(s2.labour_bps)]).toEqual([2000, 6000]);
  });

  it('gap to the best branch, in ৳: exact amounts per component', async () => {
    const gaps = await asUser(accountant, (s) =>
      s.q<Row>('select * from public.metric_branch_gaps($1, $2, $3)', [org.id, FROM, TO]),
    );
    const of = (b: string, c: string) =>
      n(gaps.find((g) => g.branch_id === b && g.component === c)?.gap_poisha);
    // Second at Main's labour rate (20%) on ৳1,00,000 would pay ৳20,000, not ৳60,000.
    expect(of(second, 'labour')).toBe(4_000_000);
    // Discounts: Main gives none, so all of Second's ৳20,000 is the gap.
    expect(of(second, 'discounts')).toBe(2_000_000);
    expect([of(main, 'labour'), of(main, 'discounts')]).toEqual([0, 0]);
    const league = await asUser(org.owner, (s) =>
      s.q<Row>('select * from public.metric_branch_league($1, $2, $3)', [org.id, FROM, TO]),
    );
    expect(n(league.find((r) => r.branch_id === second)!.gap_poisha)).toBe(6_000_000);
  });

  it('a manager sees only their branch, with no cost figures, and no gaps', async () => {
    const rows = await asUser(manager, (s) =>
      s.q<Row>('select * from public.metric_branch_league($1, $2, $3)', [org.id, FROM, TO]),
    );
    expect(rows.map((r) => r.branch_id)).toEqual([main]);
    expect([rows[0]!.labour_bps, rows[0]!.gap_poisha, rows[0]!.tfc_pct_bps]).toEqual([
      null,
      null,
      null,
    ]);
    const res = await asUser(manager, (s) =>
      s.attempt('select * from public.metric_branch_gaps($1, $2, $3)', [org.id, FROM, TO]),
    );
    expect(res.ok ? 'ok' : res.code).toBe('42501');
  });

  it('the scorecard is money-free and returns only this branch, ranked among all', async () => {
    const rows = await asUser(manager, (s) =>
      s.q<Row>('select * from public.metric_branch_scorecard($1, $2, $3, $4)', [
        org.id,
        main,
        FROM,
        TO,
      ]),
    );
    const by = Object.fromEntries(rows.map((r) => [r.measure as string, r]));
    expect(Object.keys(by)).toEqual([
      'net_per_day',
      'orders_per_day',
      'aov',
      'ticket_minutes',
      'rating',
      'first_return',
      'discipline',
      'discount_rate',
      'void_rate',
    ]);
    expect([n(by.net_per_day!.value), by.net_per_day!.rank, by.net_per_day!.branches]).toEqual([
      1_500_000, 1, 2,
    ]);
    expect([n(by.discount_rate!.value), by.discount_rate!.rank]).toEqual([0, 1]);
    expect([by.ticket_minutes!.value, by.ticket_minutes!.rank]).toEqual([null, null]);
    const other = await asUser(manager, (s) =>
      s.attempt('select * from public.metric_branch_scorecard($1, $2, $3, $4)', [
        org.id,
        second,
        FROM,
        TO,
      ]),
    );
    expect(other.ok).toBe(false);
  });

  it('like-for-like keeps only items sold in both branches', async () => {
    const rows = await asUser(org.owner, (s) =>
      s.q<Row>('select * from public.metric_like_for_like($1, $2, $3)', [org.id, FROM, TO]),
    );
    expect([...new Set(rows.map((r) => r.name))]).toEqual(['Kacchi']);
    const perDay = Object.fromEntries(rows.map((r) => [r.branch_id as string, n(r.per_day)]));
    expect(perDay).toEqual({ [main]: 3, [second]: 2 });
  });

  it('the transfer audit shows shortfalls, open transfers and (money roles) their value', async () => {
    const rows = await asUser(org.owner, (s) =>
      s.q<Row>('select * from public.metric_transfer_audit($1, null, $2, $3)', [org.id, FROM, TO]),
    );
    expect(rows.map((r) => r.status)).toEqual(['sent', 'received']);
    const recv = rows[1]!;
    // 10 kg at ৳300/kg sent, 1 kg missing.
    expect([
      n(recv.days_to_receive),
      n(recv.short_lines),
      n(recv.value_sent_poisha),
      n(recv.value_short_poisha),
    ]).toEqual([1, 1, 300_000, 30_000]);
    const mgr = await asUser(manager, (s) =>
      s.q<Row>('select * from public.metric_transfer_audit($1, null, $2, $3)', [org.id, FROM, TO]),
    );
    expect(mgr).toHaveLength(2);
    expect(mgr.every((r) => r.value_sent_poisha === null)).toBe(true);
  });
});

describe('benchmarks: k ≥ 5 in SQL', () => {
  const MAY = '2026-05-01';
  const orgs: TestOrg[] = [];
  async function restaurant(i: number, cuisine: string, optIn: boolean) {
    const org = await createOrg({ branches: ['Main'] });
    const ch = await channel(org, 'Dine-in', 'dine_in');
    for (let d = 0; d < 30; d++)
      await order(org, org.branchIds[0]!, ch, addDays(MAY, d), { net: 40000 + i * 10000 });
    await admin(`update public.org_settings set benchmark_opt_in = $2 where org_id = $1`, [
      org.id,
      optIn,
    ]);
    await admin(
      `insert into public.org_profile (org_id, cuisine) values ($1, $2)
       on conflict (org_id) do update set cuisine = excluded.cuisine`,
      [org.id, cuisine],
    );
    orgs.push(org);
    return org;
  }
  const snapshot = () =>
    asService((s) => s.q<{ n: number }>('select public.job_benchmark_snapshot($1) as n', [MAY]), {
      commit: true,
    });
  const cells = () =>
    admin<Row>(
      `select segment, k, p50 from public.benchmark_snapshots
        where period = $1 and not is_reference and metric_id = 'orders.aov' order by k desc, length(segment::text), segment::text`,
      [MAY],
    );

  beforeAll(async () => {
    for (let i = 0; i < 4; i++) await restaurant(i, 'Kacchi', true);
    await restaurant(4, 'Cafe', false);
  });

  it('four opted-in restaurants publish nothing; a fifth that has not opted in does not count', async () => {
    await snapshot();
    expect(await cells()).toEqual([]);
  });

  it('five publish the all-restaurants and branch-band cells, not a four-restaurant cuisine cell', async () => {
    await admin(`update public.org_settings set benchmark_opt_in = true where org_id = $1`, [
      orgs[4]!.id,
    ]);
    await snapshot();
    const rows = await cells();
    expect(rows.map((r) => [r.segment, r.k])).toEqual([
      [{}, 5],
      [{ branch_band: '1' }, 5],
    ]);
    // AOVs ৳400, 500, 600, 700, 800 → median ৳600.
    expect(n(rows[0]!.p50)).toBe(60000);
  });

  it('a cell whose complement is 1–4 restaurants is withheld (no differencing)', async () => {
    await restaurant(5, 'Kacchi', true); // kacchi now has 5 of 6
    await snapshot();
    const rows = await cells();
    // kacchi (5) vs all (6) would expose the one café: withheld, as is kacchi × band.
    expect(rows.map((r) => [r.segment, r.k])).toEqual([
      [{}, 6],
      [{ branch_band: '1' }, 6],
    ]);
    const [check] = await admin<{ bad: number }>(
      `select count(*)::int as bad from public.benchmark_snapshots where not is_reference and coalesce(k, 0) < 5`,
    );
    expect(check!.bad).toBe(0);
  });

  it('the table itself refuses a peer row under five', async () => {
    const res = await asService((s) =>
      s.attempt(
        `insert into public.benchmark_snapshots (period, segment, metric_id, p50, k) values ($1, '{}', 'orders.aov', 1, 4)`,
        [MAY],
      ),
    );
    expect(res.ok).toBe(false);
  });

  it('an opted-in owner sees their month against the peer cell; others see only the labelled reference', async () => {
    await admin(
      `insert into public.benchmark_snapshots (period, segment, metric_id, p25, p50, p75, is_reference, source_note)
       values ('2026-01-01', '{}', 'orders.aov', 50000, 70000, 90000, true, 'Industry reference (test)')`,
    );
    const now = new Date('2026-06-10T06:00:00Z').toISOString();
    const mine = await asUser(orgs[0]!.owner, (s) =>
      s.q<Row>('select * from public.metric_benchmarks($1, $2)', [orgs[0]!.id, now]),
    );
    const aov = mine.find((r) => r.metric_id === 'orders.aov')!;
    expect([n(aov.own_value), aov.segment, aov.k, aov.is_reference, aov.place]).toEqual([
      40000,
      { branch_band: '1' },
      6,
      false,
      'below_p25',
    ]);
    const outsider = await createOrg({ branches: ['Main'] });
    const theirs = await asUser(outsider.owner, (s) =>
      s.q<Row>('select * from public.metric_benchmarks($1, $2)', [outsider.id, now]),
    );
    const ref = theirs.find((r) => r.metric_id === 'orders.aov')!;
    expect([ref.is_reference, n(ref.p50), ref.own_value]).toEqual([true, 70000, null]);
    const m = await addMember(orgs[0]!, 'manager', [orgs[0]!.branchIds[0]!]);
    const res = await asUser(m, (s) =>
      s.attempt('select * from public.metric_benchmarks($1, $2)', [orgs[0]!.id, now]),
    );
    expect(res.ok).toBe(false);
  });
});
