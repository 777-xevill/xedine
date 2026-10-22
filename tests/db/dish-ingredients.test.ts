/**
 * Dish ingredients (ADR 0037): the owner or the manager writes what goes into one plate; every order
 * placed at the till — paid or not yet — takes it out of stock; the Stock page's "Used" view reads it
 * per ingredient and dish. Expected figures are worked out in the comments.
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
const DAY = '2026-10-20';
const dhaka = (date: string, time = '13:00') => new Date(`${date}T${time}:00+06:00`).toISOString();

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}
const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;

interface Fx {
  org: TestOrg;
  branch: string;
  manager: TestUser;
  kitchen: TestUser;
  cashier: TestUser;
  staff: string;
  channel: string;
  chicken: string;
  bun: string;
  burger: string;
  fries: string;
}

async function fixture(): Promise<Fx> {
  const org = await createOrg({ branches: ['Dhanmondi'] });
  const branch = org.branchIds[0]!;
  const manager = await addMember(org, 'manager', [branch]);
  const kitchen = await addMember(org, 'kitchen', [branch]);
  const cashier = await addMember(org, 'cashier', [branch]);
  const staff = await id(
    `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Cashier', 'cashier') returning id`,
    [org.id, branch],
  );
  const channel = await id(
    `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
    [org.id],
  );
  const chicken = await id(
    `insert into public.ingredients (org_id, name, name_bn, base) values ($1, 'Chicken', 'মুরগি', 'g') returning id`,
    [org.id],
  );
  const bun = await id(
    `insert into public.ingredients (org_id, name, base) values ($1, 'Burger bun', 'pcs') returning id`,
    [org.id],
  );
  const item = (name: string, price: number) =>
    id(
      `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, $2, $3) returning id`,
      [org.id, name, price],
    );
  return {
    org,
    branch,
    manager,
    kitchen,
    cashier,
    staff,
    channel,
    chicken,
    bun,
    burger: await item('Burger', 25000),
    fries: await item('Fries', 12000),
  };
}

const save = (
  fx: Fx,
  who: TestUser,
  item: string,
  lines: unknown[],
  opts: { plates?: number; draft?: string } = {},
) =>
  asUser(
    who,
    (s) =>
      s.attempt<{ id: string }>(
        `select public.save_recipe($1, $2, null, null, $3, $4::jsonb, null, $5) as id`,
        [fx.org.id, item, opts.plates ?? 1, JSON.stringify(lines), opts.draft ?? null],
      ),
    { commit: true },
  );

/** One order on DAY; a line can be voided. Placed at 13:00 Dhaka. */
async function order(
  fx: Fx,
  status: 'open' | 'sent_to_kitchen' | 'completed' | 'cancelled',
  lines: { item: string; qty: number; voided?: boolean }[],
) {
  const orderId = randomUUID();
  await admin(
    `insert into public.orders (id, org_id, branch_id, channel_id, staff_id, order_status, payment_status, placed_at,
       gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
     values ($1,$2,$3,$4,$5,$6,$7,$8,10000,10000,10000,10000,false,0)`,
    [
      orderId,
      fx.org.id,
      fx.branch,
      fx.channel,
      fx.staff,
      status,
      status === 'completed' ? 'paid' : 'unpaid',
      dhaka(DAY),
    ],
  );
  for (const l of lines)
    await admin(
      `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, name_snapshot, quantity, unit_price_poisha,
         gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, status)
       values ($1,$2,$3,$4,'line',$5,1000,1000,1000,1000,1000,$6)`,
      [fx.org.id, fx.branch, orderId, l.item, l.qty, l.voided ? 'voided' : 'active'],
    );
}

