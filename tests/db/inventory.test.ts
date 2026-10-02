/**
 * Phase 5 purchasing, inventory and waste (METRICS.md "Inventory", "Discipline score"; ADR 0018).
 * Every expected quantity is worked out by hand in the comments. The RPCs stamp business days from the
 * database clock, so the fixture dates are "today" and "yesterday" as the database sees them.
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

interface Fx {
  org: TestOrg;
  b1: string;
  b2: string;
  manager: TestUser;
  purchaser: TestUser;
  kitchen: TestUser;
  kitchen2: TestUser;
  cashier: TestUser;
  accountant: TestUser;
  staff: string;
  channel: string;
  today: string;
  yesterday: string;
  chicken: string;
  rice: string;
  roast: string;
  waste: string;
}

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}
const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;

const q = (user: TestUser, sql: string, params: unknown[] = [], commit = true) =>
  asUser(user, (s) => s.q<Row>(sql, params), { commit });
const attempt = (user: TestUser, sql: string, params: unknown[] = []) =>
  asUser(user, (s) => s.attempt<Row>(sql, params));

async function fixture(): Promise<Fx> {
  const org = await createOrg({ branches: ['Dhanmondi', 'Mirpur'] });
  const [b1, b2] = org.branchIds as [string, string];
  const manager = await addMember(org, 'manager', [b1]);
  const purchaser = await addMember(org, 'purchaser', [b1]);
  const kitchen = await addMember(org, 'kitchen', [b1]);
  const kitchen2 = await addMember(org, 'kitchen', [b2]);
  const cashier = await addMember(org, 'cashier', [b1]);
  const accountant = await addMember(org, 'accountant');
  await asUser(org.owner, (s) => s.q('select public.ensure_org_defaults($1)', [org.id]), {
    commit: true,
  });
  const { today, yesterday } = await one<{ today: string; yesterday: string }>(
    `select private.business_date(now(), 240)::text as today, (private.business_date(now(), 240) - 1)::text as yesterday`,
  );
  const staff = await id(
    `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Cashier', 'cashier') returning id`,
    [org.id, b1],
  );
  const channel = await id(
    `select id from public.channels where org_id = $1 and kind = 'dine_in'`,
    [org.id],
  );
  // Chicken ৳320/kg (32 poisha/g), rice ৳140/kg, both with a price from long ago.
  const ingredient = async (name: string, perKg: number) => {
    const ing = await id(
      `insert into public.ingredients (org_id, name, base) values ($1, $2, 'g') returning id`,
      [org.id, name],
    );
    await admin(
      `insert into public.ingredient_price_history (org_id, ingredient_id, effective_from, cost_poisha, per_base_qty)
       values ($1, $2, '2026-01-01', $3, 1000)`,
      [org.id, ing, perKg],
    );
    return ing;
  };
  const chicken = await ingredient('Chicken', 32000);
  const rice = await ingredient('Rice', 14000);
  const roast = await id(
    `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Chicken Roast', 12000) returning id`,
    [org.id],
  );
  // One portion: 90 g chicken at 90% yield → 100 g bought; 50 g rice → 50 g.
  await asUser(
    org.owner,
    (s) =>
      s.q(`select public.save_recipe($1, $2, null, 'Roast', 1, $3::jsonb)`, [
        org.id,
        roast,
        JSON.stringify([
          { ingredient_id: chicken, qty_base: 90, yield_pct: 90 },
          { ingredient_id: rice, qty_base: 50 },
        ]),
      ]),
    { commit: true },
  );
  const waste = await id(
    `select id from public.reason_codes where org_id = $1 and kind = 'waste' and code = 'spoiled'`,
    [org.id],
  );
  return {
    org,
    b1,
    b2,
    manager,
    purchaser,
    kitchen,
    kitchen2,
    cashier,
    accountant,
    staff,
    channel,
    today,
    yesterday,
    chicken,
    rice,
    roast,
    waste,
  };
}

/** A completed, paid order of `qty` roasts at branch b1, placed now. */
async function sell(fx: Fx, qty: number) {
  const orderId = randomUUID();
  const gross = 12000 * qty;
  await admin(
    `insert into public.orders (id, org_id, branch_id, channel_id, staff_id, order_status, payment_status, placed_at,
       gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
     values ($1,$2,$3,$4,$5,'completed','paid',now(),$6,$6,$6,$6,false,0)`,
    [orderId, fx.org.id, fx.b1, fx.channel, fx.staff, gross],
  );
  await admin(
    `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, name_snapshot, quantity, unit_price_poisha,
       gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, status)
     values ($1,$2,$3,$4,'Roast',$5,12000,$6,$6,$6,$6,'active')`,
    [fx.org.id, fx.b1, orderId, fx.roast, qty, gross],
  );
}

