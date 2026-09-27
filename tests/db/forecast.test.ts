/**
 * Phase 7 forecasting and the bazar list (METRICS.md "Forecasting"; ADR 0020). Expected figures are worked
 * out by hand. Each fixture keeps every trading day's total the same, so the salary-week factor is exactly 1
 * and the arithmetic stays visible. All orders are at 13:00 Dhaka — the lunch daypart.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  admin,
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

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}
const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;

interface Fx {
  org: TestOrg;
  branch: string;
  channel: string;
  items: Record<string, string>;
  mutton: string;
}

async function fixture(itemNames: string[]): Promise<Fx> {
  const org = await createOrg({ branches: ['Dhanmondi'] });
  const branch = org.branchIds[0]!;
  const channel = await id(
    `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
    [org.id],
  );
  const mutton = await id(
    `insert into public.ingredients (org_id, name, base) values ($1, 'Mutton', 'g') returning id`,
    [org.id],
  );
  await admin(
    `insert into public.ingredient_price_history (org_id, ingredient_id, effective_from, cost_poisha, per_base_qty)
     values ($1, $2, '2026-01-01', 110000, 1000)`,
    [org.id, mutton],
  );
  const items: Record<string, string> = {};
  for (const name of itemNames) {
    items[name] = await id(
      `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, $2, 40000) returning id`,
      [org.id, name],
    );
    await asUser(
      org.owner,
      (s) =>
        s.q(`select public.save_recipe($1, $2, null, $3, 1, $4::jsonb)`, [
          org.id,
          items[name],
          name,
          JSON.stringify([{ ingredient_id: mutton, qty_base: 100 }]),
        ]),
      { commit: true },
    );
  }
  return { org, branch, channel, items, mutton };
}

async function sell(fx: Fx, date: string, item: string, qty: number) {
  if (qty <= 0) return;
  const orderId = randomUUID();
  const net = 40000 * qty;
  await admin(
    `insert into public.orders (id, org_id, branch_id, channel_id, order_status, payment_status, placed_at,
       gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
     values ($1,$2,$3,$4,'completed','paid',$5,$6,$6,$6,$6,false,0)`,
    [orderId, fx.org.id, fx.branch, fx.channel, dhaka(date), net],
  );
  await admin(
    `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, name_snapshot, quantity, unit_price_poisha,
       gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, status)
     values ($1,$2,$3,$4,'x',$5,40000,$6,$6,$6,$6,'active')`,
    [fx.org.id, fx.branch, orderId, fx.items[item], qty, net],
  );
}

const forecastRows = (fx: Fx, from: string, to: string, asof: string | null = null) =>
  admin<{
    business_date: string;
    menu_item_id: string;
    daypart: string;
    model_qty: string;
    naive_qty: string;
    actual_qty: string | null;
  }>(
    `select business_date::text, menu_item_id, daypart, model_qty, naive_qty, actual_qty
       from private.m_forecast($1, $2::uuid[], $3::date, $4::date, $5::date)`,
    [fx.org.id, `{${fx.branch}}`, from, to, asof],
  );

// ---------------------------------------------------------------------------------------------
describe('forecast v1: weighted same weekday, comparable days only', () => {
  let fx: Fx;
  const D = '2026-06-29'; // a Monday; references 06-22, 06-15, 06-08, 06-01
  beforeAll(async () => {
    fx = await fixture(['Kacchi', 'Filler']);
    // Kacchi 12, 10, 8, 6 going back; Filler tops each day up to 30, so every day's total is equal.
    for (const [k, q] of [
      [1, 12],
      [2, 10],
      [3, 8],
      [4, 6],
    ] as const) {
      await sell(fx, addDays(D, -7 * k), 'Kacchi', q);
      await sell(fx, addDays(D, -7 * k), 'Filler', 30 - q);
    }
  });

  it('model = (4×12 + 3×10 + 2×8 + 1×6) ÷ 10 = 10; naive = last Monday = 12', async () => {
    const rows = await forecastRows(fx, D, D, D);
    const k = rows.find((r) => r.menu_item_id === fx.items.Kacchi && r.daypart === 'lunch')!;
    expect({ model: n(k.model_qty), naive: n(k.naive_qty), actual: k.actual_qty }).toEqual({
      model: 10,
      naive: 12,
      actual: null,
    });
  });

  it('a flagged reference day (hartal last Monday) is left out: (3×10 + 2×8 + 1×6) ÷ 6', async () => {
    await admin(
      `insert into public.calendar_events (org_id, name, kind, starts_on, ends_on) values ($1, 'Hartal', 'hartal', $2, $2)`,
      [fx.org.id, addDays(D, -7)],
    );
    const rows = await forecastRows(fx, D, D, D);
    const k = rows.find((r) => r.menu_item_id === fx.items.Kacchi)!;
    expect(n(k.model_qty)).toBe(8.67);
    await admin(`delete from public.calendar_events where org_id = $1`, [fx.org.id]);
  });

  it('a day the owner marked closed forecasts zero', async () => {
    await admin(
      `insert into public.calendar_events (org_id, name, kind, starts_on, ends_on, closed) values ($1, 'Eid', 'eid', $2, $2, true)`,
      [fx.org.id, D],
    );
    const rows = await forecastRows(fx, D, D, D);
    expect(rows.every((r) => n(r.model_qty) === 0)).toBe(true);
    await admin(`delete from public.calendar_events where org_id = $1`, [fx.org.id]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('accuracy: WAPE against the naive baseline decides whether the model is shown', () => {
  let fx: Fx;
  const MONDAYS = [
    '2026-06-01',
    '2026-06-08',
    '2026-06-15',
    '2026-06-22',
    '2026-06-29',
    '2026-07-06',
  ];
  beforeAll(async () => {
    fx = await fixture(['Kacchi', 'Filler']);
    // Kacchi alternates 10, 14, 10, 14…; Filler mirrors it so every Monday totals 24.
    for (const [i, d] of MONDAYS.entries()) {
      await sell(fx, d, 'Kacchi', i % 2 === 0 ? 10 : 14);
      await sell(fx, d, 'Filler', i % 2 === 0 ? 14 : 10);
    }
  });

  it('over the last two Mondays the model errs 2.4 a day per item and naive 4: WAPE 20% vs 33.3%, shown', async () => {
    // 06-29 (actual 10): refs 14,10,14,10 → 12.4; naive 14. 07-06 (actual 14): refs 10,14,10,14 → 11.6; naive 10.
    const [total] = await admin<Row>(
      `select * from private.m_forecast_accuracy($1, $2::uuid[], '2026-06-29', '2026-07-06') where branch_id is null`,
      [fx.org.id, `{${fx.branch}}`],
    );
    expect({
      actual: n(total!.actual_qty),
      model: n(total!.model_abs_error),
      naive: n(total!.naive_abs_error),
      wape: n(total!.wape_bps),
      naiveWape: n(total!.naive_wape_bps),
      improvement: n(total!.improvement_bps),
      shown: total!.is_shown,
    }).toEqual({
      actual: 48,
      model: 9.6,
      naive: 16,
      wape: 2000,
      naiveWape: 3333,
      improvement: 4000,
      shown: true,
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('prep plan and the bazar list, end to end', () => {
  let fx: Fx;
  let manager: TestUser;
  let kitchen: TestUser;
  let cashier: TestUser;
  const T = '2026-07-06'; // Monday: the injected "today"
  const NOW = dhaka(T, '10:00');
  const TUE = addDays(T, 1);
  beforeAll(async () => {
    fx = await fixture(['Kacchi']);
    manager = await addMember(fx.org, 'manager', [fx.branch]);
    kitchen = await addMember(fx.org, 'kitchen', [fx.branch]);
    cashier = await addMember(fx.org, 'cashier', [fx.branch]);
    // 50 kacchi every Tuesday for four weeks; a deg feeds 40; mutton safety stock 300 g, bought per kg.
    for (let k = 1; k <= 4; k++) await sell(fx, addDays(TUE, -7 * k), 'Kacchi', 50);
    await admin(
      `update public.recipes set batch_portions = 40, batch_unit = 'deg' where org_id = $1 and status = 'active'`,
      [fx.org.id],
    );
    await admin(`update public.ingredients set safety_stock_qty = 300 where id = $1`, [fx.mutton]);
    // Yesterday's closing count: 500 g of mutton.
    const c = await id(
      `insert into public.stock_counts (org_id, branch_id, counted_on, status, submitted_at) values ($1, $2, $3, 'submitted', $4) returning id`,
      [fx.org.id, fx.branch, addDays(T, -1), dhaka(addDays(T, -1), '23:50')],
    );
    await admin(
      `insert into public.stock_count_lines (org_id, branch_id, stock_count_id, ingredient_id, counted_qty_base) values ($1, $2, $3, $4, 500)`,
      [fx.org.id, fx.branch, c, fx.mutton],
    );
  });

  it('prep plan: 50 portions tomorrow → 2 degs, 5 kg mutton', async () => {
    const rows = await asUser(manager, (s) =>
      s.q<Row>('select * from public.metric_prep_plan($1, $2, $3, $4)', [
        fx.org.id,
        fx.branch,
        TUE,
        NOW,
      ]),
    );
    expect(rows).toHaveLength(1);
    expect({
      portions: n(rows[0]!.portions),
      batches: rows[0]!.batches,
      unit: rows[0]!.batch_unit,
    }).toEqual({
      portions: 50,
      batches: 2,
      unit: 'deg',
    });
    expect((rows[0]!.key_ingredients as Row[])[0]).toMatchObject({ name: 'Mutton', qty: 5000 });
  });

  it('draft: 5,000 g forecast + 300 g safety − 500 g in stock = 4,800 g → 5 kg packs', async () => {
    expect(
      (
        await asUser(cashier, (s) =>
          s.attempt('select public.generate_bazar_list($1, $2, $3, $4)', [
            fx.org.id,
            fx.branch,
            TUE,
            NOW,
          ]),
        )
      ).ok,
    ).toBe(false);
    const [{ id: list }] = (await asUser(
      kitchen,
      (s) =>
        s.q<{ id: string }>('select public.generate_bazar_list($1, $2, $3, $4) as id', [
          fx.org.id,
          fx.branch,
          TUE,
          NOW,
        ]),
      {
        commit: true,
      },
    )) as [{ id: string }];
    const [line] = await admin<Row>(
      `select * from public.bazar_list_lines where bazar_list_id = $1`,
      [list],
    );
    expect({
      forecast: n(line!.forecast_qty),
      stock: n(line!.stock_qty),
      safety: n(line!.safety_qty),
      suggested: n(line!.suggested_qty_base),
    }).toEqual({ forecast: 5000, stock: 500, safety: 300, suggested: 5000 });
    // Nobody writes a list directly.
    const direct = await asUser(fx.org.owner, (s) =>
      s.attempt(
        `insert into public.bazar_lists (org_id, branch_id, for_date) values ($1, $2, $3)`,
        [fx.org.id, fx.branch, addDays(T, 3)],
      ),
    );
    expect(direct.ok).toBe(false);
  });

  it('approve (with an edit that teaches the tuning) → send via the outbox → reconcile with the purchase', async () => {
    const list = (
      await one<{ id: string }>(`select id from public.bazar_lists where org_id = $1`, [fx.org.id])
    ).id;
    const [line] = await admin<{ id: string }>(
      `select id from public.bazar_list_lines where bazar_list_id = $1`,
      [list],
    );
    expect(
      (await asUser(kitchen, (s) => s.attempt('select public.approve_bazar_list($1)', [list]))).ok,
    ).toBe(false);
    await asUser(
      manager,
      (s) =>
        s.q('select public.approve_bazar_list($1, $2::jsonb)', [
          list,
          JSON.stringify([{ line_id: line!.id, qty_base: 6000 }]),
        ]),
      {
        commit: true,
      },
    );
    // 6,000 ÷ 5,000 − 1 = 20% → adjust 0.3 × 2,000 = 600 bps.
    const [tuning] = await admin<Row>(
      `select adjust_bps, samples from public.bazar_tuning where org_id = $1`,
      [fx.org.id],
    );
    expect(tuning).toEqual({ adjust_bps: 600, samples: 1 });

    const [sent] = await asUser(
      manager,
      (s) =>
        s.q<{ n: number }>('select public.send_bazar_list($1, $2::jsonb) as n', [
          list,
          JSON.stringify([
            { to_phone: '01711-111111', language: 'bn', body: 'খাসির মাংস ৬ কেজি' },
            { to_phone: 'not a phone', language: 'bn', body: 'x' },
          ]),
        ]),
      { commit: true },
    );
    expect(n(sent!.n)).toBe(1);
    const outbox = await admin<Row>(
      `select to_phone, template_key, status from public.message_outbox where org_id = $1`,
      [fx.org.id],
    );
    expect(outbox).toEqual([
      { to_phone: '+8801711111111', template_key: 'bazar_list', status: 'queued' },
    ]);

    // The purchaser bought 5.5 kg on the day.
    const p = await id(
      `insert into public.purchases (org_id, branch_id, purchased_on, status, total_poisha) values ($1, $2, $3, 'confirmed', 605000) returning id`,
      [fx.org.id, fx.branch, TUE],
    );
    await admin(
      `insert into public.purchase_lines (org_id, branch_id, purchase_id, ingredient_id, qty_base, line_total_poisha) values ($1, $2, $3, $4, 5500, 605000)`,
      [fx.org.id, fx.branch, p, fx.mutton],
    );
    const rec = await asUser(
      kitchen,
      (s) => s.q<Row>('select * from public.reconcile_bazar_list($1)', [list]),
      { commit: true },
    );
    expect(rec.map((r) => [n(r.approved_qty), n(r.purchased_qty), n(r.diff_qty)])).toEqual([
      [6000, 5500, -500],
    ]);
    const [l] = await admin<{ status: string }>(
      `select status::text from public.bazar_lists where id = $1`,
      [list],
    );
    expect(l!.status).toBe('reconciled');
  });
});

// ---------------------------------------------------------------------------------------------
describe('managers flag rain, hartal or cricket for yesterday, today or tomorrow', () => {
  it('only those kinds and days; the owner owns the rest of the calendar', async () => {
    const fx = await fixture(['Kacchi']);
    const manager = await addMember(fx.org, 'manager', [fx.branch]);
    const cashier = await addMember(fx.org, 'cashier', [fx.branch]);
    const NOW = dhaka('2026-07-06', '12:00');
    const flag = (u: TestUser, date: string, kind: string) =>
      asUser(
        u,
        (s) =>
          s.attempt('select public.flag_day($1, $2, $3::public.calendar_kind, $4)', [
            fx.org.id,
            date,
            kind,
            NOW,
          ]),
        {
          commit: true,
        },
      );
    expect((await flag(manager, '2026-07-06', 'weather')).ok).toBe(true);
    expect((await flag(manager, '2026-07-06', 'weather')).ok).toBe(true); // idempotent
    expect((await flag(manager, '2026-07-06', 'eid')).ok).toBe(false);
    expect((await flag(manager, '2026-07-09', 'hartal')).ok).toBe(false);
    expect((await flag(cashier, '2026-07-06', 'cricket')).ok).toBe(false);
    const rows = await admin(`select kind::text from public.calendar_events where org_id = $1`, [
      fx.org.id,
    ]);
    expect(rows).toEqual([{ kind: 'weather' }]);
    const direct = await asUser(manager, (s) =>
      s.attempt(
        `insert into public.calendar_events (org_id, name, kind, starts_on, ends_on) values ($1, 'x', 'holiday', '2026-07-10', '2026-07-10')`,
        [fx.org.id],
      ),
    );
    expect(direct.ok).toBe(false);
  });
});
