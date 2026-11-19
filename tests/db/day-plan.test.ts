/**
 * The day plan (ADR 0066): party orders, "how busy?", the bazar list worked out again, the forecast's first
 * day, and the day's steps. Every figure is worked out by hand in the comments. The injected "today" is
 * Monday 6 July 2026; dishes sell at 13:00 Dhaka (lunch), so dayparts never split a day.
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

const T = '2026-07-06'; // Monday
const NOW = dhaka(T, '10:00');

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}
const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;

interface Fx {
  org: TestOrg;
  branch: string;
  channel: string;
}

async function base(): Promise<Fx> {
  const org = await createOrg({ branches: ['Dhanmondi'] });
  const branch = org.branchIds[0]!;
  const channel = await id(
    `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
    [org.id],
  );
  return { org, branch, channel };
}

const ingredient = (fx: Fx, name: string, base: 'g' | 'ml' | 'pcs' = 'g') =>
  id(
    `insert into public.ingredients (org_id, name, base, bazar_days, safety_stock_qty) values ($1, $2, $3, 1, 0) returning id`,
    [fx.org.id, name, base],
  );

async function dish(fx: Fx, name: string, lines: { ingredient_id: string; qty_base: number }[]) {
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

/** Plates of a dish (or one of its sizes) sold on a day, paid and completed. */
async function sell(
  fx: Fx,
  date: string,
  item: string,
  qty: number,
  opts: { variant?: string | null; time?: string } = {},
) {
  if (qty <= 0) return;
  const orderId = randomUUID();
  const net = 40000 * qty;
  await admin(
    `insert into public.orders (id, org_id, branch_id, channel_id, order_status, payment_status, placed_at,
       gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
     values ($1,$2,$3,$4,'completed','paid',$5,$6,$6,$6,$6,false,0)`,
    [orderId, fx.org.id, fx.branch, fx.channel, dhaka(date, opts.time ?? '13:00'), net],
  );
  await admin(
    `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, variant_id, name_snapshot, quantity,
       unit_price_poisha, gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, status)
     values ($1,$2,$3,$4,$5,'x',$6,40000,$7,$7,$7,$7,'active')`,
    [fx.org.id, fx.branch, orderId, item, opts.variant ?? null, qty, net],
  );
}

async function count(fx: Fx, date: string, lines: [string, number][]) {
  const c = await id(
    `insert into public.stock_counts (org_id, branch_id, counted_on, status, submitted_at)
     values ($1, $2, $3, 'submitted', $4) returning id`,
    [fx.org.id, fx.branch, date, dhaka(date, '23:50')],
  );
  for (const [ing, qty] of lines)
    await admin(
      `insert into public.stock_count_lines (org_id, branch_id, stock_count_id, ingredient_id, counted_qty_base)
       values ($1, $2, $3, $4, $5)`,
      [fx.org.id, fx.branch, c, ing, qty],
    );
}

async function bought(fx: Fx, date: string, ing: string, qty: number) {
  const p = await id(
    `insert into public.purchases (org_id, branch_id, purchased_on, status, total_poisha) values ($1, $2, $3, 'confirmed', 1000) returning id`,
    [fx.org.id, fx.branch, date],
  );
  await admin(
    `insert into public.purchase_lines (org_id, branch_id, purchase_id, ingredient_id, qty_base, line_total_poisha)
     values ($1, $2, $3, $4, $5, 1000)`,
    [fx.org.id, fx.branch, p, ing, qty],
  );
}

const generate = (user: TestUser, fx: Fx, date: string) =>
  asUser(
    user,
    (s) =>
      s.q<{ id: string }>(`select public.generate_bazar_list($1, $2, $3, $4) as id`, [
        fx.org.id,
        fx.branch,
        date,
        NOW,
      ]),
    { commit: true },
  ).then((r) => r[0]!.id);

const lines = (list: string) =>
  admin<Row>(`select * from public.bazar_list_lines where bazar_list_id = $1`, [list]);
const lineOf = async (list: string, ing: string) =>
  (await lines(list)).find((l) => l.ingredient_id === ing);

