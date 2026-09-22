/**
 * Phase 1 "Done when": order → KDS ready → split payment; void after KOT impossible without
 * manager PIN; shift-close math matches payments; never double-charge or double-count (CLAUDE.md #7).
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

interface Ctx {
  org: TestOrg;
  branchId: string;
  manager: TestUser;
  cashier: TestUser;
  kitchen: TestUser;
  deviceId: string;
  staffId: string;
  staffId2: string;
  managerStaffId: string;
  channelDineIn: string;
  channelTakeaway: string;
  itemA: { id: string; price: number };
  itemB: { id: string; price: number };
  reasonVoid: string;
  reasonDiscount: string;
}

async function setup(): Promise<Ctx> {
  const org = await createOrg({ branches: ['Dhanmondi'] });
  const branchId = org.branchIds[0]!;
  const manager = await addMember(org, 'manager', [branchId]);
  const cashier = await addMember(org, 'cashier', [branchId]);
  const kitchen = await addMember(org, 'kitchen', [branchId]);

  // VAT-exclusive at 5%, no service charge, so the money math in assertions stays simple.
  await admin(
    'update public.org_settings set price_includes_vat = false, vat_rate_bps = 500, service_charge_bps = 0 where org_id = $1',
    [org.id],
  );

  const [channelDineIn] = await admin<{ id: string }>(
    `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
    [org.id],
  );
  const [channelTakeaway] = await admin<{ id: string }>(
    `insert into public.channels (org_id, name, kind) values ($1, 'Takeaway', 'takeaway') returning id`,
    [org.id],
  );
  const [itemARow] = await admin<{ id: string }>(
    `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Kacchi', 30000) returning id`,
    [org.id],
  );
  const [itemBRow] = await admin<{ id: string }>(
    `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Borhani', 6000) returning id`,
    [org.id],
  );
  const [reasonVoid] = await admin<{ id: string }>(
    `insert into public.reason_codes (org_id, kind, code, label) values ($1, 'void', 'wrong_item', 'Wrong item') returning id`,
    [org.id],
  );
  const [reasonDiscount] = await admin<{ id: string }>(
    `insert into public.reason_codes (org_id, kind, code, label) values ($1, 'discount', 'regular', 'Regular customer') returning id`,
    [org.id],
  );

  const [staff] = await admin<{ id: string }>(
    `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Rahim', 'cashier') returning id`,
    [org.id, branchId],
  );
  const [staff2] = await admin<{ id: string }>(
    `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Karim', 'cashier') returning id`,
    [org.id, branchId],
  );
  const [managerStaff] = await admin<{ id: string }>(
    `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Farhana', 'manager') returning id`,
    [org.id, branchId],
  );
  await admin(
    `insert into public.staff_pins (staff_id, org_id, pin_hash) values ($1, $2, extensions.crypt('1234', extensions.gen_salt('bf', 4)))`,
    [staff!.id, org.id],
  );
  await admin(
    `insert into public.staff_pins (staff_id, org_id, pin_hash) values ($1, $2, extensions.crypt('5678', extensions.gen_salt('bf', 4)))`,
    [staff2!.id, org.id],
  );
  await admin(
    `insert into public.staff_pins (staff_id, org_id, pin_hash) values ($1, $2, extensions.crypt('9999', extensions.gen_salt('bf', 4)))`,
    [managerStaff!.id, org.id],
  );

  const reg = await asUser(
    manager,
    async (s) =>
      (
        await s.q<{ r: { device_id: string; pairing_code: string } }>(
          `select public.register_device($1, $2, 'Counter 1') as r`,
          [org.id, branchId],
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
  await asUser(
    manager,
    (s) =>
      s.q('select public.start_staff_session($1, $2, $3)', [reg.device_id, staff2!.id, '5678']),
    { commit: true },
  );
  await asUser(
    manager,
    (s) =>
      s.q('select public.start_staff_session($1, $2, $3)', [
        reg.device_id,
        managerStaff!.id,
        '9999',
      ]),
    { commit: true },
  );

  return {
    org,
    branchId,
    manager,
    cashier,
    kitchen,
    deviceId: reg.device_id,
    staffId: staff!.id,
    staffId2: staff2!.id,
    managerStaffId: managerStaff!.id,
    channelDineIn: channelDineIn!.id,
    channelTakeaway: channelTakeaway!.id,
    itemA: { id: itemARow!.id, price: 30000 },
    itemB: { id: itemBRow!.id, price: 6000 },
    reasonVoid: reasonVoid!.id,
    reasonDiscount: reasonDiscount!.id,
  };
}

const submit = (
  ctx: Ctx,
  lines: unknown[],
  opts: Partial<{
    channel: string;
    table: string | null;
    orderId: string;
    idempotencyKey: string;
    staffId: string;
  }> = {},
) =>
  asUser(
    ctx.manager,
    (s) =>
      s.q<Record<string, unknown>>(
        'select * from public.submit_order($1, $2, $3, $4, $5, $6, $7, $8, null, null, $9::jsonb)',
        [
          ctx.org.id,
          ctx.branchId,
          opts.orderId ?? randomUUID(),
          opts.idempotencyKey ?? randomUUID(),
          ctx.deviceId,
          opts.staffId ?? ctx.staffId,
          opts.channel ?? ctx.channelDineIn,
          opts.table ?? null,
          JSON.stringify(lines),
        ],
      ),
    { commit: true },
  ).then((r) => r[0]!);

describe('submit_order', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 60_000);

  it('computes VAT-exclusive totals correctly for a multi-line cart', async () => {
    const order = await submit(ctx, [
      { menu_item_id: ctx.itemA.id, quantity: 2 },
      { menu_item_id: ctx.itemB.id, quantity: 1 },
    ]);
    // net = 2*300 + 60 = 660.00; vat 5% = 33.00; total = 693.00
    expect(Number(order.net_poisha)).toBe(66_000);
    expect(Number(order.vat_poisha)).toBe(3_300);
    expect(Number(order.total_poisha)).toBe(69_300);
    expect(order.order_status).toBe('open');
    expect(order.payment_status).toBe('unpaid');

    const lines = await admin<{ quantity: number; total_poisha: string }>(
      'select quantity, total_poisha from public.order_items where org_id = $1 and order_id = $2 order by created_at',
      [ctx.org.id, order.id],
    );
    expect(lines).toHaveLength(2);
    const linesTotal = lines.reduce((s, l) => s + Number(l.total_poisha), 0);
    expect(linesTotal).toBe(Number(order.total_poisha)); // order total = sum of its lines
  });

  it('is idempotent: the same key returns the same order and does not duplicate lines', async () => {
    const orderId = randomUUID();
    const key = randomUUID();
    const first = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }], {
      orderId,
      idempotencyKey: key,
    });
    const second = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }], {
      orderId,
      idempotencyKey: key,
    });
    expect(second.id).toBe(first.id);
    expect(second.total_poisha).toBe(first.total_poisha);
    const [count] = await admin<{ n: number }>(
      'select count(*)::int as n from public.order_items where org_id = $1 and order_id = $2',
      [ctx.org.id, orderId],
    );
    expect(count!.n).toBe(1);
  });

  it('refuses a different order id reusing the same idempotency key', async () => {
    const key = randomUUID();
    await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }], { idempotencyKey: key });
    const res = await asUser(ctx.manager, (s) =>
      s.attempt('select public.submit_order($1,$2,$3,$4,$5,$6,$7,null,null,null,$8::jsonb)', [
        ctx.org.id,
        ctx.branchId,
        randomUUID(),
        key,
        ctx.deviceId,
        ctx.staffId,
        ctx.channelDineIn,
        JSON.stringify([{ menu_item_id: ctx.itemA.id, quantity: 1 }]),
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('23505');
  });

  it('rejects an order with no lines, an unknown item, and an unavailable-at-branch item', async () => {
    const empty = await asUser(ctx.manager, (s) =>
      s.attempt('select public.submit_order($1,$2,$3,$4,$5,$6,$7,null,null,null,$8::jsonb)', [
        ctx.org.id,
        ctx.branchId,
        randomUUID(),
        randomUUID(),
        ctx.deviceId,
        ctx.staffId,
        ctx.channelDineIn,
        '[]',
      ]),
    );
    expect(empty.ok).toBe(false);

    const unknown = await asUser(ctx.manager, (s) =>
      s.attempt('select public.submit_order($1,$2,$3,$4,$5,$6,$7,null,null,null,$8::jsonb)', [
        ctx.org.id,
        ctx.branchId,
        randomUUID(),
        randomUUID(),
        ctx.deviceId,
        ctx.staffId,
        ctx.channelDineIn,
        JSON.stringify([{ menu_item_id: randomUUID(), quantity: 1 }]),
      ]),
    );
    expect(unknown.ok).toBe(false);

    const [inactiveItem] = await admin<{ id: string }>(
      `insert into public.menu_items (org_id, name, base_price_poisha, is_active) values ($1, 'Retired', 1000, false) returning id`,
      [ctx.org.id],
    );
    const inactive = await asUser(ctx.manager, (s) =>
      s.attempt('select public.submit_order($1,$2,$3,$4,$5,$6,$7,null,null,null,$8::jsonb)', [
        ctx.org.id,
        ctx.branchId,
        randomUUID(),
        randomUUID(),
        ctx.deviceId,
        ctx.staffId,
        ctx.channelDineIn,
        JSON.stringify([{ menu_item_id: inactiveItem!.id, quantity: 1 }]),
      ]),
    );
    expect(inactive.ok).toBe(false);
  });

  it('refuses a staff member with no active session on this device', async () => {
    const res = await asUser(ctx.manager, (s) =>
      s.attempt('select public.submit_order($1,$2,$3,$4,$5,$6,$7,null,null,null,$8::jsonb)', [
        ctx.org.id,
        ctx.branchId,
        randomUUID(),
        randomUUID(),
        ctx.deviceId,
        randomUUID(),
        ctx.channelDineIn,
        JSON.stringify([{ menu_item_id: ctx.itemA.id, quantity: 1 }]),
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('42501');
  });

  it('kitchen cannot create orders; purchaser cannot either', async () => {
    const purchaser = await addMember(ctx.org, 'purchaser', [ctx.branchId]);
    for (const user of [ctx.kitchen, purchaser]) {
      const res = await asUser(user, (s) =>
        s.attempt('select public.submit_order($1,$2,$3,$4,$5,$6,$7,null,null,null,$8::jsonb)', [
          ctx.org.id,
          ctx.branchId,
          randomUUID(),
          randomUUID(),
          ctx.deviceId,
          ctx.staffId,
          ctx.channelDineIn,
          JSON.stringify([{ menu_item_id: ctx.itemA.id, quantity: 1 }]),
        ]),
      );
      expect(res.ok).toBe(false);
    }
  });

  it('applies the service charge on dine-in only, per METRICS.md', async () => {
    await admin('update public.org_settings set service_charge_bps = 1000 where org_id = $1', [
      ctx.org.id,
    ]);
    const dineIn = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }], {
      channel: ctx.channelDineIn,
    });
    const takeaway = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }], {
      channel: ctx.channelTakeaway,
    });
    expect(Number(dineIn.service_charge_poisha)).toBe(3_000); // 10% of 300
    expect(Number(takeaway.service_charge_poisha)).toBe(0);
    await admin('update public.org_settings set service_charge_bps = 0 where org_id = $1', [
      ctx.org.id,
    ]);
  });

  it('records who created the order via the verified staff session, not the browser login', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }], {
      staffId: ctx.staffId2,
    });
    expect(order.staff_id).toBe(ctx.staffId2);
    const audit = await admin<{ actor_staff_id: string }>(
      `select actor_staff_id from public.audit_log where org_id = $1 and action = 'order.create' and entity_id = $2`,
      [ctx.org.id, order.id],
    );
    expect(audit[0]!.actor_staff_id).toBe(ctx.staffId2);
  });
});

describe('KDS lifecycle', () => {
  let ctx: Ctx;
  let orderId: string;
  beforeAll(async () => {
    ctx = await setup();
    const order = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }]);
    orderId = order.id as string;
  }, 60_000);

  it('send_to_kitchen stamps KOT time and moves the order forward once', async () => {
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.send_to_kitchen($1,$2,$3,$4,$5)', [
          ctx.org.id,
          ctx.branchId,
          orderId,
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );
    const [order] = await admin<{ order_status: string }>(
      'select order_status from public.orders where id = $1',
      [orderId],
    );
    expect(order!.order_status).toBe('sent_to_kitchen');
    const [item] = await admin<{ kot_sent_at: Date | null }>(
      'select kot_sent_at from public.order_items where order_id = $1',
      [orderId],
    );
    expect(item!.kot_sent_at).not.toBeNull();

    const again = await asUser(ctx.manager, (s) =>
      s.attempt('select public.send_to_kitchen($1,$2,$3,$4,$5)', [
        ctx.org.id,
        ctx.branchId,
        orderId,
        ctx.deviceId,
        ctx.staffId,
      ]),
    );
    expect(again.ok).toBe(false);
  });

  it('advances oldest-first: sent_to_kitchen -> preparing -> ready -> served, no skipping', async () => {
    const kitchen2 = await addMember(ctx.org, 'kitchen', [ctx.branchId]);
    for (const expected of ['preparing', 'ready', 'served']) {
      const [next] = await asUser(
        kitchen2,
        (s) =>
          s.q<{ advance_order_status: string }>(
            'select public.advance_order_status($1,$2,$3,$4,$5)',
            [ctx.org.id, ctx.branchId, orderId, ctx.deviceId, ctx.staffId],
          ),
        { commit: true },
      );
      expect(next!.advance_order_status).toBe(expected);
    }
    const events = await admin<{ event_type: string }>(
      'select event_type from public.order_events where org_id = $1 and order_id = $2 order by occurred_at',
      [ctx.org.id, orderId],
    );
    expect(events.map((e) => e.event_type)).toEqual([
      'created',
      'sent_to_kitchen',
      'preparing',
      'ready',
      'served',
    ]);

    const overshoot = await asUser(ctx.manager, (s) =>
      s.attempt('select public.advance_order_status($1,$2,$3,$4,$5)', [
        ctx.org.id,
        ctx.branchId,
        orderId,
        ctx.deviceId,
        ctx.staffId,
      ]),
    );
    expect(overshoot.ok).toBe(false);
  });
});

describe('voids: PIN-gated after KOT (CLAUDE.md #5)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 60_000);

  it('before KOT, the cashier who rang it up can void alone, and it is audited', async () => {
    const order = await submit(ctx, [
      { menu_item_id: ctx.itemA.id, quantity: 1 },
      { menu_item_id: ctx.itemB.id, quantity: 1 },
    ]);
    const [line] = await admin<{ id: string }>(
      'select id from public.order_items where order_id = $1 and menu_item_id = $2',
      [order.id, ctx.itemB.id],
    );
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.void_order_item($1,$2,$3,$4,$5,$6,$7)', [
          ctx.org.id,
          ctx.branchId,
          line!.id,
          ctx.reasonVoid,
          null,
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );

    const [voided] = await admin<{ status: string }>(
      'select status from public.order_items where id = $1',
      [line!.id],
    );
    expect(voided!.status).toBe('voided');
    const [v] = await admin<{ after_kot: boolean; approved_by_staff_id: string | null }>(
      'select after_kot, approved_by_staff_id from public.voids where order_item_id = $1',
      [line!.id],
    );
    expect(v).toEqual({ after_kot: false, approved_by_staff_id: null });

    const [refreshed] = await admin<{ total_poisha: string }>(
      'select total_poisha from public.orders where id = $1',
      [order.id],
    );
    // Only itemB (৳60 + 5% VAT = ৳63.00 = 6,300 poisha) was voided; itemA (৳300 + 5% VAT = ৳315.00) remains.
    expect(Number(refreshed!.total_poisha)).toBe(Number(order.total_poisha) - 6_300);
    expect(Number(refreshed!.total_poisha)).toBe(31_500);
  });

  it('after KOT, voiding without a manager PIN is refused; with one it succeeds and is audited both ways', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }]);
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.send_to_kitchen($1,$2,$3,$4,$5)', [
          ctx.org.id,
          ctx.branchId,
          order.id,
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );
    const [line] = await admin<{ id: string }>(
      'select id from public.order_items where order_id = $1',
      [order.id],
    );

    const noPin = await asUser(ctx.manager, (s) =>
      s.attempt('select public.void_order_item($1,$2,$3,$4,$5,$6,$7)', [
        ctx.org.id,
        ctx.branchId,
        line!.id,
        ctx.reasonVoid,
        null,
        ctx.deviceId,
        ctx.staffId,
      ]),
    );
    expect(noPin.ok).toBe(false);
    if (!noPin.ok) expect(noPin.code).toBe('42501');
    const [stillActive] = await admin<{ status: string }>(
      'select status from public.order_items where id = $1',
      [line!.id],
    );
    expect(stillActive!.status).toBe('active');

    // The cashier themself cannot "approve" their own void.
    const selfApprove = await asUser(ctx.manager, (s) =>
      s.attempt('select public.void_order_item($1,$2,$3,$4,$5,$6,$7,$8)', [
        ctx.org.id,
        ctx.branchId,
        line!.id,
        ctx.reasonVoid,
        null,
        ctx.deviceId,
        ctx.staffId,
        ctx.staffId,
      ]),
    );
    expect(selfApprove.ok).toBe(false);

    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.void_order_item($1,$2,$3,$4,$5,$6,$7,$8)', [
          ctx.org.id,
          ctx.branchId,
          line!.id,
          ctx.reasonVoid,
          'kitchen delay',
          ctx.deviceId,
          ctx.staffId,
          ctx.managerStaffId,
        ]),
      { commit: true },
    );
    const [voided] = await admin<{ status: string }>(
      'select status from public.order_items where id = $1',
      [line!.id],
    );
    expect(voided!.status).toBe('voided');
    const [v] = await admin<{ after_kot: boolean; approved_by_staff_id: string }>(
      'select after_kot, approved_by_staff_id from public.voids where order_item_id = $1',
      [line!.id],
    );
    expect(v).toEqual({ after_kot: true, approved_by_staff_id: ctx.managerStaffId });
  });

  it('a cashier from another branch cannot approve (fails the staff-session check)', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }]);
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.send_to_kitchen($1,$2,$3,$4,$5)', [
          ctx.org.id,
          ctx.branchId,
          order.id,
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );
    const [line] = await admin<{ id: string }>(
      'select id from public.order_items where order_id = $1',
      [order.id],
    );
    const strangerStaffId = randomUUID();
    const res = await asUser(ctx.manager, (s) =>
      s.attempt('select public.void_order_item($1,$2,$3,$4,$5,$6,$7,$8)', [
        ctx.org.id,
        ctx.branchId,
        line!.id,
        ctx.reasonVoid,
        null,
        ctx.deviceId,
        ctx.staffId,
        strangerStaffId,
      ]),
    );
    expect(res.ok).toBe(false);
  });
});

describe('discounts', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 60_000);

  it('a 10% discount reduces net/vat/total consistently, and stacks are replaced not compounded', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }]); // net 300, vat 15, total 315
    const [d1] = await asUser(
      ctx.manager,
      (s) =>
        s.q<Record<string, unknown>>(
          'select * from public.apply_order_discount($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            ctx.org.id,
            ctx.branchId,
            order.id,
            1000,
            ctx.reasonDiscount,
            null,
            ctx.deviceId,
            ctx.staffId,
          ],
        ),
      { commit: true },
    );
    expect(Number(d1!.discount_poisha)).toBe(3_000); // 10% of 30000 gross
    expect(Number(d1!.net_poisha)).toBe(27_000);
    expect(Number(d1!.total_poisha)).toBe(28_350); // 27000 + 5% vat

    // Applying a second, different percentage replaces the discount rather than adding to it.
    const [d2] = await asUser(
      ctx.manager,
      (s) =>
        s.q<Record<string, unknown>>(
          'select * from public.apply_order_discount($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            ctx.org.id,
            ctx.branchId,
            order.id,
            2000,
            ctx.reasonDiscount,
            null,
            ctx.deviceId,
            ctx.staffId,
          ],
        ),
      { commit: true },
    );
    expect(Number(d2!.discount_poisha)).toBe(6_000);

    const rows = await admin(
      'select amount_poisha from public.discounts where org_id = $1 and order_id = $2 order by created_at',
      [ctx.org.id, order.id],
    );
    expect(rows).toHaveLength(2); // both events kept for audit, even though the order reflects only the latest
  });

  it('rejects an out-of-range percentage and discounting a completed order', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }]);
    const bad = await asUser(ctx.manager, (s) =>
      s.attempt('select public.apply_order_discount($1,$2,$3,$4,$5,$6,$7,$8)', [
        ctx.org.id,
        ctx.branchId,
        order.id,
        0,
        ctx.reasonDiscount,
        null,
        ctx.deviceId,
        ctx.staffId,
      ]),
    );
    expect(bad.ok).toBe(false);
    const tooMuch = await asUser(ctx.manager, (s) =>
      s.attempt('select public.apply_order_discount($1,$2,$3,$4,$5,$6,$7,$8)', [
        ctx.org.id,
        ctx.branchId,
        order.id,
        10001,
        ctx.reasonDiscount,
        null,
        ctx.deviceId,
        ctx.staffId,
      ]),
    );
    expect(tooMuch.ok).toBe(false);

    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.send_to_kitchen($1,$2,$3,$4,$5)', [
          ctx.org.id,
          ctx.branchId,
          order.id,
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          ctx.org.id,
          ctx.branchId,
          order.id,
          'cash',
          order.total_poisha,
          null,
          randomUUID(),
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );
    const afterPaid = await asUser(ctx.manager, (s) =>
      s.attempt('select public.apply_order_discount($1,$2,$3,$4,$5,$6,$7,$8)', [
        ctx.org.id,
        ctx.branchId,
        order.id,
        1000,
        ctx.reasonDiscount,
        null,
        ctx.deviceId,
        ctx.staffId,
      ]),
    );
    expect(afterPaid.ok).toBe(false);
  });
});

describe('payments: split-capable, idempotent, assigns an invoice number once', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 60_000);

  it('splits across two tenders and completes the order exactly once', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }]); // total 315.00 (300 + 5% VAT)
    const total = Number(order.total_poisha);
    const half = Math.floor(total / 2);

    const [p1] = await asUser(
      ctx.manager,
      (s) =>
        s.q<Record<string, unknown>>(
          'select * from public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            ctx.org.id,
            ctx.branchId,
            order.id,
            'cash',
            half,
            null,
            randomUUID(),
            ctx.deviceId,
            ctx.staffId,
          ],
        ),
      { commit: true },
    );
    expect(p1!.payment_status).toBe('partially_paid');

    const [p2] = await asUser(
      ctx.manager,
      (s) =>
        s.q<Record<string, unknown>>(
          'select * from public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            ctx.org.id,
            ctx.branchId,
            order.id,
            'bkash',
            total - half,
            null,
            randomUUID(),
            ctx.deviceId,
            ctx.staffId,
          ],
        ),
      { commit: true },
    );
    expect(p2!.payment_status).toBe('paid');
    expect(p2!.order_status).toBe('completed');
    expect(p2!.invoice_no).toMatch(/^INV-\d{6}-\d{6}$/);

    const paidSum = await admin<{ s: number }>(
      'select coalesce(sum(amount_poisha),0)::int as s from public.payments where order_id = $1',
      [order.id],
    );
    expect(paidSum[0]!.s).toBe(total); // exactly what was owed — never double-charged
  });

  it('a retried payment (same idempotency key) is a no-op, not a second charge', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }]);
    const key = randomUUID();
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          ctx.org.id,
          ctx.branchId,
          order.id,
          'cash',
          order.total_poisha,
          null,
          key,
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          ctx.org.id,
          ctx.branchId,
          order.id,
          'cash',
          order.total_poisha,
          null,
          key,
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );
    const [count] = await admin<{ n: number }>(
      'select count(*)::int as n from public.payments where order_id = $1',
      [order.id],
    );
    expect(count!.n).toBe(1);
  });

  it('assigns invoice numbers gaplessly per branch, and only once per order', async () => {
    const orderA = await submit(ctx, [{ menu_item_id: ctx.itemB.id, quantity: 1 }]);
    const orderB = await submit(ctx, [{ menu_item_id: ctx.itemB.id, quantity: 1 }]);
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          ctx.org.id,
          ctx.branchId,
          orderA.id,
          'cash',
          orderA.total_poisha,
          null,
          randomUUID(),
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          ctx.org.id,
          ctx.branchId,
          orderB.id,
          'cash',
          orderB.total_poisha,
          null,
          randomUUID(),
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );
    const [a] = await admin<{ invoice_no: string }>(
      'select invoice_no from public.orders where id = $1',
      [orderA.id],
    );
    const [b] = await admin<{ invoice_no: string }>(
      'select invoice_no from public.orders where id = $1',
      [orderB.id],
    );
    const numA = Number(a!.invoice_no.split('-').pop());
    const numB = Number(b!.invoice_no.split('-').pop());
    expect(numB).toBe(numA + 1);
  });

  it('rejects a non-positive amount and payment on a cancelled order', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }]);
    const bad = await asUser(ctx.manager, (s) =>
      s.attempt('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        ctx.org.id,
        ctx.branchId,
        order.id,
        'cash',
        0,
        null,
        randomUUID(),
        ctx.deviceId,
        ctx.staffId,
      ]),
    );
    expect(bad.ok).toBe(false);
    await admin(`update public.orders set order_status = 'cancelled' where id = $1`, [order.id]);
    const cancelled = await asUser(ctx.manager, (s) =>
      s.attempt('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        ctx.org.id,
        ctx.branchId,
        order.id,
        'cash',
        order.total_poisha,
        null,
        randomUUID(),
        ctx.deviceId,
        ctx.staffId,
      ]),
    );
    expect(cancelled.ok).toBe(false);
  });
});

describe('shifts: open/close, expected vs counted cash', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 60_000);

  it('opening float + cash payments = expected; matches when counted correctly, flags a discrepancy otherwise', async () => {
    const shift = await asUser(
      ctx.manager,
      (s) =>
        s.q<Record<string, unknown>>('select * from public.open_shift($1,$2,$3,$4,$5)', [
          ctx.org.id,
          ctx.branchId,
          ctx.deviceId,
          ctx.staffId,
          500_000,
        ]),
      { commit: true },
    );
    expect(shift[0]!.status).toBe('open');

    const cash = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }]);
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          ctx.org.id,
          ctx.branchId,
          cash.id,
          'cash',
          cash.total_poisha,
          null,
          randomUUID(),
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );
    const card = await submit(ctx, [{ menu_item_id: ctx.itemA.id, quantity: 1 }]);
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          ctx.org.id,
          ctx.branchId,
          card.id,
          'card',
          card.total_poisha,
          null,
          randomUUID(),
          ctx.deviceId,
          ctx.staffId,
        ]),
      { commit: true },
    );

    const expected = 500_000 + Number(cash.total_poisha); // card payments do not add to the till
    const [closed] = await asUser(
      ctx.manager,
      (s) =>
        s.q<Record<string, unknown>>('select * from public.close_shift($1,$2,$3,$4,$5,$6)', [
          ctx.org.id,
          ctx.branchId,
          shift[0]!.id,
          expected,
          ctx.deviceId,
          ctx.managerStaffId,
        ]),
      { commit: true },
    );
    expect(Number(closed!.expected_cash_poisha)).toBe(expected);
    expect(Number(closed!.counted_cash_poisha)).toBe(expected);
    expect(Number(closed!.over_short_poisha)).toBe(0);

    const shortClosed = await admin<{ status: string }>(
      'select status from public.shifts where id = $1',
      [shift[0]!.id],
    );
    expect(shortClosed[0]!.status).toBe('closed');
  });

  it('a discrepancy is flagged, not silently accepted', async () => {
    const shift = await asUser(
      ctx.manager,
      (s) =>
        s.q<Record<string, unknown>>('select * from public.open_shift($1,$2,$3,$4,$5)', [
          ctx.org.id,
          ctx.branchId,
          ctx.deviceId,
          ctx.staffId,
          500_000,
        ]),
      { commit: true },
    );
    const [closed] = await asUser(
      ctx.manager,
      (s) =>
        s.q<Record<string, unknown>>('select * from public.close_shift($1,$2,$3,$4,$5,$6)', [
          ctx.org.id,
          ctx.branchId,
          shift[0]!.id,
          495_000,
          ctx.deviceId,
          ctx.managerStaffId,
        ]),
      { commit: true },
    );
    expect(Number(closed!.over_short_poisha)).toBe(-5_000);
  });

  it('only one open shift per device, and only a manager or owner can close', async () => {
    const shift = await asUser(
      ctx.manager,
      (s) =>
        s.q<Record<string, unknown>>('select * from public.open_shift($1,$2,$3,$4,$5)', [
          ctx.org.id,
          ctx.branchId,
          ctx.deviceId,
          ctx.staffId,
          100_000,
        ]),
      { commit: true },
    );
    const dup = await asUser(ctx.manager, (s) =>
      s.attempt('select public.open_shift($1,$2,$3,$4,$5)', [
        ctx.org.id,
        ctx.branchId,
        ctx.deviceId,
        ctx.staffId,
        100_000,
      ]),
    );
    expect(dup.ok).toBe(false);

    // RLS is checked against the browser's own Supabase session (ADR 0013), not the PIN'd-in staff
    // member — so this must be a real cashier-role login, not the manager calling with a cashier's staff id.
    const cashierClose = await asUser(ctx.cashier, (s) =>
      s.attempt('select public.close_shift($1,$2,$3,$4,$5,$6)', [
        ctx.org.id,
        ctx.branchId,
        shift[0]!.id,
        100_000,
        ctx.deviceId,
        ctx.staffId,
      ]),
    );
    expect(cashierClose.ok).toBe(false);
    if (!cashierClose.ok) expect(cashierClose.code).toBe('42501');
    await asUser(
      ctx.manager,
      (s) =>
        s.q('select public.close_shift($1,$2,$3,$4,$5,$6)', [
          ctx.org.id,
          ctx.branchId,
          shift[0]!.id,
          100_000,
          ctx.deviceId,
          ctx.managerStaffId,
        ]),
      { commit: true },
    );
  });
});
