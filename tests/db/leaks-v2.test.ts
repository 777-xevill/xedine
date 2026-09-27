/**
 * Phase 6 Leak Detector v2 (METRICS.md "Inventory", "Purchasing"; ADR 0019). Every figure is worked out
 * by hand in the comments. Mutton costs ৳110/kg (110 poisha/g) at the start of every period; one Roast
 * uses 100 g. Fixture rows are written directly (as the seed does); the detectors only read.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, admin, asUser, closePool, createOrg, type TestOrg } from './harness';

afterAll(closePool);

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const OPEN = '2026-05-03';
const CLOSE = '2026-05-10';
const SALE_DAY = '2026-05-05';
const dhaka = (date: string, time = '13:00') => new Date(`${date}T${time}:00+06:00`).toISOString();

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}
const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;

interface Fx {
  org: TestOrg;
  branches: string[];
  mutton: string;
  onion: string;
  roast: string;
  channel: string;
}

async function fixture(branchNames: string[]): Promise<Fx> {
  const org = await createOrg({ branches: branchNames });
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
  const mutton = await ingredient('Mutton', 110000);
  const onion = await ingredient('Onion', 6000);
  const roast = await id(
    `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Roast', 50000) returning id`,
    [org.id],
  );
  await asUser(
    org.owner,
    (s) =>
      s.q(`select public.save_recipe($1, $2, null, 'Roast', 1, $3::jsonb)`, [
        org.id,
        roast,
        JSON.stringify([{ ingredient_id: mutton, qty_base: 100 }]),
      ]),
    { commit: true },
  );
  const channel = await id(
    `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
    [org.id],
  );
  await admin(
    `update public.org_settings set price_includes_vat = false, vat_rate_bps = 0 where org_id = $1`,
    [org.id],
  );
  return { org, branches: org.branchIds, mutton, onion, roast, channel };
}

async function count(fx: Fx, branch: string, date: string, ingredient: string, qty: number) {
  const c = await id(
    `insert into public.stock_counts (org_id, branch_id, counted_on, kind, status, submitted_at)
     values ($1, $2, $3, 'guided_weekly', 'submitted', $4) returning id`,
    [fx.org.id, branch, date, dhaka(date, '23:50')],
  );
  await admin(
    `insert into public.stock_count_lines (org_id, branch_id, stock_count_id, ingredient_id, counted_qty_base)
     values ($1, $2, $3, $4, $5)`,
    [fx.org.id, branch, c, ingredient, qty],
  );
}

async function purchase(
  fx: Fx,
  branch: string,
  date: string,
  ingredient: string,
  qty: number,
  paid: number,
) {
  const p = await id(
    `insert into public.purchases (org_id, branch_id, purchased_on, status, total_poisha, confirmed_at)
     values ($1, $2, $3, 'confirmed', $4, $5) returning id`,
    [fx.org.id, branch, date, paid, dhaka(date, '09:00')],
  );
  await admin(
    `insert into public.purchase_lines (org_id, branch_id, purchase_id, ingredient_id, qty_base, line_total_poisha)
     values ($1, $2, $3, $4, $5, $6)`,
    [fx.org.id, branch, p, ingredient, qty, paid],
  );
}

async function sell(fx: Fx, branch: string, qty: number) {
  const orderId = randomUUID();
  const net = 50000 * qty;
  await admin(
    `insert into public.orders (id, org_id, branch_id, channel_id, order_status, payment_status, placed_at,
       gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
     values ($1,$2,$3,$4,'completed','paid',$5,$6,$6,$6,$6,false,0)`,
    [orderId, fx.org.id, branch, fx.channel, dhaka(SALE_DAY), net],
  );
  await admin(
    `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, name_snapshot, quantity, unit_price_poisha,
       gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, status)
     values ($1,$2,$3,$4,'Roast',$5,50000,$6,$6,$6,$6,'active')`,
    [fx.org.id, branch, orderId, fx.roast, qty, net],
  );
}

/** A branch's week for mutton: opening count, a purchase, 100 roasts sold (10 kg), waste, closing count. */
async function week(
  fx: Fx,
  branch: string,
  spec: { paid?: number; waste?: number; closing: number },
) {
  await count(fx, branch, OPEN, fx.mutton, 20000);
  await purchase(fx, branch, '2026-05-04', fx.mutton, 10000, spec.paid ?? 1100000);
  await sell(fx, branch, 100);
  if (spec.waste)
    await admin(
      `insert into public.waste_logs (org_id, branch_id, ingredient_id, qty_base, business_date) values ($1, $2, $3, $4, $5)`,
      [fx.org.id, branch, fx.mutton, spec.waste, '2026-05-06'],
    );
  await count(fx, branch, CLOSE, fx.mutton, spec.closing);
}