// ---------------------------------------------------------------------------------------------
describe('the bazar list, worked out again', () => {
  let fx: Fx;
  let manager: TestUser;
  let kacchi: string;
  let half: string;
  const ing: Record<string, string> = {};

  beforeAll(async () => {
    fx = await base();
    manager = await addMember(fx.org, 'manager', [fx.branch]);
    for (const [k, base] of [
      ['mutton', 'g'],
      ['rice', 'g'],
      ['oil', 'ml'],
      ['ghee', 'ml'],
    ] as const)
      ing[k] = await ingredient(fx, k, base);
    // One plate of kacchi: 100 g mutton, 150 g rice, 10 ml oil, 20 ml ghee.
    kacchi = await dish(fx, 'Kacchi', [
      { ingredient_id: ing.mutton!, qty_base: 100 },
      { ingredient_id: ing.rice!, qty_base: 150 },
      { ingredient_id: ing.oil!, qty_base: 10 },
      { ingredient_id: ing.ghee!, qty_base: 20 },
    ]);
    half = await id(
      `insert into public.item_variants (org_id, menu_item_id, name, price_delta_poisha, portion_bps)
       values ($1, $2, 'Half', -15000, 5000) returning id`,
      [fx.org.id, kacchi],
    );
    // 20 plates every day for four weeks; 5 so far this morning (09:00).
    for (let d = 28; d >= 1; d--) await sell(fx, addDays(T, -d), kacchi, 20);
    await sell(fx, T, kacchi, 5, { time: '09:00' });
    // Yesterday's closing count: mutton 4,000 g, rice 1,500 g. Oil and ghee were never counted:
    // bought 3 days ago (5,000 ml oil, 300 ml ghee).
    await count(fx, addDays(T, -1), [
      [ing.mutton!, 4000],
      [ing.rice!, 1500],
    ]);
    await bought(fx, addDays(T, -3), ing.oil!, 5000);
    await bought(fx, addDays(T, -3), ing.ghee!, 300);
  });

  // A usual day: 20 plates → mutton 2,000 g, rice 3,000 g, oil 200 ml, ghee 400 ml.
  // Used so far today (5 plates): mutton 500, rice 750 → the rest of today: mutton 1,500, rice 2,250.
  // Stock now: mutton 4,000 − 500 = 3,500; rice 1,500 − 750 = 750.

  it('a list for today needs only the rest of today: rice 2,250 − 750 = 1,500 → 2 kg (it was 3 kg: today counted twice)', async () => {
    const list = await generate(manager, fx, T);
    const rice = await lineOf(list, ing.rice!);
    expect({
      forecast: n(rice!.forecast_qty),
      stock: n(rice!.stock_qty),
      suggested: n(rice!.suggested_qty_base),
    }).toEqual({ forecast: 2250, stock: 750, suggested: 2000 });
    // Mutton: 1,500 needed, 3,500 on the shelf → not on the list.
    expect(await lineOf(list, ing.mutton!)).toBeUndefined();
  });

  it('a list for Wednesday takes out Tuesday: mutton 3,500 − 1,500 − 2,000 = 0 left → buy 2 kg (it said nothing)', async () => {
    const list = await generate(manager, fx, addDays(T, 2));
    const mutton = await lineOf(list, ing.mutton!);
    expect({ forecast: n(mutton!.forecast_qty), suggested: n(mutton!.suggested_qty_base) }).toEqual(
      {
        forecast: 2000,
        suggested: 2000,
      },
    );
  });

  it('never counted: the ≈ estimate, not an empty shelf (oil 5,000 − 65 plates × 10 = 4,350 ml covers tomorrow)', async () => {
    const list = await generate(manager, fx, addDays(T, 1));
    expect(await lineOf(list, ing.oil!)).toBeUndefined();
    // Ghee: 300 − 65 × 20 = −1,000 ≈ none left → tomorrow's 400 ml → 1 litre pack, marked as an estimate.
    const ghee = await lineOf(list, ing.ghee!);
    expect({
      stock: n(ghee!.stock_qty),
      estimated: ghee!.stock_estimated,
      suggested: n(ghee!.suggested_qty_base),
    }).toEqual({ stock: -1000, estimated: true, suggested: 1000 });
  });

  it('a party order is added on top: 30 full + 20 half = 40 portions → mutton +4,000 g tomorrow', async () => {
    const save = await asUser(
      manager,
      (s) =>
        s.q<{ id: string }>(
          `select public.save_planned_order($1, $2, null, $3, '12:30', 'Office lunch, Rahman & Co', null, $4::jsonb, $5) as id`,
          [
            fx.org.id,
            fx.branch,
            addDays(T, 1),
            JSON.stringify([
              { menu_item_id: kacchi, qty: 30 },
              { menu_item_id: kacchi, variant_id: half, qty: 20 },
            ]),
            NOW,
          ],
        ),
      { commit: true },
    );
    expect(save[0]!.id).toBeTruthy();
    const list = await generate(manager, fx, addDays(T, 1));
    const mutton = await lineOf(list, ing.mutton!);
    // Tomorrow: usual 2,000 + party 4,000; left at the start of tomorrow 3,500 − 1,500 = 2,000 → buy 4,000.
    expect({
      forecast: n(mutton!.forecast_qty),
      planned: n(mutton!.planned_qty),
      suggested: n(mutton!.suggested_qty_base),
    }).toEqual({ forecast: 6000, planned: 4000, suggested: 4000 });
    // What to cook tomorrow: 20 usual + 50 party plates (40 portions), the party part apart.
    const prep = await asUser(manager, (s) =>
      s.q<Row>(`select * from public.metric_prep_plan($1, $2, $3, $4)`, [
        fx.org.id,
        fx.branch,
        addDays(T, 1),
        NOW,
      ]),
    );
    expect({ portions: n(prep[0]!.portions), planned: n(prep[0]!.planned) }).toEqual({
      portions: 60,
      planned: 50,
    });
  });

  it('an item the list missed can be added; making the list again keeps it; it never tunes later lists', async () => {
    const list = await generate(manager, fx, addDays(T, 1));
    const added = await asUser(
      manager,
      (s) =>
        s.q<{ id: string }>(`select public.add_bazar_line($1, $2, 2000, $3) as id`, [
          list,
          ing.oil!,
          NOW,
        ]),
      { commit: true },
    );
    expect(added[0]!.id).toBeTruthy();
    const twice = await asUser(manager, (s) =>
      s.attempt(`select public.add_bazar_line($1, $2, 1000, $3)`, [list, ing.oil!, NOW]),
    );
    expect(twice.ok).toBe(false);
    await generate(manager, fx, addDays(T, 1));
    const oil = await lineOf(list, ing.oil!);
    expect({ hand: oil!.added_by_hand, qty: n(oil!.suggested_qty_base) }).toEqual({
      hand: true,
      qty: 2000,
    });
    await asUser(
      manager,
      (s) =>
        s.q(`select public.approve_bazar_list($1, $2::jsonb)`, [
          list,
          JSON.stringify([{ line_id: oil!.id, qty_base: 3000 }]),
        ]),
      { commit: true },
    );
    const tuned = await admin(
      `select 1 from public.bazar_tuning where org_id = $1 and ingredient_id = $2`,
      [fx.org.id, ing.oil!],
    );
    expect(tuned).toHaveLength(0);
  });

  it("a list approved for tomorrow is counted in Wednesday's: mutton 0 left + 4,000 bought tomorrow", async () => {
    // Wednesday again, now that tomorrow's list (4,000 g mutton) is approved and tomorrow has the party:
    // left = max(3,500 − 1,500 − 6,000, 0) + 4,000 = 4,000 ≥ Wednesday's 2,000 → nothing to buy.
    const list = await generate(manager, fx, addDays(T, 2));
    expect(await lineOf(list, ing.mutton!)).toBeUndefined();
  });

  it('the day plan: steps for today and where they stand', async () => {
    await admin(`update public.compliance_checks set is_active = false where org_id = $1`, [
      fx.org.id,
    ]);
    await admin(
      `insert into public.compliance_checks (org_id, name, frequency, starts_on) values ($1, 'Fridge below 5°C', 'daily', '2026-01-01')`,
      [fx.org.id],
    );
    const steps = await asUser(manager, (s) =>
      s.q<{ step: string; state: string; n: number; info: Row | null }>(
        `select * from public.metric_day_plan($1, $2, $3, $4)`,
        [fx.org.id, fx.branch, T, NOW],
      ),
    );
    const by = Object.fromEntries(steps.map((s) => [s.step, { state: s.state, n: s.n }]));
    expect(by).toEqual({
      party_orders: { state: 'none', n: 0 },
      use_first: { state: 'none', n: 0 },
      // Rice: 750 g left, 3,000 g a day → under 3 days of cover.
      running_low: { state: 'attention', n: by.running_low!.n },
      checks: { state: 'todo', n: 1 },
      // Today's draft: rice and ghee.
      bazar: { state: 'todo', n: 2 },
      unpaid: { state: 'none', n: 0 },
      cash_close: { state: 'none', n: 0 },
      waste: { state: 'later', n: 0 },
      tomorrow_bazar: { state: 'done', n: 1 },
    });
    expect(by.running_low!.n).toBeGreaterThanOrEqual(1);
    // Tomorrow has the party order and no closing steps.
    const tomorrow = await asUser(manager, (s) =>
      s.q<{ step: string; state: string; n: number }>(
        `select * from public.metric_day_plan($1, $2, $3, $4)`,
        [fx.org.id, fx.branch, addDays(T, 1), NOW],
      ),
    );
    expect(tomorrow.map((s) => s.step)).toEqual([
      'party_orders',
      'use_first',
      'running_low',
      'checks',
      'bazar',
    ]);
    expect(tomorrow[0]).toMatchObject({ state: 'info', n: 1 });
    // Tomorrow's approved list: mutton, rice, ghee and the oil added by hand.
    expect(tomorrow[4]).toMatchObject({ state: 'todo', n: 4 });
  });
});