// ---------------------------------------------------------------------------------------------
describe('writing a dish: owner or manager, in written order, names in Bangla too', () => {
  let fx: Fx;

  beforeAll(async () => {
    fx = await fixture();
  });

  it('the manager saves a dish for the chef; the kitchen and the cashier cannot', async () => {
    for (const who of [fx.kitchen, fx.cashier]) {
      const r = await save(fx, who, fx.burger, [{ ingredient_id: fx.bun, qty_base: 1 }]);
      expect(r.ok, 'kitchen / cashier').toBe(false);
    }
    // Burger: bun 1 piece, chicken 150 g (typed in Bangla), cheese 1 slice (a new item, typed in Bangla).
    const r = await save(fx, fx.manager, fx.burger, [
      { ingredient_id: fx.bun, qty_base: 1 },
      { ingredient: 'মুরগি', base: 'g', qty_base: 150 },
      { ingredient: 'পনির', base: 'pcs', qty_base: 1 },
    ]);
    expect(r.ok).toBe(true);
    const lines = await asUser(fx.manager, (s) =>
      s.q<{ ingredient_id: string; name: string; name_bn: string | null; qty: string }>(
        `select ingredient_id, name, name_bn, qty::text from public.dish_recipe_lines($1) where menu_item_id = $2`,
        [fx.org.id, fx.burger],
      ),
    );
    // The order it was written in; "মুরগি" is the existing Chicken, "পনির" a new item named in Bangla.
    expect(lines.map((l) => [l.name, Number(l.qty)])).toEqual([
      ['Burger bun', 1],
      ['Chicken', 150],
      ['পনির', 1],
    ]);
    expect(lines[1]!.ingredient_id).toBe(fx.chicken);
    expect(lines[2]!.name_bn).toBe('পনির');
    // Audited by the recipes trigger, with the manager as the actor.
    const [audit] = await admin<{ c: number }>(
      `select count(*)::int as c from public.audit_log where org_id = $1 and entity = 'recipe' and actor_user_id = $2`,
      [fx.org.id, fx.manager.id],
    );
    expect(audit!.c).toBeGreaterThan(0);
  });

  it('refuses an amount in a unit the item is not kept in (no grams of buns)', async () => {
    const r = await save(fx, fx.manager, fx.fries, [
      { ingredient: 'burger bun', base: 'g', qty_base: 80 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('another unit');
  });

  it('shows a line as what it takes from stock (qty ÷ yield) and keeps the deg size across versions', async () => {
    // An older line written as 135 g at 90% usable takes 150 g from stock.
    expect(
      (
        await save(fx, fx.org.owner, fx.fries, [
          { ingredient_id: fx.chicken, qty_base: 135, yield_pct: 90 },
        ])
      ).ok,
    ).toBe(true);
    const [line] = await asUser(fx.org.owner, (s) =>
      s.q<{ qty: string; plates: string }>(
        `select qty::text, plates::text from public.dish_recipe_lines($1) where menu_item_id = $2`,
        [fx.org.id, fx.fries],
      ),
    );
    expect(Number(line!.qty)).toBe(150);
    await admin(
      `update public.recipes set batch_portions = 40, batch_unit = 'deg' where org_id = $1 and menu_item_id = $2 and status = 'active'`,
      [fx.org.id, fx.fries],
    );
    expect(
      (await save(fx, fx.manager, fx.fries, [{ ingredient_id: fx.chicken, qty_base: 150 }])).ok,
    ).toBe(true);
    const [active] = await admin<{ batch_portions: string; batch_unit: string; version: number }>(
      `select batch_portions::text, batch_unit, version from public.recipes
        where org_id = $1 and menu_item_id = $2 and status = 'active'`,
      [fx.org.id, fx.fries],
    );
    expect(active).toEqual({ batch_portions: '40', batch_unit: 'deg', version: 2 });
  });
});

// ---------------------------------------------------------------------------------------------
describe('"Ask AI": a suggestion becomes the dish only when a person saves it', () => {
  let fx: Fx;
  let draft: string;

  beforeAll(async () => {
    fx = await fixture();
    // The manager may keep an AI suggestion (RLS), which is all "Ask AI" writes.
    draft = (
      await asUser(
        fx.manager,
        (s) =>
          s.q<{ id: string }>(
            `insert into public.recipe_drafts (org_id, menu_item_id, item_name, payload, model)
             values ($1, $2, 'Fries', $3::jsonb, 'mock') returning id`,
            [
              fx.org.id,
              fx.fries,
              JSON.stringify({
                yield_portions: 1,
                lines: [{ ingredient: 'Potato', base: 'g', qty_base: 200, yield_pct: 100 }],
              }),
            ],
          ),
        { commit: true },
      )
    )[0]!.id;
  });

  it('a suggestion alone changes nothing', async () => {
    const [r] = await admin<{ c: number }>(
      `select count(*)::int as c from public.recipes where org_id = $1 and menu_item_id = $2`,
      [fx.org.id, fx.fries],
    );
    expect(r!.c).toBe(0);
  });

  it('saving it for another dish is refused', async () => {
    const r = await save(
      fx,
      fx.manager,
      fx.burger,
      [{ ingredient: 'Potato', base: 'g', qty_base: 200 }],
      {
        draft,
      },
    );
    expect(r.ok).toBe(false);
  });

  it('the manager’s Save (after fixing an amount) is the approval: an audited, AI-marked recipe', async () => {
    const r = await save(
      fx,
      fx.manager,
      fx.fries,
      [{ ingredient: 'Potato', base: 'g', qty_base: 180 }],
      {
        draft,
      },
    );
    expect(r.ok).toBe(true);
    const recipeId = r.ok ? r.rows[0]!.id : '';
    const [recipe] = await admin<Row>(
      `select status::text, source::text, approved_by from public.recipes where id = $1`,
      [recipeId],
    );
    expect(recipe).toEqual({ status: 'active', source: 'ai_draft', approved_by: fx.manager.id });
    const [d] = await admin<Row>(
      `select status::text, recipe_id, reviewed_by, payload -> 'lines' -> 0 ->> 'qty_base' as ai_qty
         from public.recipe_drafts where id = $1`,
      [draft],
    );
    // The draft keeps what the AI said (200 g); the recipe holds what the person saved (180 g).
    expect(d).toEqual({
      status: 'confirmed',
      recipe_id: recipeId,
      reviewed_by: fx.manager.id,
      ai_qty: '200',
    });
    const [audit] = await admin<{ c: number }>(
      `select count(*)::int as c from public.audit_log
        where org_id = $1 and action = 'recipe.approve_draft' and entity_id = $2`,
      [fx.org.id, recipeId],
    );
    expect(audit!.c).toBe(1);
    const again = await save(
      fx,
      fx.manager,
      fx.fries,
      [{ ingredient: 'Potato', base: 'g', qty_base: 180 }],
      {
        draft,
      },
    );
    expect(again.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('stock goes down when an order is placed, not when it is paid (usage.theoretical)', () => {
  let fx: Fx;

  type Used = {
    ingredient_id: string | null;
    name: string | null;
    menu_item_id: string | null;
    item_name: string | null;
    dishes: string | null;
    qty: string | null;
  };
  const used = (who: TestUser, from = DAY, to = DAY) =>
    asUser(who, (s) =>
      s.q<Used>(
        `select ingredient_id, name, menu_item_id, item_name, dishes::text, qty::text
           from public.metric_stock_used($1, $2, $3::date, $4::date)`,
        [fx.org.id, fx.branch, from, to],
      ),
    );

  beforeAll(async () => {
    fx = await fixture();
    // Burger: bun 1 piece, chicken 150 g. Fries: nothing written.
    await save(fx, fx.org.owner, fx.burger, [
      { ingredient_id: fx.bun, qty_base: 1 },
      { ingredient_id: fx.chicken, qty_base: 150 },
    ]);
    await order(fx, 'sent_to_kitchen', [{ item: fx.burger, qty: 10 }]); // cooking, not paid yet
    await order(fx, 'open', [{ item: fx.burger, qty: 2 }]); // just placed
    await order(fx, 'cancelled', [{ item: fx.burger, qty: 5 }]); // takes nothing
    await order(fx, 'completed', [
      { item: fx.burger, qty: 3, voided: true }, // removed from the order: takes nothing
      { item: fx.fries, qty: 2 },
    ]);
  });

  it('12 burgers placed → 1.8 kg chicken and 12 buns, per ingredient and per dish', async () => {
    const rows = await used(fx.manager);
    const total = (ing: string) => rows.find((r) => r.ingredient_id === ing && !r.menu_item_id);
    const byDish = (ing: string) =>
      rows.find((r) => r.ingredient_id === ing && r.menu_item_id === fx.burger);
    expect(Number(total(fx.chicken)!.qty)).toBe(1800);
    expect(Number(total(fx.bun)!.qty)).toBe(12);
    expect(byDish(fx.chicken)).toMatchObject({ item_name: 'Burger', dishes: '12' });
    expect(Number(byDish(fx.chicken)!.qty)).toBe(1800);
    // Fries were sold with nothing written: listed apart, and took nothing.
    const unwritten = rows.filter((r) => r.ingredient_id === null);
    expect(unwritten).toEqual([
      expect.objectContaining({
        menu_item_id: fx.fries,
        item_name: 'Fries',
        dishes: '2',
        qty: null,
      }),
    ]);
  });

  it('the stock ledger takes the same amounts (Stock page, estimate, bazar list)', async () => {
    const moves = await admin<{ ingredient_id: string; qty: string }>(
      `select ingredient_id, sum(qty)::text as qty from private.m_stock_moves($1, array[$2]::uuid[], $3::date, $3::date)
        where kind = 'usage' group by ingredient_id`,
      [fx.org.id, fx.branch, DAY],
    );
    expect(Object.fromEntries(moves.map((m) => [m.ingredient_id, Number(m.qty)]))).toEqual({
      [fx.chicken]: 1800,
      [fx.bun]: 12,
    });
  });

  it('quantities for the stock roles only, over at most 93 days', async () => {
    expect((await used(fx.org.owner)).length).toBeGreaterThan(0);
    const cashier = await asUser(fx.cashier, (s) =>
      s.attempt(`select * from public.metric_stock_used($1, $2, $3::date, $3::date)`, [
        fx.org.id,
        fx.branch,
        DAY,
      ]),
    );
    expect(cashier.ok).toBe(false);
    const long = await asUser(fx.manager, (s) =>
      s.attempt(`select * from public.metric_stock_used($1, $2, '2026-01-01', $3::date)`, [
        fx.org.id,
        fx.branch,
        DAY,
      ]),
    );
    expect(long.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('ingredient prices today: from the bazar or typed, owner and accountant only', () => {
  let fx: Fx;

  beforeAll(async () => {
    fx = await fixture();
    // Typed by the owner: ৳500 a kg (the trigger writes today's history).
    await admin(
      `insert into public.ingredient_costs (ingredient_id, org_id, manual_cost_poisha, per_base_qty)
       values ($1, $2, 50000, 1000)`,
      [fx.chicken, fx.org.id],
    );
    // From the bazar on DAY: 24 buns for ৳360 → ৳15 a piece.
    await admin(
      `insert into public.ingredient_price_history (org_id, ingredient_id, effective_from, cost_poisha, per_base_qty, source)
       values ($1, $2, $3, 36000, 24, 'purchases')`,
      [fx.org.id, fx.bun, DAY],
    );
  });

  it('per kg / litre / piece, with where it came from', async () => {
    const rows = await asUser(fx.org.owner, (s) =>
      s.q<{ ingredient_id: string; price_poisha: string; source: string; since: string | null }>(
        `select ingredient_id, price_poisha::text, source, since::text from public.metric_ingredient_prices($1, now())`,
        [fx.org.id],
      ),
    );
    const by = Object.fromEntries(rows.map((r) => [r.ingredient_id, r]));
    expect(by[fx.chicken]).toMatchObject({ price_poisha: '50000', source: 'manual' });
    expect(by[fx.bun]).toMatchObject({ price_poisha: '1500', source: 'purchases', since: DAY });
    const manager = await asUser(fx.manager, (s) =>
      s.attempt('select * from public.metric_ingredient_prices($1, now())', [fx.org.id]),
    );
    expect(manager.ok).toBe(false);
  });
});