async function count(
  fx: Fx,
  user: TestUser,
  branch: string,
  date: string,
  lines: [string, number][],
) {
  const [{ id: countId }] = (await q(
    user,
    `select public.start_stock_count($1, $2, 'guided_weekly', $3) as id`,
    [fx.org.id, branch, date],
  )) as [{ id: string }];
  for (const [ing, qty] of lines) {
    await q(user, 'select public.save_count_line($1, $2, $3)', [countId, ing, qty]);
  }
  await q(user, 'select public.submit_stock_count($1)', [countId]);
  return countId;
}

// ---------------------------------------------------------------------------------------------
describe('purchases', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture();
  });

  const record = (user: TestUser, branch: string, lines: unknown[], date?: string) =>
    asUser(
      user,
      (s) =>
        s.attempt<{ id: string }>(
          `select public.record_purchase($1, $2, null, 'Kaptan Bazar', $3, $4::jsonb) as id`,
          [fx.org.id, branch, date ?? fx.today, JSON.stringify(lines)],
        ),
      { commit: true },
    );

  it('the owner and the branch purchaser record purchases; managers and other branches cannot', async () => {
    const ok = await record(fx.purchaser, fx.b1, [
      { ingredient_id: fx.chicken, qty_base: 10000, line_total_poisha: 330000 },
    ]);
    expect(ok.ok).toBe(true);
    expect(
      (
        await record(fx.purchaser, fx.b2, [
          { ingredient_id: fx.chicken, qty_base: 1, line_total_poisha: 1 },
        ])
      ).ok,
    ).toBe(false);
    expect(
      (
        await record(fx.manager, fx.b1, [
          { ingredient_id: fx.chicken, qty_base: 1, line_total_poisha: 1 },
        ])
      ).ok,
    ).toBe(false);
    // A supplier named on the fly is created once.
    const [s] = await admin<{ n: number }>(
      `select count(*)::int as n from public.suppliers where org_id = $1 and name = 'Kaptan Bazar'`,
      [fx.org.id],
    );
    expect(s!.n).toBe(1);
    const [audit] = await admin<{ n: number }>(
      `select count(*)::int as n from public.audit_log where org_id = $1 and action = 'purchase.record'`,
      [fx.org.id],
    );
    expect(audit!.n).toBe(1);
  });

  it('rejects empty, future-dated and priceless lines', async () => {
    expect((await record(fx.org.owner, fx.b1, [])).ok).toBe(false);
    expect(
      (
        await record(fx.org.owner, fx.b1, [
          { ingredient_id: fx.chicken, qty_base: 0, line_total_poisha: 100 },
        ])
      ).ok,
    ).toBe(false);
    const tomorrow = (await one<{ d: string }>(`select ($1::date + 1)::text as d`, [fx.today])).d;
    expect(
      (
        await record(
          fx.org.owner,
          fx.b1,
          [{ ingredient_id: fx.chicken, qty_base: 5, line_total_poisha: 100 }],
          tomorrow,
        )
      ).ok,
    ).toBe(false);
  });

  it('prices never reach a manager, and nobody writes purchase rows directly', async () => {
    const rows = await q(
      fx.manager,
      'select count(*)::int as n from public.purchases where org_id = $1',
      [fx.org.id],
      false,
    );
    expect(rows[0]!.n).toBe(0);
    const direct = await attempt(
      fx.purchaser,
      `insert into public.purchases (org_id, branch_id, purchased_on, total_poisha) values ($1, $2, $3, 1)`,
      [fx.org.id, fx.b1, fx.today],
    );
    expect(direct.ok).toBe(false);
  });

  it('a purchase sets the unit cost to the 14-day weighted average paid; voiding it falls back', async () => {
    // Already bought: 10 kg for ৳3,300 today. Add 5 kg for ৳1,500 → (330,000 + 150,000) ÷ 15,000 g = 32 poisha/g.
    const second = await record(fx.org.owner, fx.b1, [
      { ingredient_id: fx.chicken, qty_base: 5000, line_total_poisha: 150000 },
    ]);
    const cost = async () =>
      n(
        (
          await one<{ c: string }>(`select private.ingredient_unit_cost($1, $2, $3) as c`, [
            fx.org.id,
            fx.chicken,
            fx.today,
          ])
        ).c,
      );
    expect(await cost()).toBe(32);
    const [p] = await admin<{ id: string }>(
      `select id from public.purchases where org_id = $1 and total_poisha = 150000`,
      [fx.org.id],
    );
    expect(second.ok).toBe(true);
    const byPurchaser = await attempt(fx.purchaser, `select public.void_purchase($1, 'typo')`, [
      p!.id,
    ]);
    expect(byPurchaser.ok).toBe(false);
    await q(fx.org.owner, `select public.void_purchase($1, 'entered twice')`, [p!.id]);
    expect(await cost()).toBe(33); // 330,000 ÷ 10,000
  });

  it("'last' uses the last price paid", async () => {
    await admin(`update public.org_cost_settings set unit_cost_method = 'last' where org_id = $1`, [
      fx.org.id,
    ]);
    await record(fx.org.owner, fx.b1, [
      { ingredient_id: fx.rice, qty_base: 2000, line_total_poisha: 30000 },
    ]);
    const [c] = await admin<{ c: string }>(`select private.ingredient_unit_cost($1, $2, $3) as c`, [
      fx.org.id,
      fx.rice,
      fx.today,
    ]);
    expect(n(c!.c)).toBe(15);
  });
});

