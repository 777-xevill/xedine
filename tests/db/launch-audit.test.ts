/**
 * Launch audit (ADR 0066): what the last review before the first restaurant found, each fix with its
 * numbers worked out by hand. Purchases must fall in the last 90 days, so dates are counted back from the
 * database's own business date.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, admin, asUser, closePool, createOrg, type TestOrg } from './harness';

afterAll(closePool);

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dhaka = (date: string, time = '13:00') => new Date(`${date}T${time}:00+06:00`).toISOString();

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}
const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;

interface Base {
  org: TestOrg;
  branch: string;
  channel: string;
  today: string;
}

async function base(): Promise<Base> {
  const org = await createOrg({ branches: ['Dhanmondi'] });
  const branch = org.branchIds[0]!;
  const channel = await id(
    `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
    [org.id],
  );
  const { today } = await one<{ today: string }>(
    `select private.business_date(now(), 240)::text as today`,
  );
  return { org, branch, channel, today };
}

async function ingredient(fx: Base, name: string, base: 'g' | 'ml' | 'pcs' = 'g') {
  return id(
    `insert into public.ingredients (org_id, name, base) values ($1, $2, $3) returning id`,
    [fx.org.id, name, base],
  );
}

async function dish(fx: Base, name: string, lines: { ingredient_id: string; qty_base: number }[]) {
  const item = await id(
    `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, $2, 40000) returning id`,
    [fx.org.id, name],
  );
  await asUser(
    fx.org.owner,
    (s) =>
      s.q(`select public.save_recipe($1, $2, null, $3, 1, $4::jsonb)`, [
        fx.org.id,
        item,
        name,
        JSON.stringify(lines),
      ]),
    { commit: true },
  );
  return item;
}

/** One paid, completed order with one line (the cost snapshot trigger runs on the line). */
async function sell(
  fx: Base,
  date: string,
  item: string,
  qty: number,
  variant: string | null = null,
): Promise<string> {
  const orderId = randomUUID();
  const net = 40000 * qty;
  await admin(
    `insert into public.orders (id, org_id, branch_id, channel_id, order_status, payment_status, placed_at,
       gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
     values ($1,$2,$3,$4,'completed','paid',$5,$6,$6,$6,$6,false,0)`,
    [orderId, fx.org.id, fx.branch, fx.channel, dhaka(date), net],
  );
  return id(
    `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, variant_id, name_snapshot, quantity,
       unit_price_poisha, gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, status)
     values ($1,$2,$3,$4,$5,'x',$6,40000,$7,$7,$7,$7,'active') returning id`,
    [fx.org.id, fx.branch, orderId, item, variant, qty, net],
  );
}

const lineCost = (lineId: string) =>
  one<{ unit: string; cost: string }>(
    `select unit_cost_poisha as unit, cost_poisha as cost from public.order_item_costs where order_item_id = $1`,
    [lineId],
  );

