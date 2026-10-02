/**
 * Bought for N days (ADR 0029): a lot carries the days the purchaser said and the Stock page counts
 * them down. Staff food is shown on its own and kept out of over-usage. What is left of an item nobody
 * has counted is estimated from what was bought and used (ADR 0030).
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

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}

const svc = (sql: string, params: unknown[] = []) =>
  asService((s) => s.q<Row>(sql, params), { commit: true });

const shift = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let chatSeq = 0;
const newChat = () => `tg-days-${Date.now()}-${++chatSeq}`;

interface Fx {
  org: TestOrg;
  b1: string;
  purchaser: TestUser;
  manager: TestUser;
  chat: string;
  today: string;
  ing: (name: string) => Promise<string>;
}

async function fixture(): Promise<Fx> {
  const org = await createOrg({ branches: ['Dhanmondi', 'Mirpur'] });
  const b1 = org.branchIds[0]!;
  const purchaser = await addMember(org, 'purchaser', [b1]);
  const manager = await addMember(org, 'manager', [b1]);
  const { today } = await one<{ today: string }>(
    `select private.business_date(now(), 240)::text as today`,
  );
  const [link] = await asUser(
    org.owner,
    (s) =>
      s.q<{ code: string }>(`select public.create_chat_link($1, $2, $3, 'telegram') as code`, [
        org.id,
        purchaser.id,
        b1,
      ]),
    { commit: true },
  );
  const chat = newChat();
  await svc(`select * from public.chat_redeem_link('telegram', $1, $2)`, [chat, link!.code]);
  const ing = async (name: string) =>
    (
      await one<{ id: string }>(
        `insert into public.ingredients (org_id, name, base) values ($1, $2, 'g') returning id`,
        [org.id, name],
      )
    ).id;
  return { org, b1, purchaser, manager, chat, today, ing };
}

type Line = {
  ingredient_id: string;
  qty_base: number;
  line_total_poisha: number;
  for_days?: number;
};

const buy = async (fx: Fx, who: TestUser, day: string, lines: Line[]) =>
  (
    await asUser(
      who,
      (s) =>
        s.q<{ id: string }>(
          `select public.record_purchase($1, $2, null, 'Bazar', $3::date, $4::jsonb) as id`,
          [fx.org.id, fx.b1, day, JSON.stringify(lines)],
        ),
      { commit: true },
    )
  )[0]!.id;

const count = async (fx: Fx, day: string, ingredient: string, qty: number) =>
  asUser(
    fx.manager,
    async (s) => {
      const [c] = await s.q<{ id: string }>(
        `select public.start_stock_count($1, $2, 'spot', $3::date) as id`,
        [fx.org.id, fx.b1, day],
      );
      await s.q(`select public.save_count_line($1, $2, $3)`, [c!.id, ingredient, qty]);
      await s.q(`select public.submit_stock_count($1)`, [c!.id]);
    },
    { commit: true },
  );

const lots = (fx: Fx, who: TestUser = fx.org.owner) =>
  asUser(who, (s) =>
    s.q<{
      ingredient_id: string;
      bought_on: string;
      qty: string;
      for_days: number;
      ends_on: string;
      days_left: number;
      status: string;
      prev_for_days: number | null;
      prev_lasted_days: number | null;
    }>(
      `select ingredient_id, bought_on::text, qty::text, for_days, ends_on::text, days_left, status,
              prev_for_days, prev_lasted_days
         from public.metric_stock_lots($1, $2, now())`,
      [fx.org.id, fx.b1],
    ),
  );

describe('a purchase line says how many days it is for', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture();
  });

  it('keeps the days on the line; none said stays empty; 0 or 31 days are refused', async () => {
    const chicken = await fx.ing('Chicken');
    const rice = await fx.ing('Rice');
    const id = await buy(fx, fx.purchaser, fx.today, [
      { ingredient_id: chicken, qty_base: 10_000, line_total_poisha: 320_000, for_days: 3 },
      { ingredient_id: rice, qty_base: 25_000, line_total_poisha: 250_000 },
    ]);
    const lines = await admin<{ ingredient_id: string; for_days: number | null }>(
      `select ingredient_id, for_days from public.purchase_lines where purchase_id = $1 order by for_days nulls last`,
      [id],
    );
    expect(lines).toEqual([
      { ingredient_id: chicken, for_days: 3 },
      { ingredient_id: rice, for_days: null },
    ]);
    for (const bad of [0, 31]) {
      const res = await asUser(fx.purchaser, (s) =>
        s.attempt(`select public.record_purchase($1, $2, null, 'Bazar', $3::date, $4::jsonb)`, [
          fx.org.id,
          fx.b1,
          fx.today,
          JSON.stringify([
            { ingredient_id: chicken, qty_base: 1000, line_total_poisha: 100, for_days: bad },
          ]),
        ]),
      );
      expect(res.ok, String(bad)).toBe(false);
    }
  });

  it('✅ in the chat records each line’s days, and the chat learns them as the usual days', async () => {
    const onion = await fx.ing('Onion');
    const extracted = JSON.stringify({
      supplier: '',
      lines: [
        {
          name: 'piyaj',
          ingredient_id: onion,
          qty: 5,
          unit: 'kg',
          qty_base: 5000,
          line_total_poisha: 30_000,
          flags: [],
          for_days: 2,
        },
      ],
    });
    const [drafted] = await svc(
      `select public.chat_create_purchase_draft('telegram', $1, 'import', 'piyaj 5 kg 300 2 din', $2::jsonb, '{}') as id`,
      [fx.chat, extracted],
    );
    const [confirmed] = await svc(
      `select public.chat_confirm_purchase_draft('telegram', $1, $2) as id`,
      [fx.chat, drafted!.id],
    );
    const purchase = confirmed!.id;
    const [line] = await admin<{ for_days: number }>(
      `select for_days from public.purchase_lines where purchase_id = $1`,
      [purchase],
    );
    expect(line).toEqual({ for_days: 2 });
    const usual = await svc(`select * from public.chat_usual_days('telegram', $1)`, [fx.chat]);
    expect(usual).toContainEqual({ ingredient_id: onion, for_days: 2 });
  });

  it('only the bot may read the usual days', async () => {
    const res = await asUser(fx.purchaser, (s) =>
      s.attempt(`select * from public.chat_usual_days('telegram', $1)`, [fx.chat]),
    );
    expect(res.ok).toBe(false);
  });
});

describe('metric_stock_lots: the countdown', () => {
  let fx: Fx;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    fx = await fixture();
    for (const n of ['Chicken', 'Onion', 'Rice', 'Garlic', 'Salt']) ids[n] = await fx.ing(n);
    const t = fx.today;
    const lot = (name: string, days?: number): Line => ({
      ingredient_id: ids[name]!,
      qty_base: 1000,
      line_total_poisha: 10_000,
      ...(days ? { for_days: days } : {}),
    });
    await buy(fx, fx.purchaser, shift(t, -1), [lot('Chicken', 3)]);
    await buy(fx, fx.purchaser, shift(t, -4), [lot('Onion', 3), lot('Rice', 2)]);
    await buy(fx, fx.purchaser, shift(t, -6), [lot('Garlic', 5)]);
    await buy(fx, fx.purchaser, shift(t, -4), [lot('Garlic', 7), lot('Salt')]);
  });

  it('running, then ended, with days left including today', async () => {
    const byId = new Map((await lots(fx)).map((l) => [l.ingredient_id, l]));
    expect(byId.get(ids.Chicken!)).toMatchObject({
      bought_on: shift(fx.today, -1),
      for_days: 3,
      ends_on: shift(fx.today, 1),
      days_left: 2,
      status: 'running',
    });
    expect(byId.get(ids.Onion!)).toMatchObject({ status: 'ended', days_left: 0 });
    expect(byId.get(ids.Rice!)).toMatchObject({ status: 'ended', ends_on: shift(fx.today, -3) });
    // No days said: no countdown.
    expect(byId.has(ids.Salt!)).toBe(false);
  });

  it('says when the last lot did not last the days it was bought for', async () => {
    const garlic = (await lots(fx)).find((l) => l.ingredient_id === ids.Garlic);
    expect(garlic).toMatchObject({ for_days: 7, prev_for_days: 5, prev_lasted_days: 2 });
  });

  it('is for the stock roles of the branch only', async () => {
    const cashier = await addMember(fx.org, 'cashier', [fx.b1]);
    const res = await asUser(cashier, (s) =>
      s.attempt(`select * from public.metric_stock_lots($1, $2, now())`, [fx.org.id, fx.b1]),
    );
    expect(res.ok).toBe(false);
    const stranger = await createOrg();
    const res2 = await asUser(stranger.owner, (s) =>
      s.attempt(`select * from public.metric_stock_lots($1, $2, now())`, [fx.org.id, fx.b1]),
    );
    expect(res2.ok).toBe(false);
  });
});

describe('staff food (usage.staff_food)', () => {
  let fx: Fx;
  let chicken: string;
  beforeAll(async () => {
    fx = await fixture();
    await asUser(fx.org.owner, (s) => s.q('select public.ensure_org_defaults($1)', [fx.org.id]), {
      commit: true,
    });
    chicken = await fx.ing('Chicken');
    // ৳32 a kg… 32 poisha a gram, bought before the period so only its price counts.
    await buy(fx, fx.purchaser, shift(fx.today, -6), [
      { ingredient_id: chicken, qty_base: 10_000, line_total_poisha: 320_000 },
    ]);
    await count(fx, shift(fx.today, -5), chicken, 10_000);
    const reason = async (code: string) =>
      (
        await one<{ id: string }>(
          `select id from public.reason_codes where org_id = $1 and kind = 'waste' and code = $2`,
          [fx.org.id, code],
        )
      ).id;
    const waste = async (qty: number, code: string) =>
      asUser(
        fx.manager,
        async (s) =>
          s.q(`select public.log_waste($1, $2, $3, null, $4, $5)`, [
            fx.org.id,
            fx.b1,
            chicken,
            qty,
            await reason(code),
          ]),
        { commit: true },
      );
    await waste(600, 'staff_food');
    await waste(400, 'spoiled');
    await count(fx, fx.today, chicken, 7_000);
  });

  const variance = (who: TestUser) =>
    asUser(who, (s) =>
      s.q<{
        waste_qty: string;
        variance_qty: string;
        over_qty: string;
        over_poisha: string | null;
        staff_food_qty: string;
        staff_food_poisha: string | null;
      }>(
        `select waste_qty::text, variance_qty::text, over_qty::text, over_poisha::text,
                staff_food_qty::text, staff_food_poisha::text
           from public.metric_stock_variance($1, $2, $3::date, $4::date)`,
        [fx.org.id, fx.b1, shift(fx.today, -5), fx.today],
      ),
    );

  it('every org has the reason, in both languages', async () => {
    const r = await one<{ label: string; label_bn: string }>(
      `select label, label_bn from public.reason_codes where org_id = $1 and code = 'staff_food'`,
      [fx.org.id],
    );
    expect(r).toEqual({ label: 'Staff food', label_bn: 'স্টাফের খাবার' });
  });

  it('is shown on its own and kept out of over-usage; other waste stays in', async () => {
    // Used 3,000 g, recipes 0 g; waste 1,000 g of which 600 g staff food.
    const [owner] = await variance(fx.org.owner);
    expect(Number(owner!.waste_qty)).toBe(1000);
    expect(Number(owner!.variance_qty)).toBe(2000);
    expect(Number(owner!.over_qty)).toBe(2400);
    expect(Number(owner!.staff_food_qty)).toBe(600);
    expect(Number(owner!.over_poisha)).toBe(76_800);
    expect(Number(owner!.staff_food_poisha)).toBe(19_200);
  });

  it('a manager sees the grams, not the taka', async () => {
    const [m] = await variance(fx.manager);
    expect(Number(m!.staff_food_qty)).toBe(600);
    expect(m!.staff_food_poisha).toBeNull();
    expect(m!.over_poisha).toBeNull();
  });
});

describe('stock.estimate: what is left before anyone counts (ADR 0030)', () => {
  let fx: Fx;
  let chicken: string;
  let rice: string;
  let burger: string;
  let channel: string;
  let staff: string;

  const sell = async (qty: number, daysAgo: number) => {
    const orderId = randomUUID();
    const gross = 20_000 * qty;
    await admin(
      `insert into public.orders (id, org_id, branch_id, channel_id, staff_id, order_status, payment_status, placed_at,
         gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
       values ($1,$2,$3,$4,$5,'completed','paid', now() - make_interval(days => $7::int),$6,$6,$6,$6,false,0)`,
      [orderId, fx.org.id, fx.b1, channel, staff, gross, daysAgo],
    );
    await admin(
      `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, name_snapshot, quantity, unit_price_poisha,
         gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, status)
       values ($1,$2,$3,$4,'Burger',$5,20000,$6,$6,$6,$6,'active')`,
      [fx.org.id, fx.b1, orderId, burger, qty, gross],
    );
  };

  const status = (who: TestUser = fx.org.owner) =>
    asUser(who, (s) =>
      s.q<{
        ingredient_id: string;
        stock_qty: string | null;
        estimated: boolean;
        since_on: string | null;
        used_since_qty: string | null;
        avg_daily_qty: string | null;
        days_of_cover: string | null;
        band: string;
      }>(
        `select ingredient_id, stock_qty::text, estimated, since_on::text, used_since_qty::text,
                avg_daily_qty::text, days_of_cover::text, band
           from public.metric_stock_status($1, $2, now())`,
        [fx.org.id, fx.b1],
      ),
    );

  beforeAll(async () => {
    fx = await fixture();
    await asUser(fx.org.owner, (s) => s.q('select public.ensure_org_defaults($1)', [fx.org.id]), {
      commit: true,
    });
    chicken = await fx.ing('Chicken');
    rice = await fx.ing('Rice');
    channel = (
      await one<{ id: string }>(
        `select id from public.channels where org_id = $1 and kind = 'dine_in'`,
        [fx.org.id],
      )
    ).id;
    staff = (
      await one<{ id: string }>(
        `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Cashier', 'cashier') returning id`,
        [fx.org.id, fx.b1],
      )
    ).id;
    burger = (
      await one<{ id: string }>(
        `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Chicken Burger', 20000) returning id`,
        [fx.org.id],
      )
    ).id;
    // One burger: 120 g chicken.
    await asUser(
      fx.org.owner,
      (s) =>
        s.q(`select public.save_recipe($1, $2, null, 'Burger', 1, $3::jsonb)`, [
          fx.org.id,
          burger,
          JSON.stringify([{ ingredient_id: chicken, qty_base: 120 }]),
        ]),
      { commit: true },
    );
    // 2 kg chicken bought three days ago; rice bought and counted the same day.
    await buy(fx, fx.purchaser, shift(fx.today, -3), [
      { ingredient_id: chicken, qty_base: 2000, line_total_poisha: 40_000, for_days: 4 },
      { ingredient_id: rice, qty_base: 5000, line_total_poisha: 50_000 },
    ]);
    await count(fx, shift(fx.today, -3), rice, 5000);
    // 10 burgers over four days: 1,200 g of chicken by the recipe.
    await sell(3, 3);
    await sell(3, 2);
    await sell(2, 1);
    await sell(2, 0);
  });

  it('never counted: bought − used by recipes, marked as an estimate, with its daily average', async () => {
    const row = (await status()).find((r) => r.ingredient_id === chicken);
    expect(row).toMatchObject({ estimated: true, since_on: shift(fx.today, -3), band: 'red' });
    expect(Number(row!.stock_qty)).toBe(800);
    expect(Number(row!.used_since_qty)).toBe(1200);
    // Four days since it was first bought, not fourteen: 1,200 g ÷ 4 = 300 g a day; 800 ÷ 300 ≈ 2.67.
    expect(Number(row!.avg_daily_qty)).toBe(300);
    expect(Number(row!.days_of_cover)).toBe(2.67);
  });

  it('a counted item is not an estimate', async () => {
    const row = (await status()).find((r) => r.ingredient_id === rice);
    expect(row).toMatchObject({ estimated: false, since_on: shift(fx.today, -3) });
    expect(Number(row!.stock_qty)).toBe(5000);
    // No dish uses rice: nothing used, no daily average, no days left.
    expect(Number(row!.used_since_qty)).toBe(0);
    expect(row!.avg_daily_qty).toBeNull();
  });

  it('the count-based stock (Stock Guard, hiding, bazar list) still treats it as unknown', async () => {
    const [m] = await admin<{ stock_qty: string | null }>(
      `select stock_qty::text from private.m_stock($1, array[$2]::uuid[], $3::date) where ingredient_id = $4`,
      [fx.org.id, fx.b1, fx.today, chicken],
    );
    expect(m?.stock_qty ?? null).toBeNull();
  });

  it('once counted, the count replaces the estimate; used and a day still cover the same days', async () => {
    await count(fx, fx.today, chicken, 700);
    const row = (await status()).find((r) => r.ingredient_id === chicken);
    expect(row).toMatchObject({ estimated: false, since_on: shift(fx.today, -3) });
    expect(Number(row!.stock_qty)).toBe(700);
    expect(Number(row!.used_since_qty)).toBe(1200);
    expect(Number(row!.avg_daily_qty)).toBe(300);
  });
});