const detect = (fx: Fx, kinds: string[], from = OPEN, to = CLOSE) =>
  admin<{
    type: string;
    branch_id: string;
    subject: Row;
    impact_poisha: string;
    confidence: string;
    evidence: Row;
  }>(
    `select type, branch_id, subject, impact_poisha, confidence, evidence from private.detect_all($1, $2::date, $3::date, $4::text[])`,
    [fx.org.id, from, to, kinds],
  );

// ---------------------------------------------------------------------------------------------
describe('the variance bridge adds up exactly', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture(['Dhanmondi']);
    // Bought 10 kg at ৳120/kg (price effect ৳10/kg); 500 g logged waste; closing 18 kg.
    // Actual = 20 + 10 − 18 = 12 kg; theoretical 10 kg; unexplained = 12 − 10 − 0.5 = 1.5 kg.
    await week(fx, fx.branches[0]!, { paid: 1200000, waste: 500, closing: 18000 });
  });

  it('cogs.actual − TFC = waste + price effect + unexplained, and the band is ±1% of what was counted', async () => {
    const [b] = await asUser(fx.org.owner, (s) =>
      s.q<Row>('select * from public.metric_variance_bridge($1, $2, $3, $4)', [
        fx.org.id,
        fx.branches[0],
        OPEN,
        CLOSE,
      ]),
    );
    expect({
      tfc: n(b!.tfc_standard_poisha),
      waste: n(b!.waste_poisha),
      price: n(b!.price_effect_poisha),
      unexplained: n(b!.unexplained_poisha),
      cogs: n(b!.cogs_actual_poisha),
      band: n(b!.uncertainty_poisha),
      net: n(b!.net_sales_poisha),
    }).toEqual({
      tfc: 1100000, // 10,000 g × 110
      waste: 55000, // 500 g × 110
      price: 120000, // 12,000 g × (120 − 110)
      unexplained: 165000, // 1,500 g × 110
      cogs: 1440000, // 12,000 g × 120
      band: 41800, // (20,000 + 18,000) g × 110 × 1%
      net: 5000000, // 100 roasts × ৳500
    });
    // Unexplained as a share of sales: 165,000 ÷ 5,000,000 = 3.3%.
    expect(n(b!.unexplained_pct_of_sales_bps)).toBe(330);
  });

  it('is money: a manager cannot read it', async () => {
    const manager = await addMember(fx.org, 'manager', [fx.branches[0]!]);
    const r = await asUser(manager, (s) =>
      s.attempt('select * from public.metric_variance_bridge($1, null, $2, $3)', [
        fx.org.id,
        OPEN,
        CLOSE,
      ]),
    );
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('usage.unexplained: more went than recipes and waste explain, beyond what peers lose', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture(['A', 'B', 'C']);
    const [a, b, c] = fx.branches as [string, string, string];
    await week(fx, a, { closing: 18500 }); // actual 11.5 kg → 1.5 kg (15%) unexplained
    await week(fx, b, { closing: 19900 }); // 100 g (1%)
    await week(fx, c, { closing: 19900 }); // 100 g (1%)
  });

  it('flags the branch with the excess over the peers’ 1% (1,400 g × 110), naming the dishes', async () => {
    const found = await detect(fx, ['stock']);
    expect(found).toHaveLength(1);
    const f = found[0]!;
    expect(f.type).toBe('usage.unexplained');
    expect(f.branch_id).toBe(fx.branches[0]);
    expect(n(f.impact_poisha)).toBe(154000);
    expect(f.confidence).toBe('high');
    expect(f.evidence).toMatchObject({
      period_start: OPEN,
      period_end: CLOSE,
      rate_bps: 1500,
      baseline_bps: 100,
    });
    expect(f.evidence.suspects).toEqual([
      { menu_item_id: fx.roast, name: 'Roast', share_bps: 10000 },
    ]);
  });

  it('saves the finding for the count period, so a re-scan updates it instead of adding another', async () => {
    for (let i = 0; i < 2; i++)
      await admin(`select private.save_findings($1, '2026-05-04', '2026-05-11', array['stock'])`, [
        fx.org.id,
      ]);
    const rows = await admin<{ period_start: string; period_end: string }>(
      `select period_start::text, period_end::text from public.findings where org_id = $1 and type = 'usage.unexplained'`,
      [fx.org.id],
    );
    expect(rows).toEqual([{ period_start: OPEN, period_end: CLOSE }]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('transfer.suspected: an over-use mirrored by an under-use in another branch', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture(['A', 'B', 'C']);
    const [a, b, c] = fx.branches as [string, string, string];
    await week(fx, a, { closing: 17000 }); // +3 kg
    await week(fx, b, { closing: 23000 }); // −3 kg
    await week(fx, c, { closing: 19900 }); // +100 g (1%, the baseline)
  });

  it('reports one suspected transfer A → B worth the average of both sides (3 kg × 110), and no usage finding', async () => {
    const found = await detect(fx, ['stock']);
    expect(found.map((f) => f.type)).toEqual(['transfer.suspected']);
    const f = found[0]!;
    expect(f.branch_id).toBe(fx.branches[0]);
    expect(f.subject.to_branch_id).toBe(fx.branches[1]);
    // A: 3,000 − 100 = 2,900 over; B: 3,000 + 100 = 3,100 under → 3,000 g.
    expect(n(f.impact_poisha)).toBe(330000);
    expect(f.confidence).toBe('high');
  });
});

// ---------------------------------------------------------------------------------------------
describe('price.drift: over the branch’s own median AND the market that day', () => {
  let fx: Fx;
  const DAY = '2026-05-10';
  beforeAll(async () => {
    fx = await fixture(['A', 'B', 'C']);
    const [a, b, c] = fx.branches as [string, string, string];
    for (const br of [a, b, c]) {
      for (const d of ['2026-05-01', '2026-05-02', '2026-05-03']) {
        await purchase(fx, br, d, fx.mutton, 1000, 110000);
        await purchase(fx, br, d, fx.onion, 10000, 60000);
      }
      // Onion rises for everyone (a market move); only A overpays for mutton (৳125/kg vs ৳110).
      await purchase(fx, br, DAY, fx.onion, 10000, 70000);
      await purchase(fx, br, DAY, fx.mutton, br === a ? 10000 : 1000, br === a ? 1250000 : 110000);
    }
  });

  it('flags A’s mutton — (125 − 110) × 10 kg — and not the onion every branch paid more for', async () => {
    const found = await detect(fx, ['price'], '2026-05-09', DAY);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: 'price.drift', branch_id: fx.branches[0] });
    expect(found[0]!.subject.ingredient_id).toBe(fx.mutton);
    expect(n(found[0]!.impact_poisha)).toBe(150000);
    expect((found[0]!.evidence.lines as Row[])[0]).toMatchObject({
      basis: 'cross_branch',
      unit_x1000: 125000,
      market_x1000: 110000,
    });
  });

  it('a lone branch needs a market reference: imported prices turn it on', async () => {
    const solo = await fixture(['Only']);
    const br = solo.branches[0]!;
    for (const d of ['2026-05-01', '2026-05-02', '2026-05-03'])
      await purchase(solo, br, d, solo.mutton, 1000, 110000);
    await purchase(solo, br, DAY, solo.mutton, 10000, 1250000);
    expect(await detect(solo, ['price'], '2026-05-09', DAY)).toHaveLength(0);
    const rows = JSON.stringify([
      {
        ingredient: 'mutton',
        price_poisha: 110000,
        per_base_qty: 1000,
        observed_on: '2026-05-08',
        source: 'TCB',
      },
      { ingredient: 'saffron', price_poisha: 1, observed_on: '2026-05-08' },
    ]);
    const manager = await addMember(solo.org, 'manager', [br]);
    expect(
      (
        await asUser(manager, (s) =>
          s.attempt('select public.import_reference_prices($1, $2::jsonb)', [solo.org.id, rows]),
        )
      ).ok,
    ).toBe(false);
    const [r] = await asUser(
      solo.org.owner,
      (s) =>
        s.q<{ r: Row }>('select public.import_reference_prices($1, $2::jsonb) as r', [
          solo.org.id,
          rows,
        ]),
      {
        commit: true,
      },
    );
    expect(r!.r).toEqual({ imported: 1, skipped: 1 });
    const found = await detect(solo, ['price'], '2026-05-09', DAY);
    expect(found).toHaveLength(1);
    expect((found[0]!.evidence.lines as Row[])[0]).toMatchObject({ basis: 'external' });
  });
});