// ---------------------------------------------------------------------------------------------
describe('sizes take their share of the dish', () => {
  let fx: Base;
  let mutton: string;
  let kacchi: string;
  let half: string;
  let family: string;
  let lines: { full: string; half: string; family: string };

  beforeAll(async () => {
    fx = await base();
    mutton = await ingredient(fx, 'Mutton');
    // ৳110 a kg = 110 poisha a gram.
    await admin(
      `insert into public.ingredient_price_history (org_id, ingredient_id, effective_from, cost_poisha, per_base_qty)
       values ($1, $2, '2026-01-01', 110000, 1000)`,
      [fx.org.id, mutton],
    );
    kacchi = await dish(fx, 'Kacchi', [{ ingredient_id: mutton, qty_base: 200 }]);
    half = await id(
      `insert into public.item_variants (org_id, menu_item_id, name, price_delta_poisha, portion_bps)
       values ($1, $2, 'Half', -15000, 5000) returning id`,
      [fx.org.id, kacchi],
    );
    // A size with a recipe of its own uses that recipe, whatever its share says.
    family = await id(
      `insert into public.item_variants (org_id, menu_item_id, name, price_delta_poisha, portion_bps)
       values ($1, $2, 'Family', 60000, 30000) returning id`,
      [fx.org.id, kacchi],
    );
    await asUser(
      fx.org.owner,
      (s) =>
        s.q(`select public.save_recipe($1, $2, $3, 'Family kacchi', 1, $4::jsonb)`, [
          fx.org.id,
          kacchi,
          family,
          JSON.stringify([{ ingredient_id: mutton, qty_base: 500 }]),
        ]),
      { commit: true },
    );
    lines = {
      full: await sell(fx, fx.today, kacchi, 2),
      half: await sell(fx, fx.today, kacchi, 4, half),
      family: await sell(fx, fx.today, kacchi, 1, family),
    };
  });

  it('cost: full 200 g × 110 = ৳220; half ৳110; family its own 500 g = ৳550', async () => {
    expect(await lineCost(lines.full)).toEqual({ unit: '22000', cost: '44000' });
    expect(await lineCost(lines.half)).toEqual({ unit: '11000', cost: '44000' });
    expect(await lineCost(lines.family)).toEqual({ unit: '55000', cost: '55000' });
  });

  it('stock: 2 full + 4 half = 4 portions × 200 g, plus the family 500 g = 1,300 g used', async () => {
    const [moves] = await admin<{ qty: string }>(
      `select sum(qty) as qty from private.m_stock_moves($1, $2::uuid[], $3::date, $3::date) where kind = 'usage'`,
      [fx.org.id, `{${fx.branch}}`, fx.today],
    );
    expect(n(moves!.qty)).toBe(1300);
  });

  it('Stock → Used counts plates as sold and grams by portion', async () => {
    const rows = await asUser(fx.org.owner, (s) =>
      s.q<Row>(`select * from public.metric_stock_used($1, $2, $3, $3)`, [
        fx.org.id,
        fx.branch,
        fx.today,
      ]),
    );
    const total = rows.find((r) => r.ingredient_id === mutton && r.menu_item_id === null)!;
    const byDish = rows.find((r) => r.ingredient_id === mutton && r.menu_item_id === kacchi)!;
    expect(n(total.qty)).toBe(1300);
    expect({ dishes: n(byDish.dishes), qty: n(byDish.qty) }).toEqual({ dishes: 7, qty: 1300 });
  });
});

// ---------------------------------------------------------------------------------------------
describe('a voided or back-dated purchase re-prices the days after it', () => {
  let fx: Base;
  let beef: string;
  let tehari: string;
  let sale: string;
  let typo: string;
  const cost = (date: string) =>
    one<{ c: string | null }>(`select private.ingredient_unit_cost($1, $2, $3::date) as c`, [
      fx.org.id,
      beef,
      date,
    ]).then((r) => (r.c === null ? null : n(r.c)));
  const record = (date: string, qty: number, total: number) =>
    asUser(
      fx.org.owner,
      (s) =>
        s.q<{ id: string }>(
          `select public.record_purchase($1, $2, null, 'Kaptan Bazar', $3, $4::jsonb) as id`,
          [
            fx.org.id,
            fx.branch,
            date,
            JSON.stringify([{ ingredient_id: beef, qty_base: qty, line_total_poisha: total }]),
          ],
        ),
      { commit: true },
    ).then((r) => r[0]!.id);

  beforeAll(async () => {
    fx = await base();
    beef = await ingredient(fx, 'Beef');
    tehari = await dish(fx, 'Tehari', [{ ingredient_id: beef, qty_base: 100 }]);
    // Day −6: 10 kg typed as ৳1,000 (a typo, 10 a gram); day −4: 10 kg for ৳2,000 (20 a gram).
    typo = await record(addDays(fx.today, -6), 10000, 100000);
    await record(addDays(fx.today, -4), 10000, 200000);
    sale = await sell(fx, addDays(fx.today, -4), tehari, 3);
  });

  it('before the void the weighted price mixes the typo in: 300,000 ÷ 20,000 g = 15 a gram', async () => {
    expect(await cost(addDays(fx.today, -6))).toBe(10);
    expect(await cost(addDays(fx.today, -4))).toBe(15);
    expect(await lineCost(sale)).toEqual({ unit: '1500', cost: '4500' });
  });

  it('voiding the typo re-prices day −4 to 20 a gram and the sale it costed to ৳20 a plate', async () => {
    await asUser(
      fx.org.owner,
      (s) => s.q(`select public.void_purchase($1, 'typed ৳1,000 for ৳3,000')`, [typo]),
      { commit: true },
    );
    expect(await cost(addDays(fx.today, -6))).toBeNull();
    expect(await cost(addDays(fx.today, -4))).toBe(20);
    expect(await lineCost(sale)).toEqual({ unit: '2000', cost: '6000' });
  });

  it('a purchase entered late for day −5 re-prices day −4 too: (300,000 + 200,000) ÷ 20,000 g = 25', async () => {
    await record(addDays(fx.today, -5), 10000, 300000);
    expect(await cost(addDays(fx.today, -5))).toBe(30);
    expect(await cost(addDays(fx.today, -4))).toBe(25);
  });
});