// ---------------------------------------------------------------------------------------------
describe('AI purchase drafts never move stock until a person confirms them', () => {
  let fx: Fx;
  let draft: string;
  beforeAll(async () => {
    fx = await fixture();
    await count(fx, fx.org.owner, fx.b1, fx.yesterday, [[fx.chicken, 1000]]);
    const rows = await q(
      fx.purchaser,
      `insert into public.purchase_drafts (org_id, branch_id, source, extracted)
       values ($1, $2, 'photo', '{"lines":[{"name":"murgi","qty":4,"unit":"kg","total":1280}]}') returning id`,
      [fx.org.id, fx.b1],
    );
    draft = rows[0]!.id as string;
  });

  const stock = async () => {
    const rows = await q(
      fx.org.owner,
      'select * from public.metric_stock_status($1, $2, now())',
      [fx.org.id, fx.b1],
      false,
    );
    return n(rows.find((r) => r.ingredient_id === fx.chicken)!.stock_qty);
  };

  it('a pending draft leaves stock alone', async () => {
    expect(await stock()).toBe(1000);
  });

  it('a manager cannot confirm; the purchaser can, once', async () => {
    const lines = JSON.stringify([
      { ingredient_id: fx.chicken, qty_base: 4000, line_total_poisha: 128000 },
    ]);
    const byManager = await attempt(
      fx.manager,
      `select public.confirm_purchase_draft($1, null, 'Kaptan Bazar', $2, $3::jsonb)`,
      [draft, fx.today, lines],
    );
    expect(byManager.ok).toBe(false);
    await q(
      fx.purchaser,
      `select public.confirm_purchase_draft($1, null, 'Kaptan Bazar', $2, $3::jsonb)`,
      [draft, fx.today, lines],
    );
    expect(await stock()).toBe(5000);
    const again = await attempt(
      fx.purchaser,
      `select public.confirm_purchase_draft($1, null, 'Kaptan Bazar', $2, $3::jsonb)`,
      [draft, fx.today, lines],
    );
    expect(again.ok).toBe(false);
    const [d] = await admin<{ status: string; source: string }>(
      `select d.status::text, p.source::text as source from public.purchase_drafts d
         join public.purchases p on p.id = d.purchase_id where d.id = $1`,
      [draft],
    );
    expect(d).toEqual({ status: 'confirmed', source: 'photo' });
  });

  it('a discarded draft is closed and still moves nothing', async () => {
    const rows = await q(
      fx.purchaser,
      `insert into public.purchase_drafts (org_id, branch_id, source, raw_text) values ($1, $2, 'voice', 'dui kg chal') returning id`,
      [fx.org.id, fx.b1],
    );
    await q(fx.purchaser, `select public.discard_purchase_draft($1, 'duplicate')`, [rows[0]!.id]);
    expect(await stock()).toBe(5000);
  });
});