// ---------------------------------------------------------------------------------------------
describe('transfers nobody confirmed', () => {
  it('a transfer sent three days before the period end and never received is reported on the receiving branch', async () => {
    const fx = await fixture(['A', 'B']);
    const t = await id(
      `insert into public.transfers (org_id, from_branch_id, to_branch_id, status, sent_at, sent_on)
       values ($1, $2, $3, 'sent', $4, '2026-05-07') returning id`,
      [fx.org.id, fx.branches[0], fx.branches[1], dhaka('2026-05-07', '10:00')],
    );
    await admin(
      `insert into public.transfer_lines (org_id, transfer_id, ingredient_id, qty_base_sent) values ($1, $2, $3, 5000)`,
      [fx.org.id, t, fx.mutton],
    );
    const found = await detect(fx, ['transfer']);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: 'transfer.unconfirmed', branch_id: fx.branches[1] });
    expect(n(found[0]!.impact_poisha)).toBe(550000); // 5,000 g × 110
  });
});

// ---------------------------------------------------------------------------------------------
describe('flash P&L uses recipe costs where they exist', () => {
  it('COGS is the recipe cost of what sold, labelled "recipes"', async () => {
    const fx = await fixture(['A']);
    // Sold today through the trigger path: the line gets a cost snapshot (100 g × 110 = ৳110 a roast).
    const orderId = randomUUID();
    await admin(
      `insert into public.orders (id, org_id, branch_id, channel_id, order_status, payment_status, placed_at,
         gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
       values ($1,$2,$3,$4,'completed','paid',now(),100000,100000,100000,100000,false,0)`,
      [orderId, fx.org.id, fx.branches[0], fx.channel],
    );
    await admin(
      `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, name_snapshot, quantity, unit_price_poisha,
         gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, status)
       values ($1,$2,$3,$4,'Roast',2,50000,100000,100000,100000,100000,'active')`,
      [fx.org.id, fx.branches[0], orderId, fx.roast],
    );
    const [p] = await asUser(fx.org.owner, (s) =>
      s.q<Row>('select * from public.metric_flash_pnl($1, $2, now())', [fx.org.id, fx.branches[0]]),
    );
    expect({ cogs: n(p!.cogs_poisha), basis: p!.cogs_basis }).toEqual({
      cogs: 22000,
      basis: 'recipes',
    });
  });
});