// ---------------------------------------------------------------------------------------------
describe('salaries carry over to a month that has none yet', () => {
  let fx: Base;
  beforeAll(async () => {
    fx = await base();
    const staff = async (name: string, active: boolean) =>
      id(
        `insert into public.staff (org_id, branch_id, display_name, is_active) values ($1, $2, $3, $4) returning id`,
        [fx.org.id, fx.branch, name, active],
      );
    const pay = (staffId: string, month: string, poisha: number) =>
      admin(
        `insert into public.salary_entries (org_id, branch_id, staff_id, month, salary_poisha) values ($1, $2, $3, $4, $5)`,
        [fx.org.id, fx.branch, staffId, month, poisha],
      );
    const a = await staff('Rahim (still here)', true);
    const b = await staff('Karim (left)', false);
    const c = await staff('Salma (new in December)', true);
    await pay(a, '2026-11-01', 3_000_000);
    await pay(b, '2026-11-01', 1_500_000);
    await pay(c, '2026-12-01', 2_000_000);
  });

  const labour = (date: string) =>
    one<{ l: string }>(
      `select labour_daily_poisha as l from private.m_daily_overheads($1, $2::uuid[], $3::date) where branch_id = $4`,
      [fx.org.id, `{${fx.branch}}`, date, fx.branch],
    ).then((r) => n(r.l));

  it('November uses its entries: (৳30,000 + ৳15,000) ÷ 30 days', async () => {
    expect(await labour('2026-11-15')).toBe(150_000);
  });

  it('December: Rahim carries his November pay, Karim left, Salma has her own: ৳50,000 ÷ 31', async () => {
    expect(await labour('2026-12-10')).toBe(Math.round(5_000_000 / 31));
  });
});