// ---------------------------------------------------------------------------------------------
describe('party orders: who may write them', () => {
  let fx: Fx;
  let item: string;
  beforeAll(async () => {
    fx = await base();
    const rice = await ingredient(fx, 'Rice');
    item = await dish(fx, 'Polao', [{ ingredient_id: rice, qty_base: 150 }]);
  });

  const save = (user: TestUser, date = addDays(T, 3)) =>
    asUser(
      user,
      (s) =>
        s.attempt<{ id: string }>(
          `select public.save_planned_order($1, $2, null, $3, null, 'Wedding', 'Biye bari', $4::jsonb, $5) as id`,
          [fx.org.id, fx.branch, date, JSON.stringify([{ menu_item_id: item, qty: 60 }]), NOW],
        ),
      { commit: true },
    );

  it('owner and manager save; cashier and kitchen read only; no past days', async () => {
    const manager = await addMember(fx.org, 'manager', [fx.branch]);
    const cashier = await addMember(fx.org, 'cashier', [fx.branch]);
    const kitchen = await addMember(fx.org, 'kitchen', [fx.branch]);
    const ok = await save(manager);
    expect(ok.ok).toBe(true);
    expect((await save(cashier)).ok).toBe(false);
    expect((await save(kitchen)).ok).toBe(false);
    expect((await save(fx.org.owner, addDays(T, -1))).ok).toBe(false);
    const seen = await asUser(kitchen, (s) =>
      s.q<Row>(`select title from public.planned_orders where org_id = $1`, [fx.org.id]),
    );
    expect(seen.map((r) => r.title)).toEqual(['Wedding']);
    const direct = await asUser(fx.org.owner, (s) =>
      s.attempt(
        `insert into public.planned_orders (org_id, branch_id, for_date, title) values ($1, $2, $3, 'x')`,
        [fx.org.id, fx.branch, addDays(T, 3)],
      ),
    );
    expect(direct.ok).toBe(false);
    // Cancelled by the manager, audited.
    const orderId = (ok as { rows: { id: string }[] }).rows[0]!.id;
    await asUser(
      manager,
      (s) => s.q(`select public.set_planned_order_status($1, 'cancelled')`, [orderId]),
      { commit: true },
    );
    const audit = await admin<{ action: string }>(
      `select action from public.audit_log where org_id = $1 and entity = 'planned_order' order by created_at`,
      [fx.org.id],
    );
    expect(audit.map((a) => a.action)).toEqual(['planned_order.save', 'planned_order.status']);
  });
});

