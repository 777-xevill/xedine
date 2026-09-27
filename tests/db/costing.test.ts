/**
 * Phase 3 costing (METRICS.md "Costing", "Menu engineering"; ADR 0016). Every expected figure below is
 * worked out by hand in the comments. Cost is money: managers and cashiers never see it (ADR 0007).
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
const NOW = '2026-09-21T17:30:00Z';
const dhaka = (date: string, time = '13:00') => new Date(`${date}T${time}:00+06:00`).toISOString();

interface Fx {
  org: TestOrg;
  branch: string;
  manager: TestUser;
  kitchen: TestUser;
  accountant: TestUser;
  staff: string;
  dineIn: string;
  foodpanda: string;
}

async function one<T extends Row>(sql: string, params: unknown[]): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}
const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;

async function fixture(vatBps: number): Promise<Fx> {
  const org = await createOrg({ branches: ['Dhanmondi'] });
  const branch = org.branchIds[0]!;
  const manager = await addMember(org, 'manager', [branch]);
  const kitchen = await addMember(org, 'kitchen', [branch]);
  const accountant = await addMember(org, 'accountant');
  await admin(
    `update public.org_settings set price_includes_vat = true, vat_rate_bps = $2, service_charge_bps = 0 where org_id = $1`,
    [org.id, vatBps],
  );
  const staff = await id(
    `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Cashier', 'cashier') returning id`,
    [org.id, branch],
  );
  const dineIn = await id(
    `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
    [org.id],
  );
  const foodpanda = await id(
    `insert into public.channels (org_id, name, kind) values ($1, 'foodpanda', 'foodpanda') returning id`,
    [org.id],
  );
  await admin(
    `insert into public.channel_commissions (org_id, channel_id, commission_bps, effective_from) values ($1, $2, 3000, '2026-01-01')`,
    [org.id, foodpanda],
  );
  return { org, branch, manager, kitchen, accountant, staff, dineIn, foodpanda };
}

const ingredient = async (
  fx: Fx,
  name: string,
  base: string,
  costPoisha: number,
  perBase: number,
) => {
  const ing = await id(
    `insert into public.ingredients (org_id, name, base) values ($1, $2, $3) returning id`,
    [fx.org.id, name, base],
  );
  await admin(
    `insert into public.ingredient_costs (ingredient_id, org_id, manual_cost_poisha, per_base_qty) values ($1, $2, $3, $4)`,
    [ing, fx.org.id, costPoisha, perBase],
  );
  // Price history back to the start of the year, so every fixture sale has a price on its day.
  await admin(
    `insert into public.ingredient_price_history (org_id, ingredient_id, effective_from, cost_poisha, per_base_qty)
     values ($1, $2, '2026-01-01', $3, $4)`,
    [fx.org.id, ing, costPoisha, perBase],
  );
  return ing;
};

const item = (fx: Fx, name: string, price: number) =>
  id(
    `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, $2, $3) returning id`,
    [fx.org.id, name, price],
  );

const saveRecipe = async (
  fx: Fx,
  menuItem: string | null,
  yieldPortions: number,
  lines: unknown[],
) =>
  (
    await asUser(
      fx.org.owner,
      (s) =>
        s.q<{ id: string }>(`select public.save_recipe($1, $2, null, $3, $4, $5::jsonb) as id`, [
          fx.org.id,
          menuItem,
          'recipe',
          yieldPortions,
          JSON.stringify(lines),
        ]),
      { commit: true },
    )
  )[0]!.id;

/** A completed, paid order of one line. Inserting the line fires the cost snapshot trigger. */
async function sell(
  fx: Fx,
  menuItem: string,
  qty: number,
  unitPrice: number,
  date: string,
  channel?: string,
) {
  const vat = n(
    (
      await one<{ v: number }>(
        'select vat_rate_bps as v from public.org_settings where org_id = $1',
        [fx.org.id],
      )
    ).v,
  );
  const gross = unitPrice * qty;
  const net = Math.round((gross * 10000) / (10000 + vat));
  const orderId = randomUUID();
  await admin(
    `insert into public.orders (id, org_id, branch_id, channel_id, staff_id, order_status, payment_status, placed_at,
       gross_poisha, net_before_discount_poisha, net_poisha, vat_poisha, total_poisha, price_includes_vat, vat_rate_bps)
     values ($1,$2,$3,$4,$5,'completed','paid',$6,$7,$8,$8,$9,$7,true,$10)`,
    [
      orderId,
      fx.org.id,
      fx.branch,
      channel ?? fx.dineIn,
      fx.staff,
      dhaka(date),
      gross,
      net,
      gross - net,
      vat,
    ],
  );
  await admin(
    `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, name_snapshot, quantity, unit_price_poisha,
       gross_poisha, net_before_discount_poisha, net_poisha, vat_poisha, total_poisha, status)
     values ($1,$2,$3,$4,'line',$5,$6,$7,$8,$8,$9,$7,'active')`,
    [fx.org.id, fx.branch, orderId, menuItem, qty, unitPrice, gross, net, gross - net],
  );
  return { orderId, net };
}