// ---------------------------------------------------------------------------------------------
describe('cash shortages: the floor is per week of the period', () => {
  let fx: Base;
  let cashier: string;
  const W1 = '2026-09-14';
  beforeAll(async () => {
    fx = await base();
    cashier = await id(
      `insert into public.staff (org_id, branch_id, display_name) values ($1, $2, 'Rafiq') returning id`,
      [fx.org.id, fx.branch],
    );
    // Week 1: three shortages, net −৳1,150. Week 2: over by ৳850.
    for (const [day, overShort] of [
      [0, -40000],
      [2, -50000],
      [4, -30000],
      [5, 5000],
      [7, 30000],
      [9, 40000],
      [11, 10000],
      [12, 5000],
    ] as const) {
      const date = addDays(W1, day);
      await admin(
        `insert into public.shifts (org_id, branch_id, closed_by_staff_id, status, opened_at, closed_at, business_date,
           expected_cash_poisha, counted_cash_poisha, over_short_poisha)
         values ($1, $2, $3, 'closed', $4, $4, $5, 100000, 100000 + $6, $6)`,
        [fx.org.id, fx.branch, cashier, dhaka(date, '22:00'), date, overShort],
      );
    }
  });

  const found = (from: string, to: string) =>
    admin<Row>(
      `select * from private.detect_all($1, $2::date, $3::date, array['over_short']) where type = 'cash.over_short'`,
      [fx.org.id, from, to],
    );

  it('one week, ৳1,150 short ≥ ৳1,000: flagged', async () => {
    const rows = await found(W1, addDays(W1, 6));
    expect(rows).toHaveLength(1);
    expect(n(rows[0]!.impact_poisha)).toBe(115000);
  });

  it('two weeks, net ৳300 short < 2 × ৳1,000: quiet', async () => {
    expect(await found(W1, addDays(W1, 13))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('orders that went to the kitchen and were never paid (orders.left_unpaid)', () => {
  let fx: Base;
  let rafiq: string;
  const D = '2026-09-15';

  async function order(o: {
    status: string;
    payment: string;
    total: number;
    kot: boolean;
    paid?: number;
    staff?: string;
  }) {
    const orderId = randomUUID();
    await admin(
      `insert into public.orders (id, org_id, branch_id, channel_id, staff_id, order_status, payment_status, placed_at,
         gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9,$9,false,0)`,
      [
        orderId,
        fx.org.id,
        fx.branch,
        fx.channel,
        o.staff ?? rafiq,
        o.status,
        o.payment,
        dhaka(D, '20:00'),
        o.total,
      ],
    );
    await admin(
      `insert into public.order_items (org_id, branch_id, order_id, name_snapshot, quantity, unit_price_poisha,
         gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, status, kot_sent_at)
       values ($1,$2,$3,'Kacchi',1,$4,$4,$4,$4,$4,'active',$5)`,
      [fx.org.id, fx.branch, orderId, o.total, o.kot ? dhaka(D, '20:01') : null],
    );
    if (o.paid)
      await admin(
        `insert into public.payments (org_id, branch_id, order_id, method, amount_poisha) values ($1,$2,$3,'cash',$4)`,
        [fx.org.id, fx.branch, orderId, o.paid],
      );
  }

  beforeAll(async () => {
    fx = await base();
    rafiq = await id(
      `insert into public.staff (org_id, branch_id, display_name) values ($1, $2, 'Rafiq') returning id`,
      [fx.org.id, fx.branch],
    );
    await order({ status: 'served', payment: 'unpaid', total: 80000, kot: true }); // counts
    await order({
      status: 'served',
      payment: 'partially_paid',
      total: 90000,
      kot: true,
      paid: 30000,
    }); // ৳600 due
    await order({ status: 'cancelled', payment: 'unpaid', total: 70000, kot: true }); // cancelled: no
    await order({ status: 'completed', payment: 'paid', total: 50000, kot: true, paid: 50000 }); // paid: no
    await order({ status: 'open', payment: 'unpaid', total: 60000, kot: false }); // never cooked: no
  });

  it('two orders, ৳1,400 never collected, against the person who took them', async () => {
    const rows = await admin<Row>(
      `select * from private.detect_all($1, $2::date, $2::date, array['unpaid'])`,
      [fx.org.id, D],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'orders.left_unpaid', subject_key: rafiq });
    expect(n(rows[0]!.impact_poisha)).toBe(140000);
    expect(rows[0]!.evidence).toMatchObject({ orders: 2, due_poisha: 140000 });
  });

  it('the weekly scan saves it as a finding the owner sees', async () => {
    const manager = await addMember(fx.org, 'manager', [fx.branch]);
    await asUser(
      fx.org.owner,
      (s) => s.q(`select public.scan_findings($1, $2)`, [fx.org.id, dhaka('2026-09-26', '10:00')]),
      { commit: true },
    );
    const mine = await asUser(fx.org.owner, (s) =>
      s.q<Row>(`select type, impact_poisha from public.findings where org_id = $1`, [fx.org.id]),
    );
    expect(mine.map((f) => f.type)).toContain('orders.left_unpaid');
    // Findings carry ৳: managers do not read them (ADR 0007).
    const theirs = await asUser(manager, (s) =>
      s.q<Row>(`select type from public.findings where org_id = $1`, [fx.org.id]),
    );
    expect(theirs).toHaveLength(0);
  });
});