// ---------------------------------------------------------------------------------------------
describe('a new restaurant: the first days and "how busy?"', () => {
  let fx: Fx;
  let manager: TestUser;
  let kacchi: string;
  const forecastFor = (date: string) =>
    admin<{ model_qty: string; naive_qty: string; expect: string }>(
      `select sum(model_qty) as model_qty, sum(naive_qty) as naive_qty, max(expect) as expect
         from private.m_forecast($1, $2::uuid[], $3::date, $3::date, $4::date)`,
      [fx.org.id, `{${fx.branch}}`, date, T],
    ).then((r) => r[0]!);

  beforeAll(async () => {
    fx = await base();
    manager = await addMember(fx.org, 'manager', [fx.branch]);
    const mutton = await ingredient(fx, 'Mutton');
    kacchi = await dish(fx, 'Kacchi', [{ ingredient_id: mutton, qty_base: 100 }]);
    // The restaurant opened last Monday and sold 20 plates that day.
    await sell(fx, addDays(T, -7), kacchi, 20);
  });

  it('days before the first sale are unknown, not zero: Monday is 20 (it was 4 × 20 ÷ 10 = 8)', async () => {
    const f = await forecastFor(T);
    expect({ model: n(f.model_qty), naive: n(f.naive_qty) }).toEqual({ model: 20, naive: 20 });
  });

  it('"a big match, a bit busier": the manager says +30% for next Monday → 26 plates', async () => {
    const next = addDays(T, 7);
    const told = await asUser(
      manager,
      (s) =>
        s.attempt(
          `select public.add_special_day($1, 'cricket', $2, $2, 'Final', null, 13000, false, $3)`,
          [fx.org.id, next, NOW],
        ),
      { commit: true },
    );
    expect(told.ok).toBe(true);
    const f = await forecastFor(next);
    expect({ model: n(f.model_qty), expect: n(f.expect) }).toEqual({ model: 26, expect: 1.3 });
    // The model has no accuracy record yet, so the page shows last week × the expectation.
    const shown = await asUser(manager, (s) =>
      s.q<{ qty: string; model_shown: boolean }>(
        `select * from public.metric_forecast($1, $2, $3, $4)`,
        [fx.org.id, fx.branch, next, NOW],
      ),
    );
    expect({ qty: n(shown[0]!.qty), model: shown[0]!.model_shown }).toEqual({
      qty: 26,
      model: false,
    });
  });

  it('only the owner closes the restaurant; managers tell about yesterday to two months ahead', async () => {
    const day = addDays(T, 3);
    const close = (user: TestUser) =>
      asUser(
        user,
        (s) =>
          s.attempt(
            `select public.add_special_day($1, 'holiday', $2, $2, 'Closed', null, null, true, $3)`,
            [fx.org.id, day, NOW],
          ),
        { commit: true },
      );
    expect((await close(manager)).ok).toBe(false);
    expect((await close(fx.org.owner)).ok).toBe(true);
    expect(n((await forecastFor(day)).model_qty)).toBe(0);
    const far = await asUser(manager, (s) =>
      s.attempt(
        `select public.add_special_day($1, 'custom', $2, $2, 'Mela', null, 11500, false, $3)`,
        [fx.org.id, addDays(T, 90), NOW],
      ),
    );
    expect(far.ok).toBe(false);
  });

  it('a delivered party order is taken out of the history: last Monday 20 − 10 party = 10 usual', async () => {
    await admin(
      `with o as (insert into public.planned_orders (org_id, branch_id, for_date, title, status)
                  values ($1, $2, $3, 'Birthday', 'done') returning id)
       insert into public.planned_order_lines (org_id, branch_id, planned_order_id, menu_item_id, qty)
       select $1, $2, o.id, $4, 10 from o`,
      [fx.org.id, fx.branch, addDays(T, -7), kacchi],
    );
    expect(n((await forecastFor(T)).model_qty)).toBe(10);
  });
});

