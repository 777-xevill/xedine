/**
 * Phase 2 metrics layer (METRICS.md, ADR 0015). Fixtures are inserted directly so every expected number
 * can be worked out by hand; the metric functions must reproduce them exactly. The clock is injected:
 * "now" is the seed's frozen now, 2026-09-21 23:30 Asia/Dhaka (a Monday; business day starts 04:00).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeLine, mulBps, sumLines, type VatConfig } from '../../src/lib/money';
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

const NOW = '2026-09-21T17:30:00Z';
type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** A Dhaka wall-clock time as an ISO instant (UTC+6, no DST). */
const dhaka = (date: string, time: string) => new Date(`${date}T${time}:00+06:00`).toISOString();

interface LineSpec {
  item: string;
  qty: number;
  unit: number;
}
interface OrderSpec {
  branch: string;
  staff: string;
  channel: string;
  at: string;
  lines: LineSpec[];
  status?: 'completed' | 'cancelled' | 'ready' | 'sent_to_kitchen';
  paid?: boolean;
  guests?: number;
  payments?: { method: string; amount: number }[];
}

interface Fixture {
  org: TestOrg;
  dhanmondi: string;
  mirpur: string;
  manager: TestUser;
  accountant: TestUser;
  cashierUser: TestUser;
  staff: Record<string, string>;
  channels: { dine_in: string; takeaway: string; foodpanda: string };
  items: { kacchi: string; tea: string };
  vat: VatConfig;
}

async function one<T extends Row>(sql: string, params: unknown[]): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}

/** Insert a whole order with its lines and payments, decomposed by the shared money helper. */
async function insertOrder(fx: Fixture, spec: OrderSpec) {
  const dineIn = spec.channel === fx.channels.dine_in;
  const cfg = { ...fx.vat, serviceChargeBps: dineIn ? fx.vat.serviceChargeBps : 0 };
  const cancelled = spec.status === 'cancelled';
  const lines = spec.lines.map((l) => ({
    ...l,
    a: computeLine({ unitPricePoisha: l.unit, quantity: l.qty }, cfg),
  }));
  const t = sumLines(lines.map((l) => l.a));
  const id = randomUUID();
  await admin(
    `insert into public.orders (id, org_id, branch_id, channel_id, staff_id, order_status, payment_status, guests,
       placed_at, gross_poisha, discount_poisha, net_before_discount_poisha, discount_net_poisha, net_poisha,
       vat_poisha, service_charge_poisha, total_poisha, price_includes_vat, vat_rate_bps, service_charge_bps)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,0,$12,$13,$14,$15,$16,$17,$18)`,
    [
      id,
      fx.org.id,
      spec.branch,
      spec.channel,
      spec.staff,
      spec.status ?? 'completed',
      cancelled ? 'unpaid' : spec.paid === false ? 'unpaid' : 'paid',
      spec.guests ?? null,
      spec.at,
      t.grossPoisha,
      t.netBeforeDiscountPoisha,
      t.netPoisha,
      t.vatPoisha,
      t.serviceChargePoisha,
      t.totalPoisha,
      fx.vat.priceIncludesVat,
      fx.vat.vatRateBps,
      cfg.serviceChargeBps,
    ],
  );
  for (const l of lines) {
    await admin(
      `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, name_snapshot, quantity,
         unit_price_poisha, gross_poisha, net_before_discount_poisha, net_poisha, vat_poisha,
         service_charge_poisha, total_poisha, status, kot_sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        fx.org.id,
        spec.branch,
        id,
        l.item,
        'line',
        l.qty,
        l.unit,
        l.a.grossPoisha,
        l.a.netBeforeDiscountPoisha,
        l.a.netPoisha,
        l.a.vatPoisha,
        l.a.serviceChargePoisha,
        l.a.totalPoisha,
        cancelled ? 'voided' : 'active',
        spec.at,
      ],
    );
  }
  if (!cancelled && spec.paid !== false) {
    const pays = spec.payments ?? [{ method: 'cash', amount: t.totalPoisha }];
    for (const p of pays) {
      await admin(
        `insert into public.payments (org_id, branch_id, order_id, staff_id, method, amount_poisha, received_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [fx.org.id, spec.branch, id, spec.staff, p.method, p.amount, spec.at],
      );
    }
  }
  return { id, totals: t, lines };
}