// ---------------------------------------------------------------------------------------------
describe('stock, days of cover and variance between counts', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture();
    // Yesterday's closing count: 5,000 g chicken, 2,000 g rice.
    await count(fx, fx.manager, fx.b1, fx.yesterday, [
      [fx.chicken, 5000],
      [fx.rice, 2000],
    ]);
    // Today: buy 3 kg chicken for ৳990 (33 poisha/g); sell 12 roasts (1,200 g chicken, 600 g rice);
    // waste 200 g chicken + 1 roast (100 g chicken, 50 g rice); send 500 g to Mirpur; Mirpur sends 300 g.
    await q(
      fx.purchaser,
      `select public.record_purchase($1, $2, null, 'Kaptan Bazar', $3, $4::jsonb)`,
      [
        fx.org.id,
        fx.b1,
        fx.today,
        JSON.stringify([{ ingredient_id: fx.chicken, qty_base: 3000, line_total_poisha: 99000 }]),
      ],
    );
    await sell(fx, 12);
    await q(fx.kitchen, `select public.log_waste($1, $2, $3, null, 200, $4)`, [
      fx.org.id,
      fx.b1,
      fx.chicken,
      fx.waste,
    ]);
    await q(fx.kitchen, `select public.log_waste($1, $2, null, $3, 1, $4)`, [
      fx.org.id,
      fx.b1,
      fx.roast,
      fx.waste,
    ]);
    await q(fx.manager, `select public.send_transfer($1, $2, $3, $4::jsonb)`, [
      fx.org.id,
      fx.b1,
      fx.b2,
      JSON.stringify([{ ingredient_id: fx.chicken, qty_base: 500 }]),
    ]);
    const sent = await q(fx.kitchen2, `select public.send_transfer($1, $2, $3, $4::jsonb) as id`, [
      fx.org.id,
      fx.b2,
      fx.b1,
      JSON.stringify([{ ingredient_id: fx.chicken, qty_base: 300 }]),
    ]);
    await q(fx.kitchen, 'select public.receive_transfer($1)', [sent[0]!.id]);
  });

  const status = (user: TestUser) =>
    q(user, 'select * from public.metric_stock_status($1, $2, now())', [fx.org.id, fx.b1], false);

  it('stock.theoretical = count + purchases + in − out − usage − waste (5,000 + 3,000 + 300 − 500 − 1,200 − 300)', async () => {
    const chicken = (await status(fx.manager)).find((r) => r.ingredient_id === fx.chicken)!;
    expect({
      count: n(chicken.last_count_qty),
      purchases: n(chicken.purchases_qty),
      tin: n(chicken.transfers_in_qty),
      tout: n(chicken.transfers_out_qty),
      usage: n(chicken.usage_qty),
      waste: n(chicken.waste_qty),
      stock: n(chicken.stock_qty),
    }).toEqual({
      count: 5000,
      purchases: 3000,
      tin: 300,
      tout: 500,
      usage: 1200,
      waste: 300,
      stock: 6300,
    });
    // Usage 1,200 g over the 2 days since chicken was first counted here (ADR 0030: fewer than 14
    // days of history are not spread over 14) → 6,300 × 2 ÷ 1,200 = 10.5 days: green (≥ 7).
    expect(n(chicken.days_of_cover)).toBe(10.5);
    expect(chicken.band).toBe('green');
    // Rice: 2,000 − 600 − 50 = 1,350; 1,350 × 14 ÷ 600 = 31.5.
    const rice = (await status(fx.manager)).find((r) => r.ingredient_id === fx.rice)!;
    expect(n(rice.stock_qty)).toBe(1350);
  });

  it('a per-ingredient cover band overrides the default', async () => {
    await admin(
      `update public.ingredients set cover_red_days = 100, cover_green_days = 200 where id = $1`,
      [fx.chicken],
    );
    const chicken = (await status(fx.org.owner)).find((r) => r.ingredient_id === fx.chicken)!;
    expect(chicken.band).toBe('red');
    await admin(
      `update public.ingredients set cover_red_days = null, cover_green_days = null where id = $1`,
      [fx.chicken],
    );
  });

  it('cashiers do not read stock; a Mirpur-only member cannot read Dhanmondi', async () => {
    expect(
      (
        await attempt(fx.cashier, 'select * from public.metric_stock_status($1, $2, now())', [
          fx.org.id,
          fx.b1,
        ])
      ).ok,
    ).toBe(false);
    expect(
      (
        await attempt(fx.kitchen2, 'select * from public.metric_stock_status($1, $2, now())', [
          fx.org.id,
          fx.b1,
        ])
      ).ok,
    ).toBe(false);
  });

  it('variance between counts: actual 1,800 − theoretical 1,200 − waste 300 = 300 g, ৳99 at 33 poisha/g', async () => {
    await count(fx, fx.kitchen, fx.b1, fx.today, [[fx.chicken, 6000]]);
    const run = (user: TestUser) =>
      q(
        user,
        'select * from public.metric_stock_variance($1, $2, $3, $4)',
        [fx.org.id, fx.b1, fx.yesterday, fx.today],
        false,
      );
    const owner = (await run(fx.org.owner)).find((r) => r.ingredient_id === fx.chicken)!;
    expect({
      open: n(owner.opening_qty),
      close: n(owner.closing_qty),
      actual: n(owner.usage_actual_qty),
      variance: n(owner.variance_qty),
      bps: n(owner.variance_bps),
      value: n(owner.variance_poisha),
      purchases: n(owner.purchases_poisha),
      // ADR 0027: the whole over-usage, logged waste included: 1,800 − 1,200 = 600 g, 50% over the
      // recipes, ৳198 at 33 poisha/g.
      over: n(owner.over_qty),
      overBps: n(owner.over_bps),
      overValue: n(owner.over_poisha),
    }).toEqual({
      open: 5000,
      close: 6000,
      actual: 1800,
      variance: 300,
      bps: 2500,
      value: 9900,
      purchases: 99000,
      over: 600,
      overBps: 5000,
      overValue: 19800,
    });
    // The manager sees the quantities, never the money.
    const manager = (await run(fx.manager)).find((r) => r.ingredient_id === fx.chicken)!;
    expect(n(manager.variance_qty)).toBe(300);
    expect(n(manager.over_qty)).toBe(600);
    expect(manager.variance_poisha).toBeNull();
    expect(manager.over_poisha).toBeNull();
    expect(manager.purchases_poisha).toBeNull();
    // After the count, stock is the count itself.
    const chicken = (await status(fx.manager)).find((r) => r.ingredient_id === fx.chicken)!;
    expect(n(chicken.stock_qty)).toBe(6000);
  });
});