// ---------------------------------------------------------------------------------------------
describe('half plates in the bazar list', () => {
  it('10 full + 10 half a day = 15 portions × 200 g chicken = 3 kg a day (it said 4 kg)', async () => {
    const fx = await base();
    const chicken = await ingredient(fx, 'Chicken');
    const biryani = await dish(fx, 'Biryani', [{ ingredient_id: chicken, qty_base: 200 }]);
    const half = await id(
      `insert into public.item_variants (org_id, menu_item_id, name, price_delta_poisha, portion_bps)
       values ($1, $2, 'Half', -10000, 5000) returning id`,
      [fx.org.id, biryani],
    );
    for (let d = 28; d >= 1; d--) {
      await sell(fx, addDays(T, -d), biryani, 10);
      await sell(fx, addDays(T, -d), biryani, 10, { variant: half });
    }
    await count(fx, addDays(T, -1), [[chicken, 3000]]);
    // Tomorrow: 3,000 g; today's rest 3,000 g from the 3,000 g on the shelf → 0 left → buy 3 kg.
    const list = await generate(fx.org.owner, fx, addDays(T, 1));
    const line = await lineOf(list, chicken);
    expect({ forecast: n(line!.forecast_qty), suggested: n(line!.suggested_qty_base) }).toEqual({
      forecast: 3000,
      suggested: 3000,
    });
  });
});