async function fixture(vat: VatConfig): Promise<Fixture> {
  const org = await createOrg({ branches: ['Dhanmondi', 'Mirpur'] });
  const [dhanmondi, mirpur] = org.branchIds as [string, string];
  const manager = await addMember(org, 'manager', [dhanmondi]);
  const accountant = await addMember(org, 'accountant');
  const cashierUser = await addMember(org, 'cashier', [dhanmondi]);
  await admin(
    `update public.org_settings set price_includes_vat = $2, vat_rate_bps = $3, service_charge_bps = $4,
       vat_on_service_charge = $5 where org_id = $1`,
    [org.id, vat.priceIncludesVat, vat.vatRateBps, vat.serviceChargeBps, vat.vatOnServiceCharge],
  );
  const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;
  const channels = {
    dine_in: await id(
      `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
      [org.id],
    ),
    takeaway: await id(
      `insert into public.channels (org_id, name, kind) values ($1, 'Takeaway', 'takeaway') returning id`,
      [org.id],
    ),
    foodpanda: await id(
      `insert into public.channels (org_id, name, kind) values ($1, 'foodpanda', 'foodpanda') returning id`,
      [org.id],
    ),
  };
  await admin(
    `insert into public.channel_commissions (org_id, channel_id, commission_bps, fixed_fee_poisha, effective_from)
     values ($1, $2, 3000, 1000, '2026-01-01')`,
    [org.id, channels.foodpanda],
  );
  const items = {
    kacchi: await id(
      `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Kacchi', 30000) returning id`,
      [org.id],
    ),
    tea: await id(
      `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Tea', 3000) returning id`,
      [org.id],
    ),
  };
  const staff: Record<string, string> = {};
  for (const [key, branch, role] of [
    ['a', dhanmondi, 'cashier'],
    ['b', dhanmondi, 'cashier'],
    ['c', dhanmondi, 'cashier'],
    ['m', mirpur, 'cashier'],
  ] as const) {
    staff[key] = await id(
      `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, $3, $4) returning id`,
      [org.id, branch, `Staff ${key.toUpperCase()}`, role],
    );
  }
  return { org, dhanmondi, mirpur, manager, accountant, cashierUser, staff, channels, items, vat };
}

const q = <T extends Row = Row>(user: TestUser, sql: string, params: unknown[]) =>
  asUser(user, (s) => s.q<T>(sql, params));
const attempt = (user: TestUser, sql: string, params: unknown[]) =>
  asUser(user, (s) => s.attempt(sql, params));