// ---------------------------------------------------------------------------------------------
describe('transfers need the receiving branch to confirm', () => {
  let fx: Fx;
  let transfer: string;
  let line: string;
  beforeAll(async () => {
    fx = await fixture();
    const rows = await q(fx.manager, `select public.send_transfer($1, $2, $3, $4::jsonb) as id`, [
      fx.org.id,
      fx.b1,
      fx.b2,
      JSON.stringify([{ ingredient_id: fx.rice, qty_base: 5000 }]),
    ]);
    transfer = rows[0]!.id as string;
    line = (
      await one<{ id: string }>(`select id from public.transfer_lines where transfer_id = $1`, [
        transfer,
      ])
    ).id;
  });

  it('is in transit until received, and only the receiving branch can receive it', async () => {
    const mirpur = await q(
      fx.kitchen2,
      'select * from public.metric_stock_status($1, $2, now())',
      [fx.org.id, fx.b2],
      false,
    );
    expect(n(mirpur.find((r) => r.ingredient_id === fx.rice)!.in_transit_qty)).toBe(5000);
    expect((await attempt(fx.manager, 'select public.receive_transfer($1)', [transfer])).ok).toBe(
      false,
    );
  });

  it('a short receipt is disputed and stock follows what arrived', async () => {
    const rows = await q(
      fx.kitchen2,
      `select public.receive_transfer($1, $2::jsonb, 'one bag torn') as s`,
      [transfer, JSON.stringify([{ line_id: line, qty_base_received: 4500 }])],
    );
    expect(rows[0]!.s).toBe('disputed');
    const moves = await admin<{ kind: string; qty: string }>(
      `select kind, qty from private.m_stock_moves($1, $2::uuid[], $3::date - 1, $3::date) where ingredient_id = $4 order by kind`,
      [fx.org.id, `{${fx.b1},${fx.b2}}`, fx.today, fx.rice],
    );
    expect(moves.map((m) => [m.kind, n(m.qty)])).toEqual([
      ['transfer_in', 4500],
      ['transfer_out', 5000],
    ]);
    expect((await attempt(fx.kitchen2, 'select public.receive_transfer($1)', [transfer])).ok).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe('waste log and leaderboard', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture();
  });

  it('needs a waste reason; kitchen logs, cashiers cannot', async () => {
    const noReason = await attempt(
      fx.kitchen,
      `select public.log_waste($1, $2, $3, null, 100, null)`,
      [fx.org.id, fx.b1, fx.chicken],
    );
    expect(noReason.ok).toBe(false);
    const byCashier = await attempt(
      fx.cashier,
      `select public.log_waste($1, $2, $3, null, 100, $4)`,
      [fx.org.id, fx.b1, fx.chicken, fx.waste],
    );
    expect(byCashier.ok).toBe(false);
    const both = await attempt(fx.kitchen, `select public.log_waste($1, $2, $3, $4, 1, $5)`, [
      fx.org.id,
      fx.b1,
      fx.chicken,
      fx.roast,
      fx.waste,
    ]);
    expect(both.ok).toBe(false);
  });

  it('values waste for the owner only: 2 roasts (2 × ৳37) + 500 g chicken (৳160)', async () => {
    await q(fx.kitchen, `select public.log_waste($1, $2, null, $3, 2, $4)`, [
      fx.org.id,
      fx.b1,
      fx.roast,
      fx.waste,
    ]);
    await q(fx.kitchen, `select public.log_waste($1, $2, $3, null, 500, $4)`, [
      fx.org.id,
      fx.b1,
      fx.chicken,
      fx.waste,
    ]);
    const run = (user: TestUser) =>
      q(
        user,
        'select * from public.metric_waste_board($1, $2, $3, $3)',
        [fx.org.id, fx.b1, fx.today],
        false,
      );
    const owner = await run(fx.org.owner);
    // Roast portion: 100 g × 32 + 50 g × 14 = 3,900 poisha → 2 portions 7,800. Chicken 500 × 32 = 16,000.
    expect(owner.map((r) => [r.name, n(r.value_poisha)])).toEqual([
      ['Chicken', 16000],
      ['Chicken Roast', 7800],
    ]);
    const manager = await run(fx.manager);
    expect(manager.every((r) => r.value_poisha === null)).toBe(true);
    expect(
      (
        await attempt(fx.purchaser, 'select * from public.metric_waste_board($1, $2, $3, $3)', [
          fx.org.id,
          fx.b1,
          fx.today,
        ])
      ).ok,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('discipline score and the guided count', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture();
    const dow = n(
      (await one<{ d: number }>(`select extract(dow from $1::date)::int as d`, [fx.today])).d,
    );
    await admin(
      `update public.org_settings set count_weekday = $2, guided_count_size = 5 where org_id = $1`,
      [fx.org.id, dow],
    );
  });

  it('the guided sheet flags the costliest ingredients by recent usage and shows no expected quantity', async () => {
    for (const name of ['Salt', 'Onion', 'Garlic', 'Ginger']) {
      await admin(`insert into public.ingredients (org_id, name) values ($1, $2)`, [
        fx.org.id,
        name,
      ]);
    }
    await sell(fx, 3);
    const [{ id: countId }] = (await q(
      fx.kitchen,
      `select public.start_stock_count($1, $2, 'guided_weekly') as id`,
      [fx.org.id, fx.b1],
    )) as [{ id: string }];
    const sheet = await q(
      fx.kitchen,
      'select * from public.stock_count_sheet($1)',
      [countId],
      false,
    );
    expect(sheet).toHaveLength(6);
    expect(sheet.filter((r) => r.suggested)).toHaveLength(5);
    // Chicken (300 g × 32) then rice (150 g × 14) lead.
    expect(sheet.slice(0, 2).map((r) => r.name)).toEqual(['Chicken', 'Rice']);
    expect(Object.keys(sheet[0]!)).not.toContain('stock_qty');
    // Starting again the same day reopens the same count.
    const again = await q(
      fx.kitchen,
      `select public.start_stock_count($1, $2, 'guided_weekly') as id`,
      [fx.org.id, fx.b1],
    );
    expect(again[0]!.id).toBe(countId);
  });

  it('scores 100 when every habit is done, and flags each missing one', async () => {
    // Dhanmondi today: sale (recipe-costed → coverage), purchase, waste, closed shift, the due count.
    await q(fx.purchaser, `select public.record_purchase($1, $2, null, 'Bazar', $3, $4::jsonb)`, [
      fx.org.id,
      fx.b1,
      fx.today,
      JSON.stringify([{ ingredient_id: fx.rice, qty_base: 1000, line_total_poisha: 14000 }]),
    ]);
    await q(fx.kitchen, `select public.log_waste($1, $2, $3, null, 100, $4)`, [
      fx.org.id,
      fx.b1,
      fx.rice,
      fx.waste,
    ]);
    await admin(
      `insert into public.shifts (org_id, branch_id, status, business_date, closed_at) values ($1, $2, 'closed', $3, now())`,
      [fx.org.id, fx.b1, fx.today],
    );
    await count(fx, fx.kitchen, fx.b1, fx.today, [[fx.chicken, 100]]);
    // Mirpur today: an open shift and nothing else.
    await admin(
      `insert into public.shifts (org_id, branch_id, status, business_date) values ($1, $2, 'open', $3)`,
      [fx.org.id, fx.b2, fx.today],
    );
    const rows = await q(
      fx.org.owner,
      'select * from public.metric_discipline($1, null, $2, $2)',
      [fx.org.id, fx.today],
      false,
    );
    const by = (b: string) => rows.find((r) => r.branch_id === b)!;
    expect(by(fx.b1)).toMatchObject({
      open_day: true,
      bazar: 25,
      waste: 15,
      cash_close: 20,
      count: 25,
      coverage: 15,
      score: 100,
    });
    expect(by(fx.b2)).toMatchObject({
      open_day: true,
      bazar: 0,
      waste: 0,
      cash_close: 0,
      count: 0,
      coverage: 15,
      score: 15,
    });
    // Yesterday nothing happened anywhere: not an open day, not scored.
    const yday = await q(
      fx.org.owner,
      'select * from public.metric_discipline($1, $2, $3, $3)',
      [fx.org.id, fx.b1, fx.yesterday],
      false,
    );
    expect(yday[0]).toMatchObject({ open_day: false, score: null });
    // A branch manager sees only their branch.
    const mine = await q(
      fx.manager,
      'select * from public.metric_discipline($1, null, $2, $2)',
      [fx.org.id, fx.today],
      false,
    );
    expect(mine.map((r) => r.branch_id)).toEqual([fx.b1]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the loss line (ADR 0027): one owner setting for the Stock page and Money leaks', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture();
  });

  const line = async () =>
    n(
      (
        await admin<{ v: number }>(
          `select (private.detector_config($1) ->> 'usage_min_rate_bps')::int as v`,
          [fx.org.id],
        )
      )[0]!.v,
    );

  it('starts at 1% and drives the unexplained-usage detector, over any older override', async () => {
    const [s] = await admin<{ loss_line_bps: number }>(
      'select loss_line_bps from public.org_settings where org_id = $1',
      [fx.org.id],
    );
    expect(s!.loss_line_bps).toBe(100);
    await admin(
      `update public.org_settings set detector_config = '{"usage_min_rate_bps": 500}' where org_id = $1`,
      [fx.org.id],
    );
    expect(await line()).toBe(100);
  });

  it('only the owner changes it, within 0.1%–20%', async () => {
    const set = (user: TestUser, bps: number) =>
      attempt(user, 'update public.org_settings set loss_line_bps = $2 where org_id = $1', [
        fx.org.id,
        bps,
      ]);
    const byManager = await set(fx.manager, 300);
    expect(byManager.ok && byManager.rowCount > 0).toBe(false);
    expect((await set(fx.org.owner, 5000)).ok).toBe(false);
    await q(fx.org.owner, 'update public.org_settings set loss_line_bps = 250 where org_id = $1', [
      fx.org.id,
    ]);
    expect(await line()).toBe(250);
  });
});
