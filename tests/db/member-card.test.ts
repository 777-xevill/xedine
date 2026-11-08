/**
 * Member card (ADR 0041): member discount, points earned on a paid bill, points used at the till,
 * the owner's hand adjustments and the customer's read-only card page.
 * One Kacchi is ৳300.00 = 30000 poisha gross, VAT 5% on top, no service charge.
 * Rules used: 10 points for every ৳100 of the bill, 1 point = ৳1, use from 10 points, 15% member discount.
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

interface Fx {
  org: TestOrg;
  branch: string;
  manager: TestUser;
  cashier: TestUser;
  deviceId: string;
  staffId: string;
  channel: string;
  item: string;
}

async function fixture(): Promise<Fx> {
  const org = await createOrg({ branches: ['Dhanmondi'] });
  const branch = org.branchIds[0]!;
  const manager = await addMember(org, 'manager', [branch]);
  const cashier = await addMember(org, 'cashier', [branch]);
  await admin(
    'update public.org_settings set price_includes_vat = false, vat_rate_bps = 500, service_charge_bps = 0 where org_id = $1',
    [org.id],
  );
  const [channel] = await admin<{ id: string }>(
    `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
    [org.id],
  );
  const [item] = await admin<{ id: string }>(
    `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Kacchi', 30000) returning id`,
    [org.id],
  );
  const [staff] = await admin<{ id: string }>(
    `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Rahim', 'cashier') returning id`,
    [org.id, branch],
  );
  await admin(
    `insert into public.staff_pins (staff_id, org_id, pin_hash) values ($1, $2, extensions.crypt('1234', extensions.gen_salt('bf', 4)))`,
    [staff!.id, org.id],
  );
  const reg = await asUser(
    manager,
    async (s) =>
      (
        await s.q<{ r: { device_id: string; pairing_code: string } }>(
          `select public.register_device($1, $2, 'Counter 1') as r`,
          [org.id, branch],
        )
      )[0]!.r,
    { commit: true },
  );
  await asUser(
    manager,
    (s) => s.q('select public.claim_device($1, $2)', [reg.device_id, reg.pairing_code]),
    { commit: true },
  );
  await asUser(
    manager,
    (s) => s.q('select public.start_staff_session($1, $2, $3)', [reg.device_id, staff!.id, '1234']),
    { commit: true },
  );
  return {
    org,
    branch,
    manager,
    cashier,
    deviceId: reg.device_id,
    staffId: staff!.id,
    channel: channel!.id,
    item: item!.id,
  };
}

const commit = { commit: true };

const newOrder = (fx: Fx) =>
  asUser(
    fx.manager,
    (s) =>
      s.q<Record<string, unknown>>(
        'select * from public.submit_order($1, $2, $3, $4, $5, $6, $7, null, null, null, $8::jsonb)',
        [
          fx.org.id,
          fx.branch,
          randomUUID(),
          randomUUID(),
          fx.deviceId,
          fx.staffId,
          fx.channel,
          JSON.stringify([{ menu_item_id: fx.item, quantity: 1 }]),
        ],
      ),
    commit,
  ).then((r) => r[0]!);

const orderRow = (id: unknown) =>
  admin<{ discount_poisha: string; total_poisha: string; customer_id: string | null }>(
    'select discount_poisha, total_poisha, customer_id from public.orders where id = $1',
    [id],
  ).then((r) => r[0]!);

const attachPhone = (fx: Fx, orderId: unknown, phone: string) =>
  asUser(
    fx.manager,
    (s) =>
      s.q<{ id: string }>('select public.attach_customer($1,$2,$3,$4,$5,$6,$7,$8) as id', [
        fx.org.id,
        fx.branch,
        orderId,
        phone,
        'Karim',
        true,
        fx.deviceId,
        fx.staffId,
      ]),
    commit,
  ).then((r) => r[0]!.id);

const tillInfo = (fx: Fx, orderId: unknown) =>
  asUser(fx.cashier, (s) =>
    s.q<{ m: Record<string, unknown> | null }>('select public.member_for_till($1,$2,$3) as m', [
      fx.org.id,
      fx.branch,
      orderId,
    ]),
  ).then((r) => r[0]!.m);

const pay = async (fx: Fx, orderId: unknown) => {
  const { total_poisha } = await orderRow(orderId);
  await asUser(
    fx.manager,
    (s) =>
      s.q('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        fx.org.id,
        fx.branch,
        orderId,
        'cash',
        total_poisha,
        null,
        randomUUID(),
        fx.deviceId,
        fx.staffId,
      ]),
    commit,
  );
  // A bill is completed when it is paid and served; the kitchen steps are not what is tested here.
  await admin(`update public.orders set order_status = 'completed' where id = $1`, [orderId]);
};

const REDEEM = 'select * from public.redeem_points($1,$2,$3,$4,$5,$6)';
const redeemArgs = (fx: Fx, orderId: unknown, points: number) => [
  fx.org.id,
  fx.branch,
  orderId,
  points,
  fx.deviceId,
  fx.staffId,
];

const balance = (fx: Fx, customer: string) =>
  admin<{ b: string }>('select private.points_balance($1, $2) as b', [fx.org.id, customer]).then(
    (r) => Number(r[0]!.b),
  );

describe('member card', () => {
  let fx: Fx;
  let customer: string;
  let token: string;

  beforeAll(async () => {
    fx = await fixture();
  }, 60_000);

  it('while the card is off, adding a customer gives no discount and paying gives no points', async () => {
    const order = await newOrder(fx);
    customer = await attachPhone(fx, order.id, '01712345678');
    expect(Number((await orderRow(order.id)).discount_poisha)).toBe(0);
    expect((await tillInfo(fx, order.id))?.is_on).toBe(false);
    await pay(fx, order.id);
    expect(await balance(fx, customer)).toBe(0);
  });

  it('only the owner sets the rules', async () => {
    const write = (u: TestUser) =>
      asUser(u, (s) =>
        s.attempt(
          `insert into public.loyalty_settings (org_id, is_on, earn_points, earn_every_poisha, point_value_poisha,
             min_redeem_points, discount_on, discount_bps) values ($1, true, 10, 10000, 100, 10, true, 1500)`,
          [fx.org.id],
        ),
      );
    expect((await write(fx.manager)).ok).toBe(false);
    expect((await write(fx.cashier)).ok).toBe(false);
    await asUser(
      fx.org.owner,
      (s) =>
        s.q(
          `insert into public.loyalty_settings (org_id, is_on, earn_points, earn_every_poisha, point_value_poisha,
             min_redeem_points, discount_on, discount_bps) values ($1, true, 10, 10000, 100, 10, true, 1500)`,
          [fx.org.id],
        ),
      commit,
    );
    // The till can read them (it shows the discount and what a point is worth).
    const seen = await asUser(fx.cashier, (s) =>
      s.q('select discount_bps from public.loyalty_settings where org_id = $1', [fx.org.id]),
    );
    expect(seen).toHaveLength(1);
  });

  it("a member on a new bill gets the owner's discount, and the till gets their card link", async () => {
    const order = await newOrder(fx); // gross 30000
    await attachPhone(fx, order.id, '+880 1712-345678');
    const row = await orderRow(order.id);
    expect(Number(row.discount_poisha)).toBe(4_500); // 15%
    expect(Number(row.total_poisha)).toBe(26_775); // (30000 − 4500) × 1.05
    const info = await tillInfo(fx, order.id);
    expect(info?.is_on).toBe(true);
    expect(info?.name).toBe('Karim');
    token = String(info?.token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const audit = await admin(
      `select 1 from public.audit_log where org_id = $1 and action = 'order.discount' and entity_id = $2`,
      [fx.org.id, String(order.id)],
    );
    expect(audit).toHaveLength(1);

    // Paying earns 10 points for every full ৳100 of the ৳267.75 bill: 20 points.
    await pay(fx, order.id);
    expect(await balance(fx, customer)).toBe(20);
  });

  it('a bill that already has a code keeps it when a member is added', async () => {
    await admin(
      `insert into public.discount_codes (org_id, code, percent_bps) values ($1, 'EID30', 3000)`,
      [fx.org.id],
    );
    const order = await newOrder(fx);
    await asUser(
      fx.manager,
      (s) =>
        s.q('select * from public.apply_discount_code($1,$2,$3,$4,$5,$6)', [
          fx.org.id,
          fx.branch,
          order.id,
          'EID30',
          fx.deviceId,
          fx.staffId,
        ]),
      commit,
    );
    await attachPhone(fx, order.id, '01712345678');
    expect(Number((await orderRow(order.id)).discount_poisha)).toBe(9_000);
  });

  it('scanning the card puts the member on the bill; points come off as money, on top of the discount', async () => {
    const order = await newOrder(fx);
    await asUser(
      fx.cashier,
      (s) =>
        s.q('select public.attach_member_card($1,$2,$3,$4,$5,$6)', [
          fx.org.id,
          fx.branch,
          order.id,
          token,
          fx.deviceId,
          fx.staffId,
        ]),
      commit,
    );
    expect((await orderRow(order.id)).customer_id).toBe(customer);
    const info = await tillInfo(fx, order.id);
    expect(Number(info?.usable)).toBe(20);
    expect(Number(info?.usable_worth_poisha)).toBe(2_000);

    const res = await asUser(
      fx.cashier,
      (s) => s.q<Record<string, unknown>>(REDEEM, redeemArgs(fx, order.id, 20)),
      commit,
    );
    expect(Number(res[0]!.discount_poisha)).toBe(6_500); // 4500 member + 2000 points
    expect(Number(res[0]!.total_poisha)).toBe(24_675);
    expect(await balance(fx, customer)).toBe(0);

    // Using points again replaces what was used; 0 gives them back.
    await asUser(fx.cashier, (s) => s.q(REDEEM, redeemArgs(fx, order.id, 0)), commit);
    expect(await balance(fx, customer)).toBe(20);
    expect(Number((await orderRow(order.id)).discount_poisha)).toBe(4_500);
    await asUser(fx.cashier, (s) => s.q(REDEEM, redeemArgs(fx, order.id, 15)), commit);
    expect(await balance(fx, customer)).toBe(5);

    // Cancelling the bill gives the points back.
    await admin(`update public.orders set order_status = 'cancelled' where id = $1`, [order.id]);
    expect(await balance(fx, customer)).toBe(20);
  });

  it('refuses more points than the customer has, fewer than the minimum, or more than the bill', async () => {
    const order = await newOrder(fx);
    await attachPhone(fx, order.id, '01712345678');
    const tryRedeem = (points: number) =>
      asUser(fx.cashier, (s) => s.attempt(REDEEM, redeemArgs(fx, order.id, points)));
    expect(JSON.stringify(await tryRedeem(21))).toContain('points_not_enough');
    expect(JSON.stringify(await tryRedeem(5))).toContain('points_too_few');

    await asUser(
      fx.org.owner,
      (s) =>
        s.q('select public.adjust_points($1,$2,$3,$4)', [fx.org.id, customer, 1000, 'Big party']),
      commit,
    );
    // ৳300 bill − 15% leaves ৳255: at most 255 points.
    expect(JSON.stringify(await tryRedeem(256))).toContain('points_more_than_bill');
    expect((await tryRedeem(255)).ok).toBe(true);
  });

  it('only the owner adjusts points, with a reason, and never below zero; it is audited', async () => {
    const adjust = (u: TestUser, points: number, note: string) =>
      asUser(u, (s) =>
        s.attempt('select public.adjust_points($1,$2,$3,$4)', [fx.org.id, customer, points, note]),
      );
    expect((await adjust(fx.manager, 10, 'gift')).ok).toBe(false);
    expect((await adjust(fx.cashier, 10, 'gift')).ok).toBe(false);
    expect(JSON.stringify(await adjust(fx.org.owner, 10, '  '))).toContain('reason_needed');
    const before = await balance(fx, customer);
    expect(JSON.stringify(await adjust(fx.org.owner, -(before + 1), 'fix'))).toContain(
      'points_below_zero',
    );
    await asUser(
      fx.org.owner,
      (s) => s.q('select public.adjust_points($1,$2,$3,$4)', [fx.org.id, customer, -20, 'Typo']),
      commit,
    );
    expect(await balance(fx, customer)).toBe(before - 20);
    const audit = await admin(
      `select 1 from public.audit_log where org_id = $1 and action = 'customer.points' and entity_id = $2`,
      [fx.org.id, customer],
    );
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it('managers and cashiers cannot write points or card links directly; a cashier cannot read the points', async () => {
    for (const u of [fx.manager, fx.cashier, fx.org.owner]) {
      const r = await asUser(u, (s) =>
        s.attempt(
          `insert into public.loyalty_points (org_id, customer_id, kind, points) values ($1, $2, 'adjust', 999)`,
          [fx.org.id, customer],
        ),
      );
      expect(r.ok).toBe(false);
    }
    const seen = await asUser(fx.cashier, (s) =>
      s.q('select 1 from public.loyalty_points where org_id = $1', [fx.org.id]),
    );
    expect(seen).toEqual([]);
  });

  it('the card page shows points, past bills and the menu, by link only; never to a signed-in user directly', async () => {
    const [card] = await asService((s) =>
      s.q<{ v: Record<string, unknown> }>('select public.member_card_view($1) as v', [token]),
    );
    const v = card!.v;
    expect(v.restaurant).toBeTruthy();
    expect(v.name).toBe('Karim');
    expect(String(v.phone)).not.toContain('345678');
    expect(Number(v.points)).toBe(await balance(fx, customer));
    expect(Number(v.points_worth_poisha)).toBe(Number(v.points) * 100);
    expect(v.discount_bps).toBe(1500);
    const orders = v.orders as { items: { name: string }[]; points: number }[];
    expect(orders.length).toBeGreaterThanOrEqual(2);
    expect(orders.some((o) => Number(o.points) === 20)).toBe(true);
    expect(orders[0]!.items[0]!.name).toBe('Kacchi');
    expect((v.menu as { name: string }[]).map((m) => m.name)).toContain('Kacchi');

    const [bad] = await asService((s) =>
      s.q<{ v: unknown }>('select public.member_card_view($1) as v', ['x'.repeat(24)]),
    );
    expect(bad!.v).toBeNull();
    const direct = await asUser(fx.org.owner, (s) =>
      s.attempt('select public.member_card_view($1)', [token]),
    );
    expect(direct.ok).toBe(false);
  });

  it('a new card link stops the old one; switching the card off hides the page', async () => {
    const [{ t: fresh }] = await asUser(
      fx.manager,
      (s) =>
        s.q<{ t: string }>('select public.reset_member_card($1,$2) as t', [fx.org.id, customer]),
      commit,
    ).then((r) => r as [{ t: string }]);
    expect(fresh).not.toBe(token);
    const view = (tk: string) =>
      asService((s) => s.q<{ v: unknown }>('select public.member_card_view($1) as v', [tk])).then(
        (r) => r[0]!.v,
      );
    expect(await view(token)).toBeNull();
    expect(await view(fresh)).not.toBeNull();
    await admin('update public.loyalty_settings set is_on = false where org_id = $1', [fx.org.id]);
    expect(await view(fresh)).toBeNull();
    await admin('update public.loyalty_settings set is_on = true where org_id = $1', [fx.org.id]);
  });

  it("the owner's members list finds a customer by phone digits, with points and link", async () => {
    const rows = await asUser(fx.org.owner, (s) =>
      s.q<{ customer_id: string; points: string; token: string | null }>(
        'select * from public.member_points($1, $2, 10)',
        [fx.org.id, '০১৭১২'],
      ),
    );
    expect(rows.map((r) => r.customer_id)).toContain(customer);
    const refused = await asUser(fx.manager, (s) =>
      s.attempt('select * from public.member_points($1)', [fx.org.id]),
    );
    expect(refused.ok).toBe(false);
  });
});