const ownerQ = (fx: Fx, sql: string, params: unknown[]) =>
  asUser(fx.org.owner, (s) => s.q<Row>(sql, params));
const attempt = (user: TestUser, sql: string, params: unknown[]) =>
  asUser(user, (s) => s.attempt(sql, params));

// ---------------------------------------------------------------------------------------------
describe('recipe cost: sub-recipes, yields and prices by date', () => {
  let fx: Fx;
  let beef: string;
  let tehari: string;
  let recipe: string;

  beforeAll(async () => {
    fx = await fixture(500);
    beef = await ingredient(fx, 'Beef', 'g', 70000, 1000); // 70 poisha/g
    const rice = await ingredient(fx, 'Rice', 'g', 10000, 1000); // 10 poisha/g
    const oil = await ingredient(fx, 'Oil', 'ml', 20000, 1000); // 20 poisha/ml
    const egg = await ingredient(fx, 'Egg', 'pcs', 1500, 1); // 1500 poisha/pc
    // Gravy: 500 ml oil (10,000) + 4 eggs (6,000) = 16,000 for 10 portions → 1,600 per portion.
    const gravy = await saveRecipe(fx, null, 10, [
      { ingredient_id: oil, qty_base: 500 },
      { ingredient_id: egg, qty_base: 4 },
    ]);
    tehari = await item(fx, 'Beef Tehari', 24000);
    // 150 g beef at 80% yield → 187.5 g × 70 = 13,125; rice 200 g × 10 = 2,000; gravy 1 portion = 1,600.
    recipe = await saveRecipe(fx, tehari, 1, [
      { ingredient_id: beef, qty_base: 150, yield_pct: 80 },
      { ingredient_id: rice, qty_base: 200 },
      { sub_recipe_id: gravy, qty_base: 1 },
    ]);
  });

  it('costs a portion from its lines, yields and sub-recipes: ৳167.25', async () => {
    const rows = await ownerQ(fx, 'select * from public.metric_recipe_costs($1, $2)', [
      fx.org.id,
      NOW,
    ]);
    const r = rows.find((x) => x.recipe_id === recipe)!;
    expect(n(r.unit_cost_poisha)).toBe(16725);
    expect(r.complete).toBe(true);
  });

  it('uses the ingredient price of the day asked about', async () => {
    await admin(
      `insert into public.ingredient_price_history (org_id, ingredient_id, effective_from, cost_poisha, per_base_qty)
       values ($1, $2, '2026-09-10', 90000, 1000)`,
      [fx.org.id, beef],
    );
    const at = async (date: string) =>
      n(
        (
          await one<{ c: string }>('select private.recipe_unit_cost($1, $2, $3) as c', [
            fx.org.id,
            recipe,
            date,
          ])
        ).c,
      );
    expect(Math.round(await at('2026-09-09'))).toBe(16725);
    // 187.5 g × 90 = 16,875 + 2,000 + 1,600.
    expect(Math.round(await at('2026-09-15'))).toBe(20475);
  });

  it('snapshots the cost at sale, in a table only the owner and accountant can read', async () => {
    const sale = await sell(fx, tehari, 2, 24000, '2026-09-15');
    const [snap] = await admin<Row>('select * from public.order_item_costs where order_id = $1', [
      sale.orderId,
    ]);
    expect(n(snap!.unit_cost_poisha)).toBe(20475);
    expect(n(snap!.cost_poisha)).toBe(40950);
    for (const user of [fx.manager, fx.kitchen]) {
      const seen = await asUser(user, (s) =>
        s.q('select * from public.order_item_costs where order_id = $1', [sale.orderId]),
      );
      expect(seen).toEqual([]);
    }
    const byAccountant = await asUser(fx.accountant, (s) =>
      s.q('select * from public.order_item_costs where order_id = $1', [sale.orderId]),
    );
    expect(byAccountant).toHaveLength(1);
    const refused = await attempt(fx.manager, 'select * from public.metric_recipe_costs($1, $2)', [
      fx.org.id,
      NOW,
    ]);
    expect(refused.ok).toBe(false);
  });

  it('a later recipe change never rewrites a past snapshot', async () => {
    const [before] = await admin<Row>(
      `select sum(cost_poisha) as c from public.order_item_costs where org_id = $1`,
      [fx.org.id],
    );
    await saveRecipe(fx, tehari, 1, [{ ingredient_id: beef, qty_base: 100 }]);
    const [after] = await admin<Row>(
      `select sum(cost_poisha) as c from public.order_item_costs where org_id = $1`,
      [fx.org.id],
    );
    expect(n(after!.c)).toBe(n(before!.c));
    const versions = await admin<{ status: string; version: number }>(
      `select status::text, version from public.recipes where org_id = $1 and menu_item_id = $2 order by version`,
      [fx.org.id, tehari],
    );
    expect(versions).toEqual([
      { status: 'archived', version: 1 },
      { status: 'active', version: 2 },
    ]);
  });

  it('only the owner saves recipes', async () => {
    for (const user of [fx.manager, fx.kitchen]) {
      const r = await attempt(
        user,
        `select public.save_recipe($1, $2, null, 'x', 1, '[{"ingredient_id": "${beef}", "qty_base": 1}]'::jsonb)`,
        [fx.org.id, tehari],
      );
      expect(r.ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('food cost, coverage and the menu engineering matrix', () => {
  let fx: Fx;
  const items: Record<string, string> = {};

  beforeAll(async () => {
    fx = await fixture(0); // no VAT: net = printed price, so the arithmetic stays visible
    // One ingredient at 1 poisha per gram: a recipe's grams are its cost in poisha.
    const x = await ingredient(fx, 'Everything', 'g', 1000, 1000);
    const spec: [string, number, number, number][] = [
      // key, price, cost, qty
      ['star', 50000, 10000, 100], // CM 400 per unit, popular
      ['plowhorse', 30000, 25000, 100], // CM 50, popular
      ['puzzle', 60000, 10000, 10], // CM 500, unpopular
      ['dog', 20000, 18000, 10], // CM 20, unpopular
    ];
    for (const [key, price, cost, qty] of spec) {
      items[key] = await item(fx, key, price);
      await saveRecipe(fx, items[key]!, 1, [{ ingredient_id: x, qty_base: cost }]);
      await sell(fx, items[key]!, qty, price, '2026-09-15');
    }
    items.unknown = await item(fx, 'unknown', 10000);
    await sell(fx, items.unknown!, 5, 10000, '2026-09-15');
    // The dog also sells on foodpanda, where 30% commission turns it negative: 200 − 180 − 60 = −40 a unit.
    await sell(fx, items.dog!, 20, 20000, '2026-09-16', fx.foodpanda);
  });

  it('TFC, TFC% and recipe coverage', async () => {
    const [total] = (
      await ownerQ(
        fx,
        `select * from public.metric_food_cost($1, null, '2026-09-15', '2026-09-15')`,
        [fx.org.id],
      )
    ).filter((r) => r.branch_id === null);
    // Costed net: 100×500 + 100×300 + 10×600 + 10×200 = ৳88,000; TFC 100×100 + 100×250 + 10×100 + 10×180 = ৳37,800.
    expect(n(total!.costed_net_poisha)).toBe(8800000);
    expect(n(total!.tfc_poisha)).toBe(3780000);
    expect(n(total!.tfc_pct_bps)).toBe(Math.round((3780000 * 10000) / 8800000));
    // Coverage: ৳88,000 of ৳88,500.
    expect(n(total!.coverage_bps)).toBe(Math.round((8800000 * 10000) / 8850000));
  });

  it('classifies Star, Plowhorse, Puzzle and Dog; an item without a recipe is unknown, never guessed', async () => {
    const rows = await ownerQ(
      fx,
      `select * from public.metric_menu_matrix($1, null, '2026-09-15', '2026-09-15')`,
      [fx.org.id],
    );
    const cls = Object.fromEntries(rows.map((r) => [r.menu_item_id, r.class]));
    expect(cls[items.star!]).toBe('star');
    expect(cls[items.plowhorse!]).toBe('plowhorse');
    expect(cls[items.puzzle!]).toBe('puzzle');
    expect(cls[items.dog!]).toBe('dog');
    expect(cls[items.unknown!]).toBe('unknown');
    const refused = await attempt(
      fx.manager,
      `select * from public.metric_menu_matrix($1, null, '2026-09-15', '2026-09-15')`,
      [fx.org.id],
    );
    expect(refused.ok).toBe(false);
  });

  it('simulates a new price and portion at the last 28 days’ volume', async () => {
    const [r] = await ownerQ(
      fx,
      'select * from public.metric_simulate_item($1, $2, 55000, 9000, $3)',
      [fx.org.id, items.star!, NOW],
    );
    expect(n(r!.current_cm_poisha)).toBe(40000);
    // ৳550 with a 90% portion: cost ৳90, CM ৳460; 100 sold in the window → +৳6,000.
    expect(n(r!.new_cost_poisha)).toBe(9000);
    expect(n(r!.new_cm_poisha)).toBe(46000);
    expect(n(r!.qty_28d)).toBe(100);
    expect(n(r!.cm_change_28d_poisha)).toBe(600000);
  });

  it('flags items above the target food cost and items that lose money on a platform', async () => {
    await admin(
      `insert into public.org_cost_settings (org_id, target_food_cost_bps) values ($1, 4000)
       on conflict (org_id) do update set target_food_cost_bps = 4000`,
      [fx.org.id],
    );
    const found = await admin<Row>(
      `select * from private.detect_all($1, '2026-09-15', '2026-09-16', array['margin'])`,
      [fx.org.id],
    );
    const below = found.filter((f) => f.type === 'margin.below_target');
    // Plowhorse: cost ৳25,000 on ৳30,000 net vs a 40% target (৳12,000) → ৳13,000 above target.
    const plow = below.find((f) => f.subject_key === items.plowhorse)!;
    expect(n(plow.impact_poisha)).toBe(1300000);
    // Dog: 30 units, ৳6,000 net, ৳5,400 cost vs ৳2,400 target → ৳3,000.
    expect(n(below.find((f) => f.subject_key === items.dog)!.impact_poisha)).toBe(300000);
    expect(below.some((f) => f.subject_key === items.star)).toBe(false);
    const neg = found.filter((f) => f.type === 'channel.negative_margin');
    expect(neg).toHaveLength(1);
    // 20 units on foodpanda: ৳3,600 cost + ৳1,200 commission − ৳4,000 net = ৳800 lost.
    expect(neg[0]!.subject_key).toBe(`${items.dog}:${fx.foodpanda}`);
    expect(n(neg[0]!.impact_poisha)).toBe(80000);
  });
});

// ---------------------------------------------------------------------------------------------
describe('AI recipe drafts never become active without the owner’s approval', () => {
  let fx: Fx;
  let dish: string;
  let draft: string;

  beforeAll(async () => {
    fx = await fixture(500);
    dish = await item(fx, 'Chicken Roast', 12000);
    draft = (
      await asUser(
        fx.kitchen,
        (s) =>
          s.q<{ id: string }>(
            `insert into public.recipe_drafts (org_id, menu_item_id, item_name, payload, model)
             values ($1, $2, 'Chicken Roast', $3::jsonb, 'mock') returning id`,
            [
              fx.org.id,
              dish,
              JSON.stringify({
                yield_portions: 1,
                lines: [
                  { ingredient: 'Chicken', base: 'g', qty_base: 250, yield_pct: 70 },
                  { ingredient: 'Ghee', base: 'ml', qty_base: 20 },
                ],
              }),
            ],
          ),
        { commit: true },
      )
    )[0]!.id;
  });

  it('the kitchen can write drafts but not recipes, and cannot approve', async () => {
    const direct = await attempt(
      fx.kitchen,
      `insert into public.recipes (org_id, menu_item_id, status, approved_at) values ($1, $2, 'active', now())`,
      [fx.org.id, dish],
    );
    expect(direct.ok).toBe(false);
    const approve = await attempt(fx.kitchen, 'select public.approve_recipe_draft($1)', [draft]);
    expect(approve.ok).toBe(false);
  });

  it('even the owner cannot insert an active recipe without an approval stamp', async () => {
    const r = await attempt(
      fx.org.owner,
      `insert into public.recipes (org_id, menu_item_id, status, source) values ($1, $2, 'active', 'ai_draft')`,
      [fx.org.id, dish],
    );
    expect(r.ok).toBe(false);
  });

  it('the owner approves (with the chef’s edit); ingredients without a price leave the cost incomplete', async () => {
    const edited = {
      yield_portions: 1,
      lines: [
        { ingredient: 'Chicken', base: 'g', qty_base: 220, yield_pct: 70 },
        { ingredient: 'Ghee', base: 'ml', qty_base: 20 },
      ],
    };
    const [r] = await asUser(
      fx.org.owner,
      (s) =>
        s.q<{ id: string }>('select public.approve_recipe_draft($1, $2::jsonb) as id', [
          draft,
          JSON.stringify(edited),
        ]),
      { commit: true },
    );
    const [recipe] = await admin<Row>(
      `select status::text, source::text, approved_at from public.recipes where id = $1`,
      [r!.id],
    );
    expect(recipe).toMatchObject({ status: 'active', source: 'ai_draft' });
    expect(recipe!.approved_at).not.toBeNull();
    const [d] = await admin<Row>(
      'select status::text, recipe_id from public.recipe_drafts where id = $1',
      [draft],
    );
    expect(d).toEqual({ status: 'confirmed', recipe_id: r!.id });
    const costs = await ownerQ(fx, 'select * from public.metric_recipe_costs($1, $2)', [
      fx.org.id,
      NOW,
    ]);
    expect(costs.find((c) => c.recipe_id === r!.id)!.complete).toBe(false);
    const [audit] = await admin<{ c: number }>(
      `select count(*)::int as c from public.audit_log where org_id = $1 and action = 'recipe.approve_draft'`,
      [fx.org.id],
    );
    expect(audit!.c).toBe(1);
    const again = await attempt(fx.org.owner, 'select public.approve_recipe_draft($1)', [draft]);
    expect(again.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('AI usage is written only by the gateway (service role) and adds up per day', () => {
  it('owners cannot write usage; the service role accumulates it; only the owner reads it', async () => {
    const fx = await fixture(0);
    const call = `select public.record_ai_usage($1, '2026-09-21', 'claude-sonnet-5', 'recipe_draft', 1000, 200, 5000, 0, 5000)`;
    const byOwner = await attempt(fx.org.owner, call, [fx.org.id]);
    expect(byOwner.ok).toBe(false);
    for (let i = 0; i < 2; i++) await asService((s) => s.q(call, [fx.org.id]), { commit: true });
    const rows = await ownerQ(
      fx,
      'select requests, input_tokens, cost_usd_micros from public.ai_usage where org_id = $1',
      [fx.org.id],
    );
    expect(rows.map((r) => [n(r.requests), n(r.input_tokens), n(r.cost_usd_micros)])).toEqual([
      [2, 2000, 10000],
    ]);
    const byManager = await asUser(fx.manager, (s) =>
      s.q('select * from public.ai_usage where org_id = $1', [fx.org.id]),
    );
    expect(byManager).toEqual([]);
  });
});