// ---------------------------------------------------------------------------------------------
describe('sales metrics are exact', () => {
  let fx: Fixture;
  const expected = {
    dhanmondi: [] as ReturnType<typeof computeLine>[],
    mirpur: [] as ReturnType<typeof computeLine>[],
  };
  let splitOrder: Awaited<ReturnType<typeof insertOrder>>;
  let refundedOrder: Awaited<ReturnType<typeof insertOrder>>;

  beforeAll(async () => {
    fx = await fixture({
      priceIncludesVat: false,
      vatRateBps: 500,
      serviceChargeBps: 1000,
      vatOnServiceCharge: false,
    });
    const today = (t: string) => dhaka('2026-09-21', t);
    // Dhanmondi: a dine-in (service charge), a split-tender foodpanda order, a cancelled order.
    const o1 = await insertOrder(fx, {
      branch: fx.dhanmondi,
      staff: fx.staff.a!,
      channel: fx.channels.dine_in,
      at: today('13:00'),
      guests: 3,
      lines: [
        { item: fx.items.kacchi, qty: 2, unit: 30000 },
        { item: fx.items.tea, qty: 3, unit: 3000 },
      ],
    });
    splitOrder = await insertOrder(fx, {
      branch: fx.dhanmondi,
      staff: fx.staff.b!,
      channel: fx.channels.foodpanda,
      at: today('20:00'),
      lines: [{ item: fx.items.kacchi, qty: 1, unit: 30000 }],
      payments: [
        { method: 'bkash', amount: 18900 },
        { method: 'cash', amount: 12600 },
      ],
    });
    await insertOrder(fx, {
      branch: fx.dhanmondi,
      staff: fx.staff.a!,
      channel: fx.channels.takeaway,
      at: today('21:00'),
      status: 'cancelled',
      lines: [{ item: fx.items.kacchi, qty: 5, unit: 30000 }],
    });
    // Mirpur: one takeaway, later partly refunded.
    refundedOrder = await insertOrder(fx, {
      branch: fx.mirpur,
      staff: fx.staff.m!,
      channel: fx.channels.takeaway,
      at: today('12:00'),
      lines: [{ item: fx.items.tea, qty: 10, unit: 3000 }],
    });
    await admin(
      `insert into public.refunds (org_id, branch_id, order_id, method, amount_poisha, created_at)
       values ($1, $2, $3, 'cash', 10500, $4)`,
      [fx.org.id, fx.mirpur, refundedOrder.id, today('22:00')],
    );
    expected.dhanmondi = [...o1.lines.map((l) => l.a), ...splitOrder.lines.map((l) => l.a)];
    expected.mirpur = refundedOrder.lines.map((l) => l.a);
  });

  it('sales.* per branch and in total match the decomposition, with refunds net of VAT', async () => {
    const rows = await q(fx.org.owner, 'select * from public.metric_sales($1, null, $2, $2)', [
      fx.org.id,
      '2026-09-21',
    ]);
    const byBranch = new Map(rows.map((r) => [r.branch_id as string | null, r]));
    const d = sumLines(expected.dhanmondi);
    const m = sumLines(expected.mirpur);
    const dh = byBranch.get(fx.dhanmondi)!;
    expect(n(dh.orders_completed)).toBe(2);
    expect(n(dh.orders_cancelled)).toBe(1);
    expect(n(dh.gross_poisha)).toBe(d.netBeforeDiscountPoisha);
    expect(n(dh.net_poisha)).toBe(d.netPoisha);
    expect(n(dh.vat_poisha)).toBe(d.vatPoisha);
    expect(n(dh.service_charge_poisha)).toBe(d.serviceChargePoisha);
    expect(n(dh.total_poisha)).toBe(d.totalPoisha);
    expect(n(dh.covers)).toBe(3);
    expect(n(dh.aov_poisha)).toBe(Math.round(d.netPoisha / 2));

    // ৳105 refunded on a ৳315 order (৳300 net): the VAT-exclusive share, ৳100, comes off sales.net.
    const mi = byBranch.get(fx.mirpur)!;
    expect(n(mi.refunds_poisha)).toBe(Math.round((10500 * m.netPoisha) / m.totalPoisha));
    expect(n(mi.net_poisha)).toBe(m.netPoisha - 10000);

    const total = byBranch.get(null)!;
    expect(n(total.net_poisha)).toBe(d.netPoisha + m.netPoisha - 10000);
    expect(n(total.orders_completed)).toBe(3);
  });

  it('splits by channel and by payment method (split tenders shared pro rata)', async () => {
    const channels = await q(
      fx.org.owner,
      `select * from public.metric_sales_split($1, $2, '2026-09-21', '2026-09-21', 'channel')`,
      [fx.org.id, fx.dhanmondi],
    );
    const ch = Object.fromEntries(channels.map((r) => [r.key, n(r.net_poisha)]));
    expect(ch).toEqual({
      dine_in: sumLines(expected.dhanmondi.slice(0, 2)).netPoisha,
      foodpanda: splitOrder.totals.netPoisha,
    });
    const methods = await q(
      fx.org.owner,
      `select * from public.metric_sales_split($1, $2, '2026-09-21', '2026-09-21', 'payment_method')`,
      [fx.org.id, fx.dhanmondi],
    );
    const pm = Object.fromEntries(methods.map((r) => [r.key, n(r.net_poisha)]));
    // foodpanda order: ৳300 net paid 60% bKash / 40% cash.
    expect(pm.bkash).toBe(18000);
    expect(pm.cash).toBe(12000 + sumLines(expected.dhanmondi.slice(0, 2)).netPoisha);
  });

  it('a manager sees only their branch; another branch is refused', async () => {
    const rows = await q(fx.manager, 'select * from public.metric_sales($1, null, $2, $2)', [
      fx.org.id,
      '2026-09-21',
    ]);
    expect(rows.map((r) => r.branch_id).sort()).toEqual([fx.dhanmondi, null].sort());
    const refused = await attempt(fx.manager, 'select * from public.metric_sales($1, $2, $3, $3)', [
      fx.org.id,
      fx.mirpur,
      '2026-09-21',
    ]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('42501');
  });

  it('another organization cannot read these metrics at all', async () => {
    const stranger = await createOrg({ branches: ['X'] });
    const refused = await attempt(
      stranger.owner,
      'select * from public.metric_sales($1, null, $2, $2)',
      [fx.org.id, '2026-09-21'],
    );
    expect(refused.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('item velocity windows at a frozen now', () => {
  let fx: Fixture;
  // [Dhaka date, Dhaka time, qty]. 2026-09-21 is a Monday; week starts Saturday; day starts 04:00.
  const sales: [string, string, number][] = [
    ['2026-09-21', '22:45', 1], // last 2h, today
    ['2026-09-21', '21:00', 2], // today only
    ['2026-09-22', '03:00', 0], // (placeholder, skipped: after now)
    ['2026-09-21', '03:00', 4], // 03:00 before the 04:00 cutoff: business day 20th = yesterday
    ['2026-09-20', '19:00', 8], // yesterday (Sunday) — in week-to-date
    ['2026-09-18', '19:00', 16], // Friday: last 7d, not week-to-date
    ['2026-09-02', '19:00', 32], // month-to-date, last 30d, not last 7d
    ['2026-08-25', '19:00', 64], // last 30d only
    ['2026-07-01', '19:00', 128], // none of them
  ];

  beforeAll(async () => {
    fx = await fixture({
      priceIncludesVat: true,
      vatRateBps: 500,
      serviceChargeBps: 0,
      vatOnServiceCharge: false,
    });
    for (const [date, time, qty] of sales) {
      if (qty === 0) continue;
      await insertOrder(fx, {
        branch: fx.dhanmondi,
        staff: fx.staff.a!,
        channel: fx.channels.takeaway,
        at: dhaka(date, time),
        lines: [{ item: fx.items.kacchi, qty, unit: 30000 }],
      });
    }
    // A cancelled order never counts.
    await insertOrder(fx, {
      branch: fx.dhanmondi,
      staff: fx.staff.a!,
      channel: fx.channels.takeaway,
      at: dhaka('2026-09-21', '22:50'),
      status: 'cancelled',
      lines: [{ item: fx.items.kacchi, qty: 256, unit: 30000 }],
    });
  });

  it.each([
    ['last_2h', 1],
    ['today', 3],
    ['yesterday', 12],
    ['week_to_date', 15],
    ['last_7d', 31],
    ['month_to_date', 63],
    ['last_30d', 127],
  ])('%s', async (window, qty) => {
    const rows = await q(
      fx.org.owner,
      'select * from public.metric_item_qty($1, $2, $3, $4, null, null, $5)',
      [fx.org.id, fx.dhanmondi, window, NOW, fx.items.kacchi],
    );
    expect(rows.reduce((s, r) => s + n(r.qty), 0)).toBe(qty);
  });

  it('custom windows are bounded and validated', async () => {
    const rows = await q(
      fx.org.owner,
      `select * from public.metric_item_qty($1, $2, 'custom', $3, '2026-07-01', '2026-07-01', $4)`,
      [fx.org.id, fx.dhanmondi, NOW, fx.items.kacchi],
    );
    expect(n(rows[0]?.qty)).toBe(128);
    const bad = await attempt(
      fx.org.owner,
      `select * from public.metric_item_qty($1, $2, 'custom', $3, '2026-09-10', '2026-09-01')`,
      [fx.org.id, fx.dhanmondi, NOW],
    );
    expect(bad.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('money metrics are owner/accountant only and add up', () => {
  let fx: Fixture;
  let fp: Awaited<ReturnType<typeof insertOrder>>;
  let dine: Awaited<ReturnType<typeof insertOrder>>;

  beforeAll(async () => {
    fx = await fixture({
      priceIncludesVat: true,
      vatRateBps: 500,
      serviceChargeBps: 0,
      vatOnServiceCharge: false,
    });
    await admin(
      `insert into public.org_cost_settings (org_id, assumed_food_cost_bps) values ($1, 3500)
       on conflict (org_id) do update set assumed_food_cost_bps = 3500`,
      [fx.org.id],
    );
    await admin(
      `insert into public.fixed_costs (org_id, branch_id, kind, monthly_poisha, effective_from)
       values ($1, $2, 'rent', 9000000, '2026-01-01')`,
      [fx.org.id, fx.dhanmondi],
    );
    await admin(
      `insert into public.salary_entries (org_id, branch_id, staff_id, month, salary_poisha, allowances_poisha)
       values ($1, $2, $3, '2026-09-01', 1800000, 300000)`,
      [fx.org.id, fx.dhanmondi, fx.staff.a],
    );
    fp = await insertOrder(fx, {
      branch: fx.dhanmondi,
      staff: fx.staff.a!,
      channel: fx.channels.foodpanda,
      at: dhaka('2026-09-21', '14:00'),
      lines: [{ item: fx.items.kacchi, qty: 3, unit: 42000 }],
    });
    dine = await insertOrder(fx, {
      branch: fx.dhanmondi,
      staff: fx.staff.b!,
      channel: fx.channels.dine_in,
      at: dhaka('2026-09-21', '15:00'),
      lines: [{ item: fx.items.kacchi, qty: 2, unit: 42000 }],
    });
  });

  it('a manager and a cashier are refused cost, commission and profit figures', async () => {
    for (const user of [fx.manager, fx.cashierUser]) {
      for (const sql of [
        `select * from public.metric_commission($1, null, '2026-09-21', '2026-09-21')`,
        `select * from public.metric_flash_pnl($1, null, '${NOW}')`,
        `select * from public.metric_staff_exceptions($1, null, '2026-09-21', '2026-09-21')`,
      ]) {
        const r = await attempt(user, sql, [fx.org.id]);
        expect(r.ok, sql).toBe(false);
      }
    }
    const acc = await attempt(
      fx.accountant,
      `select * from public.metric_flash_pnl($1, null, $2)`,
      [fx.org.id, NOW],
    );
    expect(acc.ok).toBe(true);
  });

  it('commission is rounded once per branch, channel and period, plus fixed fees per order', async () => {
    const [row] = await q(
      fx.org.owner,
      `select * from public.metric_commission($1, $2, '2026-09-21', '2026-09-21') where channel_kind = 'foodpanda'`,
      [fx.org.id, fx.dhanmondi],
    );
    expect(n(row!.net_poisha)).toBe(fp.totals.netPoisha);
    expect(n(row!.commission_poisha)).toBe(mulBps(fp.totals.netPoisha, 3000));
    expect(n(row!.fixed_fees_poisha)).toBe(1000);
    expect(n(row!.total_poisha)).toBe(mulBps(fp.totals.netPoisha, 3000) + 1000);
  });

  it('flash P&L: assumed COGS labelled, overheads per day, break-even from the trailing ratio', async () => {
    const rows = await q(fx.org.owner, 'select * from public.metric_flash_pnl($1, $2, $3)', [
      fx.org.id,
      fx.dhanmondi,
      NOW,
    ]);
    const r = rows.find((x) => x.branch_id === fx.dhanmondi)!;
    const net = fp.totals.netPoisha + dine.totals.netPoisha;
    const cogs = mulBps(net, 3500);
    const commission = mulBps(fp.totals.netPoisha, 3000) + 1000;
    const labour = Math.round(2100000 / 30); // September has 30 days
    const fixed = Math.round(9000000 / 30);
    expect(r.business_date).toBeDefined();
    expect(r.cogs_basis).toBe('assumed');
    expect(n(r.assumed_food_cost_bps)).toBe(3500);
    expect(n(r.net_poisha)).toBe(net);
    expect(n(r.cogs_poisha)).toBe(cogs);
    expect(n(r.commission_poisha)).toBe(commission);
    expect(n(r.labour_daily_poisha)).toBe(labour);
    expect(n(r.fixed_daily_poisha)).toBe(fixed);
    expect(n(r.estimated_profit_poisha)).toBe(net - cogs - commission - labour - fixed);
    // No trailing sales: the variable ratio falls back to the assumed food cost alone.
    expect(n(r.variable_ratio_bps)).toBe(3500);
    const breakeven = Math.round(((labour + fixed) * 10000) / (10000 - 3500));
    expect(n(r.breakeven_sales_poisha)).toBe(breakeven);
    expect(n(r.breakeven_remaining_poisha)).toBe(Math.max(0, breakeven - net));
  });
});

// ---------------------------------------------------------------------------------------------
describe('pace: today against the same weekday of the last four weeks', () => {
  it('uses only sales up to the same time of day', async () => {
    const fx = await fixture({
      priceIncludesVat: true,
      vatRateBps: 0,
      serviceChargeBps: 0,
      vatOnServiceCharge: false,
    });
    for (const date of ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']) {
      await insertOrder(fx, {
        branch: fx.dhanmondi,
        staff: fx.staff.a!,
        channel: fx.channels.takeaway,
        at: dhaka(date, '12:00'),
        lines: [{ item: fx.items.kacchi, qty: 1, unit: 40000 }],
      });
      // After 23:30 on those days: must not count toward "by this time".
      await insertOrder(fx, {
        branch: fx.dhanmondi,
        staff: fx.staff.a!,
        channel: fx.channels.takeaway,
        at: dhaka(date, '23:45'),
        lines: [{ item: fx.items.kacchi, qty: 1, unit: 99900 }],
      });
    }
    await insertOrder(fx, {
      branch: fx.dhanmondi,
      staff: fx.staff.a!,
      channel: fx.channels.takeaway,
      at: dhaka('2026-09-21', '12:00'),
      lines: [{ item: fx.items.kacchi, qty: 1, unit: 30000 }],
    });
    const [r] = await q(fx.manager, 'select * from public.metric_pace($1, $2, $3)', [
      fx.org.id,
      fx.dhanmondi,
      NOW,
    ]);
    expect(n(r!.today_net_poisha)).toBe(30000);
    expect(n(r!.typical_net_poisha)).toBe(40000);
    expect(n(r!.pace_bps)).toBe(7500);
    expect(r!.rag).toBe('red');
  });
});

// ---------------------------------------------------------------------------------------------
describe('leak detectors', () => {
  let fx: Fixture;
  const WEEK = [
    '2026-09-14',
    '2026-09-15',
    '2026-09-16',
    '2026-09-17',
    '2026-09-18',
    '2026-09-19',
    '2026-09-20',
  ];

  async function week(opts: {
    voidsByStaff: Record<string, number>;
    discountsByStaff?: Record<string, number>;
  }) {
    const fx_ = await fixture({
      priceIncludesVat: true,
      vatRateBps: 500,
      serviceChargeBps: 0,
      vatOnServiceCharge: false,
    });
    for (const key of ['a', 'b', 'c'] as const) {
      const voids = opts.voidsByStaff[key] ?? 0;
      const discounts = opts.discountsByStaff?.[key] ?? 0;
      for (let i = 0; i < 70; i++) {
        const o = await insertOrder(fx_, {
          branch: fx_.dhanmondi,
          staff: fx_.staff[key]!,
          channel: fx_.channels.dine_in,
          at: dhaka(WEEK[i % 7]!, `${String(11 + (i % 10)).padStart(2, '0')}:00`),
          lines: [{ item: fx_.items.kacchi, qty: 1, unit: 42000 }],
        });
        if (i < voids) {
          await admin(
            `insert into public.voids (org_id, branch_id, order_id, value_poisha, after_kot, voided_by_staff_id)
             values ($1, $2, $3, 20000, true, $4)`,
            [fx_.org.id, fx_.dhanmondi, o.id, fx_.staff[key]],
          );
        }
        if (i < discounts) {
          await admin(
            `insert into public.discounts (org_id, branch_id, order_id, amount_poisha, applied_by_staff_id)
             values ($1, $2, $3, 4200, $4)`,
            [fx_.org.id, fx_.dhanmondi, o.id, fx_.staff[key]],
          );
        }
      }
    }
    return fx_;
  }

  // The detectors themselves are private (only jobs reach them, through job_run_detectors).
  const detect = (f: Fixture) =>
    admin<Row>(
      `select * from private.detect_all($1, '2026-09-14', '2026-09-20', array['staff', 'cash_share', 'over_short', 'commission'])`,
      [f.org.id],
    );

  beforeAll(async () => {
    fx = await week({
      voidsByStaff: { a: 15, b: 1, c: 1 },
      discountsByStaff: { a: 2, b: 2, c: 2 },
    });
  });

  it('flags the cashier voiding far above their peers, with the excess in taka', async () => {
    const found = (await detect(fx)).filter((f) => f.type === 'void.after_kot');
    expect(found).toHaveLength(1);
    const f = found[0]!;
    expect(f.subject_key).toBe(fx.staff.a);
    // 15 × ৳200 minus the peers' ৳400 over 140 orders scaled to 70 orders = ৳3,000 − ৳200.
    expect(n(f.impact_poisha)).toBe(300000 - 20000);
    const ev = f.evidence as Record<string, unknown>;
    expect(n(ev.count)).toBe(15);
    expect(n(ev.peer_count)).toBe(2);
  });

  it('stays quiet when everyone voids and discounts at the same rate', async () => {
    const clean = await week({
      voidsByStaff: { a: 2, b: 2, c: 2 },
      discountsByStaff: { a: 3, b: 3, c: 3 },
    });
    expect(await detect(clean)).toEqual([]);
  });

  it('still flags a cashier whose peers never void at all', async () => {
    const lonely = await week({ voidsByStaff: { a: 8 } });
    const found = (await detect(lonely)).filter((f) => f.type === 'void.after_kot');
    expect(found.map((f) => f.subject_key)).toEqual([lonely.staff.a]);
    expect(n(found[0]!.impact_poisha)).toBe(8 * 20000);
  });

  it('saving is idempotent and keeps the owner’s decision; the workflow is owner-only and audited', async () => {
    const save = () =>
      asService(
        (s) =>
          s.q<{ n: number }>(
            `select public.job_run_detectors($1, '2026-09-14', '2026-09-20', array['staff']) as n`,
            [fx.org.id],
          ),
        { commit: true },
      );
    await save();
    const [finding] = await admin<{ id: string }>(
      `select id from public.findings where org_id = $1 and type = 'void.after_kot'`,
      [fx.org.id],
    );
    // The manager cannot even see findings (money, ADR 0007).
    const seen = await q(fx.manager, 'select id from public.findings where org_id = $1', [
      fx.org.id,
    ]);
    expect(seen).toEqual([]);
    const byManager = await attempt(
      fx.manager,
      `select public.set_finding_status($1, 'acknowledged')`,
      [finding!.id],
    );
    expect(byManager.ok).toBe(false);
    const noReason = await attempt(
      fx.org.owner,
      `select public.set_finding_status($1, 'dismissed')`,
      [finding!.id],
    );
    expect(noReason.ok).toBe(false);
    await asUser(
      fx.org.owner,
      (s) =>
        s.q(`select public.set_finding_status($1, 'acknowledged', 'checking CCTV')`, [finding!.id]),
      { commit: true },
    );

    await save();
    const rows = await admin<{ status: string; reason: string; evidence: number }>(
      `select f.status::text, f.reason,
              (select count(*)::int from public.finding_evidence e where e.finding_id = f.id) as evidence
         from public.findings f where f.org_id = $1 and f.type = 'void.after_kot'`,
      [fx.org.id],
    );
    expect(rows).toEqual([{ status: 'acknowledged', reason: 'checking CCTV', evidence: 1 }]);
    const [audit] = await admin<{ c: number }>(
      `select count(*)::int as c from public.audit_log where org_id = $1 and action = 'finding.status'`,
      [fx.org.id],
    );
    expect(audit!.c).toBe(1);
  });

  it('every finding links to its evidence rows; only owner/accountant can read them', async () => {
    const [finding] = await admin<{ id: string }>(
      `select id from public.findings where org_id = $1 and type = 'void.after_kot'`,
      [fx.org.id],
    );
    const rows = await q(fx.org.owner, 'select * from public.finding_events($1)', [finding!.id]);
    expect(rows).toHaveLength(15);
    expect(rows.every((r) => r.kind === 'void' && n(r.value_poisha) === 20000)).toBe(true);
    const byAccountant = await q(fx.accountant, 'select * from public.finding_events($1)', [
      finding!.id,
    ]);
    expect(byAccountant).toHaveLength(15);
    const byManager = await attempt(fx.manager, 'select * from public.finding_events($1)', [
      finding!.id,
    ]);
    expect(byManager.ok).toBe(false);
  });

  it('the owner can scan on demand; nobody else can', async () => {
    // "Now" in the week after the fixture week: the scan covers the four complete weeks before it.
    const scanned = await asUser(
      fx.org.owner,
      (s) =>
        s.q<{ n: number }>(`select public.scan_findings($1, '2026-09-22T12:00:00Z') as n`, [
          fx.org.id,
        ]),
      { commit: true },
    );
    expect(n(scanned[0]!.n)).toBeGreaterThanOrEqual(1);
    const [row] = await admin<{ c: number }>(
      `select count(*)::int as c from public.findings where org_id = $1 and type = 'void.after_kot'
          and period_start = '2026-09-12' and period_end = '2026-09-18'`,
      [fx.org.id],
    );
    expect(row!.c).toBe(1);
    const byManager = await attempt(fx.manager, `select public.scan_findings($1, $2)`, [
      fx.org.id,
      NOW,
    ]);
    expect(byManager.ok).toBe(false);
  });

  it('only the service role can run jobs', async () => {
    const byOwner = await attempt(
      fx.org.owner,
      `select public.job_run_detectors($1, '2026-09-14', '2026-09-20', array['staff'])`,
      [fx.org.id],
    );
    expect(byOwner.ok).toBe(false);
  });

  it('commission drag reports what the platform cost; cash shortages add up per closer', async () => {
    const f = await fixture({
      priceIncludesVat: true,
      vatRateBps: 500,
      serviceChargeBps: 0,
      vatOnServiceCharge: false,
    });
    const fp = await insertOrder(f, {
      branch: f.dhanmondi,
      staff: f.staff.a!,
      channel: f.channels.foodpanda,
      at: dhaka('2026-09-15', '20:00'),
      lines: [{ item: f.items.kacchi, qty: 4, unit: 42000 }],
    });
    for (const [date, overShort] of [
      ['2026-09-14', -40000],
      ['2026-09-16', -50000],
      ['2026-09-18', -30000],
      ['2026-09-19', 5000],
    ] as const) {
      await admin(
        `insert into public.shifts (org_id, branch_id, closed_by_staff_id, status, opened_at, closed_at, business_date,
           expected_cash_poisha, counted_cash_poisha, over_short_poisha)
         values ($1, $2, $3, 'closed', $4, $4, $5, 100000, 100000 + $6, $6)`,
        [f.org.id, f.dhanmondi, f.staff.b, dhaka(date, '22:00'), date, overShort],
      );
    }
    const found = await detect(f);
    const drag = found.find((x) => x.type === 'commission.drag')!;
    expect(n(drag.impact_poisha)).toBe(mulBps(fp.totals.netPoisha, 3000) + 1000);
    const short = found.find((x) => x.type === 'cash.over_short')!;
    expect(short.subject_key).toBe(f.staff.b);
    expect(n(short.impact_poisha)).toBe(115000);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the day close', () => {
  it('completes paid orders left in a kitchen state and runs the weekly detectors on the week’s last day', async () => {
    const fx = await fixture({
      priceIncludesVat: true,
      vatRateBps: 500,
      serviceChargeBps: 0,
      vatOnServiceCharge: false,
    });
    const paidReady = await insertOrder(fx, {
      branch: fx.dhanmondi,
      staff: fx.staff.a!,
      channel: fx.channels.takeaway,
      at: dhaka('2026-09-18', '13:00'),
      status: 'ready',
      lines: [{ item: fx.items.kacchi, qty: 1, unit: 42000 }],
    });
    const unpaid = await insertOrder(fx, {
      branch: fx.dhanmondi,
      staff: fx.staff.a!,
      channel: fx.channels.takeaway,
      at: dhaka('2026-09-18', '14:00'),
      status: 'sent_to_kitchen',
      paid: false,
      lines: [{ item: fx.items.kacchi, qty: 1, unit: 42000 }],
    });
    // Friday 18th: the week (Sat–Fri) ends here, since Saturday is the week start.
    const [r] = await asService(
      (s) =>
        s.q<{ r: Record<string, number> }>(
          `select public.job_close_business_day($1, '2026-09-18') as r`,
          [fx.org.id],
        ),
      { commit: true },
    );
    expect(r!.r.completed_orders).toBe(1);
    const statuses = await admin<{ id: string; order_status: string }>(
      `select id, order_status::text from public.orders where id = any($1::uuid[])`,
      [[paidReady.id, unpaid.id]],
    );
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.order_status]))).toEqual({
      [paidReady.id]: 'completed',
      [unpaid.id]: 'sent_to_kitchen',
    });
    // Running the close twice changes nothing.
    const [again] = await asService(
      (s) =>
        s.q<{ r: Record<string, number> }>(
          `select public.job_close_business_day($1, '2026-09-18') as r`,
          [fx.org.id],
        ),
      { commit: true },
    );
    expect(again!.r.completed_orders).toBe(0);
  });
});
