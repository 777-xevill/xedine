/**
 * Phase 1 completion (ADR 0014): the till cannot bypass its own audit trail. Order tables are
 * written only through RPCs; sensitive actions consume a single-use manager approval; totals stay
 * right through voids, discounts, rounds, change and refunds; customers are captured with consent.
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

interface Ctx {
  org: TestOrg;
  branchId: string;
  manager: TestUser;
  cashier: TestUser;
  deviceId: string;
  cashierStaff: string;
  managerStaff: string;
  spareManagerStaff: string;
  dineIn: string;
  takeaway: string;
  kacchi: string;
  borhani: string;
  spiceGroup: string;
  mild: string;
  hot: string;
  egg: string;
  half: string;
  reasonVoid: string;
  reasonDiscount: string;
  reasonDiscountApproval: string;
  reasonRefund: string;
}

async function one<T extends Row>(sql: string, params: unknown[]): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}

async function setup(): Promise<Ctx> {
  const org = await createOrg({ branches: ['Dhanmondi', 'Mirpur'] });
  const branchId = org.branchIds[0]!;
  const manager = await addMember(org, 'manager', [branchId]);
  const cashier = await addMember(org, 'cashier', [branchId]);
  // VAT-exclusive 5%, no service charge: the arithmetic in assertions stays readable.
  await admin(
    'update public.org_settings set price_includes_vat = false, vat_rate_bps = 500, service_charge_bps = 0 where org_id = $1',
    [org.id],
  );

  const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;
  const dineIn = await id(
    `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
    [org.id],
  );
  const takeaway = await id(
    `insert into public.channels (org_id, name, kind) values ($1, 'Takeaway', 'takeaway') returning id`,
    [org.id],
  );
  const kacchi = await id(
    `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Kacchi', 30000) returning id`,
    [org.id],
  );
  const borhani = await id(
    `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Borhani', 6000) returning id`,
    [org.id],
  );
  const half = await id(
    `insert into public.item_variants (org_id, menu_item_id, name, price_delta_poisha) values ($1, $2, 'Half', -12000) returning id`,
    [org.id, kacchi],
  );
  const spiceGroup = await id(
    `insert into public.modifier_groups (org_id, name, min_select, max_select) values ($1, 'Spice', 0, 1) returning id`,
    [org.id],
  );
  const mild = await id(
    `insert into public.modifiers (org_id, group_id, name, price_poisha) values ($1, $2, 'Mild', 0) returning id`,
    [org.id, spiceGroup],
  );
  const hot = await id(
    `insert into public.modifiers (org_id, group_id, name, price_poisha) values ($1, $2, 'Hot', 0) returning id`,
    [org.id, spiceGroup],
  );
  const extras = await id(
    `insert into public.modifier_groups (org_id, name, min_select, max_select) values ($1, 'Extras', 0, 3) returning id`,
    [org.id],
  );
  const egg = await id(
    `insert into public.modifiers (org_id, group_id, name, price_poisha) values ($1, $2, 'Egg', 2000) returning id`,
    [org.id, extras],
  );
  await admin(
    `insert into public.menu_item_modifier_groups (org_id, menu_item_id, modifier_group_id) values ($1, $2, $3), ($1, $2, $4)`,
    [org.id, kacchi, spiceGroup, extras],
  );
  const reason = (kind: string, code: string, approval = false) =>
    id(
      `insert into public.reason_codes (org_id, kind, code, label, requires_manager_approval) values ($1, $2, $3, $3, $4) returning id`,
      [org.id, kind, code, approval],
    );
  const reasonVoid = await reason('void', 'wrong_item');
  const reasonDiscount = await reason('discount', 'regular');
  const reasonDiscountApproval = await reason('discount', 'staff_meal', true);
  const reasonRefund = await reason('refund', 'quality');

  const staff = async (name: string, role: string, pin: string) => {
    const staffId = await id(
      `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, $3, $4) returning id`,
      [org.id, branchId, name, role],
    );
    await admin(
      `insert into public.staff_pins (staff_id, org_id, pin_hash) values ($1, $2, extensions.crypt($3, extensions.gen_salt('bf', 4)))`,
      [staffId, org.id, pin],
    );
    return staffId;
  };
  const cashierStaff = await staff('Rahim', 'cashier', '1234');
  const managerStaff = await staff('Farhana', 'manager', '9999');
  const spareManagerStaff = await staff('Sumon', 'manager', '4321');

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
  // Only the cashier is PIN'd in: approvals must work without the manager holding a session.
  await asUser(
    manager,
    (s) =>
      s.q('select public.start_staff_session($1, $2, $3)', [reg.device_id, cashierStaff, '1234']),
    { commit: true },
  );

  return {
    org,
    branchId,
    manager,
    cashier,
    deviceId: reg.device_id,
    cashierStaff,
    managerStaff,
    spareManagerStaff,
    dineIn,
    takeaway,
    kacchi,
    borhani,
    spiceGroup,
    mild,
    hot,
    egg,
    half,
    reasonVoid,
    reasonDiscount,
    reasonDiscountApproval,
    reasonRefund,
  };
}

const call = <T extends Row = Row>(ctx: Ctx, sql: string, params: unknown[]) =>
  asUser(ctx.manager, (s) => s.q<T>(sql, params), { commit: true });
const attempt = (ctx: Ctx, sql: string, params: unknown[]) =>
  asUser(ctx.manager, (s) => s.attempt(sql, params));

interface Line {
  menu_item_id: string;
  quantity: number;
  variant_id?: string;
  modifier_ids?: string[];
  client_unit_price_poisha?: number;
}

const SUBMIT = 'select * from public.submit_order($1,$2,$3,$4,$5,$6,$7,$8,null,$9,$10::jsonb,$11)';
const submitParams = (
  ctx: Ctx,
  lines: Line[],
  opts: Partial<{ staff: string; channel: string; placedAt: string; provisional: string }> = {},
) => [
  ctx.org.id,
  ctx.branchId,
  randomUUID(),
  randomUUID(),
  ctx.deviceId,
  opts.staff ?? ctx.cashierStaff,
  opts.channel ?? ctx.dineIn,
  null,
  opts.placedAt ?? null,
  JSON.stringify(lines),
  opts.provisional ?? null,
];
const submit = async (ctx: Ctx, lines: Line[], opts: Parameters<typeof submitParams>[2] = {}) =>
  (await call(ctx, SUBMIT, submitParams(ctx, lines, opts)))[0]!;

const approve = async (ctx: Ctx, staffId: string, pin: string, action: string) =>
  (
    await call<{
      r: { ok: boolean; approval_id?: string; reason?: string; attempts_left?: number };
    }>(ctx, 'select public.approve_action($1, $2, $3, $4) as r', [
      ctx.deviceId,
      staffId,
      pin,
      action,
    ])
  )[0]!.r;

const sendKitchen = (ctx: Ctx, orderId: unknown) =>
  call(ctx, 'select public.send_to_kitchen($1,$2,$3,$4,$5)', [
    ctx.org.id,
    ctx.branchId,
    orderId,
    ctx.deviceId,
    ctx.cashierStaff,
  ]);

const advance = async (ctx: Ctx, orderId: unknown) =>
  (
    await call<{ s: string }>(ctx, 'select public.advance_order_status($1,$2,$3,$4,$5) as s', [
      ctx.org.id,
      ctx.branchId,
      orderId,
      ctx.deviceId,
      ctx.cashierStaff,
    ])
  )[0]!.s;

const PAY = 'select * from public.record_payment($1,$2,$3,$4,$5,null,$6,$7,$8)';
const pay = async (
  ctx: Ctx,
  orderId: unknown,
  method: string,
  amount: number,
  key = randomUUID(),
) =>
  (
    await call(ctx, PAY, [
      ctx.org.id,
      ctx.branchId,
      orderId,
      method,
      amount,
      key,
      ctx.deviceId,
      ctx.cashierStaff,
    ])
  )[0]!;

const lineIds = async (orderId: unknown) =>
  (
    await admin<{ id: string }>(
      'select id from public.order_items where order_id = $1 order by created_at, id',
      [orderId],
    )
  ).map((r) => r.id);

const n = (v: unknown) => Number(v);

describe('order tables are written only through audited RPCs', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  it('a signed-in manager or cashier cannot insert, update or delete order rows directly', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    for (const user of [ctx.manager, ctx.cashier]) {
      const tries = [
        [
          `insert into public.orders (org_id, branch_id, business_date) values ($1, $2, current_date)`,
          [ctx.org.id, ctx.branchId],
        ],
        ['update public.orders set total_poisha = 0 where id = $1', [order.id]],
        ['delete from public.order_items where order_id = $1', [order.id]],
        [
          `insert into public.payments (org_id, branch_id, order_id, method, amount_poisha) values ($1, $2, $3, 'cash', 100)`,
          [ctx.org.id, ctx.branchId, order.id],
        ],
        ['update public.voids set value_poisha = 0 where org_id = $1', [ctx.org.id]],
        ['update public.shifts set counted_cash_poisha = 0 where org_id = $1', [ctx.org.id]],
      ] as const;
      for (const [sql, params] of tries) {
        const res = await asUser(user, (s) => s.attempt(sql, [...params]));
        expect(res.ok, sql).toBe(false);
        if (!res.ok) expect(res.code, sql).toBe('42501');
      }
    }
    const [still] = await admin<{ total_poisha: string }>(
      'select total_poisha from public.orders where id = $1',
      [order.id],
    );
    expect(n(still!.total_poisha)).toBe(31_500);
  });

  it('reads still work for the roles that could read before', async () => {
    const rows = await asUser(ctx.cashier, (s) =>
      s.q<{ c: number }>('select count(*)::int as c from public.orders where org_id = $1', [
        ctx.org.id,
      ]),
    );
    expect(rows[0]!.c).toBeGreaterThan(0);
  });
});

describe('manager approvals are single-use PIN proofs', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  it('a wrong PIN counts down, five misses lock the PIN, and the lock survives a correct PIN', async () => {
    const lefts: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await approve(ctx, ctx.spareManagerStaff, '0000', 'refund');
      expect(r).toMatchObject({ ok: false, reason: 'wrong_pin' });
      lefts.push(r.attempts_left!);
    }
    expect(lefts).toEqual([4, 3, 2, 1]);
    expect(await approve(ctx, ctx.spareManagerStaff, '0000', 'refund')).toMatchObject({
      ok: false,
      reason: 'locked',
    });
    expect(await approve(ctx, ctx.spareManagerStaff, '4321', 'refund')).toMatchObject({
      ok: false,
      reason: 'locked',
    });
  });

  it('an approval works once, only for its action, only on its device, and only until it expires', async () => {
    const order = await submit(ctx, [
      { menu_item_id: ctx.kacchi, quantity: 1 },
      { menu_item_id: ctx.borhani, quantity: 1 },
      { menu_item_id: ctx.borhani, quantity: 2 },
    ]);
    await sendKitchen(ctx, order.id);
    const [l1, l2, l3] = await lineIds(order.id);
    const VOID = 'select public.void_order_item($1,$2,$3,$4,null,$5,$6,$7)';
    const voidLine = (line: string, approval: string | undefined) =>
      attempt(ctx, VOID, [
        ctx.org.id,
        ctx.branchId,
        line,
        ctx.reasonVoid,
        ctx.deviceId,
        ctx.cashierStaff,
        approval ?? null,
      ]);

    const wrongAction = await approve(ctx, ctx.managerStaff, '9999', 'refund');
    expect(wrongAction.ok).toBe(true);
    expect((await voidLine(l1!, wrongAction.approval_id)).ok).toBe(false);

    const good = await approve(ctx, ctx.managerStaff, '9999', 'void_after_kot');
    const first = await asUser(
      ctx.manager,
      (s) =>
        s.attempt(VOID, [
          ctx.org.id,
          ctx.branchId,
          l1,
          ctx.reasonVoid,
          ctx.deviceId,
          ctx.cashierStaff,
          good.approval_id,
        ]),
      { commit: true },
    );
    expect(first.ok).toBe(true);
    const replay = await voidLine(l2!, good.approval_id);
    expect(replay.ok, 'an approval cannot be replayed').toBe(false);

    const stale = await approve(ctx, ctx.managerStaff, '9999', 'void_after_kot');
    await admin(
      `update public.staff_approvals set expires_at = now() - interval '1 second' where id = $1`,
      [stale.approval_id],
    );
    expect((await voidLine(l3!, stale.approval_id)).ok).toBe(false);

    // Another device on the same branch cannot spend this till's approval.
    const otherDevice = await asUser(
      ctx.manager,
      async (s) =>
        (
          await s.q<{ r: { device_id: string; pairing_code: string } }>(
            `select public.register_device($1, $2, 'Counter 2') as r`,
            [ctx.org.id, ctx.branchId],
          )
        )[0]!.r,
      { commit: true },
    );
    await call(ctx, 'select public.claim_device($1, $2)', [
      otherDevice.device_id,
      otherDevice.pairing_code,
    ]);
    const fresh = await approve(ctx, ctx.managerStaff, '9999', 'void_after_kot');
    await admin(`update public.staff_approvals set device_id = $1 where id = $2`, [
      otherDevice.device_id,
      fresh.approval_id,
    ]);
    expect((await voidLine(l3!, fresh.approval_id)).ok).toBe(false);
  });

  it('a manager on the till can approve their own action by typing their PIN again', async () => {
    await call(ctx, 'select public.start_staff_session($1, $2, $3)', [
      ctx.deviceId,
      ctx.managerStaff,
      '9999',
    ]);
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }], {
      staff: ctx.managerStaff,
    });
    await sendKitchen(ctx, order.id);
    const [line] = await lineIds(order.id);
    const approval = await approve(ctx, ctx.managerStaff, '9999', 'void_after_kot');
    const [done] = await call(
      ctx,
      'select * from public.void_order_item($1,$2,$3,$4,null,$5,$6,$7)',
      [
        ctx.org.id,
        ctx.branchId,
        line,
        ctx.reasonVoid,
        ctx.deviceId,
        ctx.managerStaff,
        approval.approval_id,
      ],
    );
    expect(n(done!.total_poisha)).toBe(0);
  });
});

describe('totals stay right through discounts and voids', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  const DISCOUNT = 'select * from public.apply_order_discount($1,$2,$3,$4,$5,null,$6,$7,$8)';
  const discount = (ctx: Ctx, orderId: unknown, bps: number, reason: string, approval?: string) =>
    call(ctx, DISCOUNT, [
      ctx.org.id,
      ctx.branchId,
      orderId,
      bps,
      reason,
      ctx.deviceId,
      ctx.cashierStaff,
      approval ?? null,
    ]).then((r) => r[0]!);

  it('voiding a line after a 10% discount keeps 10% on what remains', async () => {
    const order = await submit(ctx, [
      { menu_item_id: ctx.kacchi, quantity: 1 },
      { menu_item_id: ctx.borhani, quantity: 1 },
    ]);
    const d = await discount(ctx, order.id, 1000, ctx.reasonDiscount);
    expect(n(d.discount_poisha)).toBe(3_600); // 10% of 36,000 gross
    const borhaniLine = (
      await admin<{ id: string }>(
        'select id from public.order_items where order_id = $1 and menu_item_id = $2',
        [order.id, ctx.borhani],
      )
    )[0]!.id;
    const [after] = await call(
      ctx,
      'select * from public.void_order_item($1,$2,$3,$4,null,$5,$6)',
      [ctx.org.id, ctx.branchId, borhaniLine, ctx.reasonVoid, ctx.deviceId, ctx.cashierStaff],
    );
    // Remaining gross 30,000 → 10% = 3,000 → net 27,000 + 5% VAT 1,350 = 28,350.
    expect(n(after!.gross_poisha)).toBe(30_000);
    expect(n(after!.discount_poisha)).toBe(3_000);
    expect(n(after!.net_poisha)).toBe(27_000);
    expect(n(after!.total_poisha)).toBe(28_350);
  });

  it('a smaller second discount replaces the first (no negative discount rows)', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    await discount(ctx, order.id, 2000, ctx.reasonDiscount);
    const d = await discount(ctx, order.id, 1000, ctx.reasonDiscount);
    expect(n(d.discount_poisha)).toBe(3_000);
    const rows = await admin<{ amount_poisha: string }>(
      'select amount_poisha from public.discounts where order_id = $1 order by created_at',
      [order.id],
    );
    expect(rows.map((r) => n(r.amount_poisha))).toEqual([6_000, 3_000]);
  });

  it('a reason that requires approval consumes one and records the approver', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    const without = await attempt(ctx, DISCOUNT, [
      ctx.org.id,
      ctx.branchId,
      order.id,
      10000,
      ctx.reasonDiscountApproval,
      ctx.deviceId,
      ctx.cashierStaff,
      null,
    ]);
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.code).toBe('42501');
    const approval = await approve(ctx, ctx.managerStaff, '9999', 'discount');
    const d = await discount(
      ctx,
      order.id,
      10000,
      ctx.reasonDiscountApproval,
      approval.approval_id,
    );
    expect(n(d.total_poisha)).toBe(0);
    const [row] = await admin<{ approved_by_staff_id: string }>(
      'select approved_by_staff_id from public.discounts where order_id = $1',
      [order.id],
    );
    expect(row!.approved_by_staff_id).toBe(ctx.managerStaff);
  });

  it('refuses a missing or wrong-kind reason', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    const res = await attempt(ctx, DISCOUNT, [
      ctx.org.id,
      ctx.branchId,
      order.id,
      1000,
      ctx.reasonVoid,
      ctx.deviceId,
      ctx.cashierStaff,
      null,
    ]);
    expect(res.ok).toBe(false);
  });
});

describe('menu rules the server enforces at the till', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  it('an item 86’d at this branch cannot be sold here even though its base price exists', async () => {
    await admin(
      `insert into public.branch_item_prices (org_id, branch_id, menu_item_id, price_poisha, is_available) values ($1, $2, $3, 6000, false)`,
      [ctx.org.id, ctx.branchId, ctx.borhani],
    );
    const res = await attempt(
      ctx,
      SUBMIT,
      submitParams(ctx, [{ menu_item_id: ctx.borhani, quantity: 1 }]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('22023');
  });

  it('modifiers must belong to the item and stay within each group’s min/max', async () => {
    const tooMany = await attempt(
      ctx,
      SUBMIT,
      submitParams(ctx, [
        { menu_item_id: ctx.kacchi, quantity: 1, modifier_ids: [ctx.mild, ctx.hot] },
      ]),
    );
    expect(tooMany.ok).toBe(false);
    const foreign = await attempt(
      ctx,
      SUBMIT,
      submitParams(ctx, [{ menu_item_id: ctx.borhani, quantity: 1, modifier_ids: [ctx.egg] }]),
    );
    expect(foreign.ok, 'a modifier from another item is refused').toBe(false);

    await admin('update public.modifier_groups set min_select = 1 where id = $1', [ctx.spiceGroup]);
    const missingRequired = await attempt(
      ctx,
      SUBMIT,
      submitParams(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]),
    );
    expect(missingRequired.ok).toBe(false);

    const ok = await submit(ctx, [
      { menu_item_id: ctx.kacchi, quantity: 2, modifier_ids: [ctx.hot, ctx.egg, ctx.egg] },
    ]);
    // (300 + 20 egg, counted once) × 2 = 640 net; +5% = 672.
    expect(n(ok.total_poisha)).toBe(67_200);
    const mods = await admin<{ name_snapshot: string }>(
      `select m.name_snapshot from public.order_item_modifiers m join public.order_items i on i.id = m.order_item_id
       where i.order_id = $1 order by m.name_snapshot`,
      [ok.id],
    );
    expect(mods.map((m) => m.name_snapshot)).toEqual(['Egg', 'Hot']);
    await admin('update public.modifier_groups set min_select = 0 where id = $1', [ctx.spiceGroup]);
  });

  it('a variant adds its delta and names the line', async () => {
    const order = await submit(ctx, [
      { menu_item_id: ctx.kacchi, quantity: 1, variant_id: ctx.half },
    ]);
    const [line] = await admin<{ name_snapshot: string; unit_price_poisha: string }>(
      'select name_snapshot, unit_price_poisha from public.order_items where order_id = $1',
      [order.id],
    );
    expect(line!.name_snapshot).toBe('Kacchi (Half)');
    expect(n(line!.unit_price_poisha)).toBe(18_000);
  });

  it('a client price that disagrees is logged, and the server price is what gets charged', async () => {
    const order = await submit(ctx, [
      { menu_item_id: ctx.kacchi, quantity: 1, client_unit_price_poisha: 25_000 },
    ]);
    expect(n(order.total_poisha)).toBe(31_500);
    const [audit] = await admin<{ after: { lines: { client: number; server: number }[] } }>(
      `select after from public.audit_log where org_id = $1 and action = 'order.price_mismatch' and entity_id = $2`,
      [ctx.org.id, order.id],
    );
    expect(audit!.after.lines[0]).toMatchObject({ client: 25_000, server: 30_000 });
  });
});

describe('order numbers, provisional receipts and time', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  it('numbers orders per branch per business day, and keeps an offline provisional number', async () => {
    const a = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    const b = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }], {
      provisional: 'P-AB12-260927-0007',
    });
    expect(n(b.order_number)).toBe(n(a.order_number) + 1);
    expect(b.provisional_receipt_no).toBe('P-AB12-260927-0007');
  });

  it('accepts an offline sale time from the past but refuses one from the future', async () => {
    const past = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }], {
      placedAt: '2026-01-10T08:00:00Z',
    });
    expect(new Date(past.placed_at as string).toISOString()).toBe('2026-01-10T08:00:00.000Z');
    const future = await attempt(
      ctx,
      SUBMIT,
      submitParams(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }], {
        placedAt: '2999-01-01T00:00:00Z',
      }),
    );
    expect(future.ok).toBe(false);
  });
});

describe('rounds and the kitchen', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  const ADD = 'select * from public.add_order_items($1,$2,$3,$4,$5,$6,$7::jsonb)';

  it('adds a second round once per batch key and puts a served order back on the kitchen screen', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    await sendKitchen(ctx, order.id);
    for (const s of ['preparing', 'ready', 'served']) expect(await advance(ctx, order.id)).toBe(s);

    const key = randomUUID();
    const params = [
      ctx.org.id,
      ctx.branchId,
      order.id,
      key,
      ctx.deviceId,
      ctx.cashierStaff,
      JSON.stringify([{ menu_item_id: ctx.borhani, quantity: 2 }]),
    ];
    const [first] = await call(ctx, ADD, params);
    const [retry] = await call(ctx, ADD, params);
    expect(n(first!.total_poisha)).toBe(31_500 + 12_600);
    expect(n(retry!.total_poisha)).toBe(n(first!.total_poisha));
    expect(await lineIds(order.id)).toHaveLength(2);

    await sendKitchen(ctx, order.id);
    const lines = await admin<{ kot_sent_at: Date | null }>(
      'select kot_sent_at from public.order_items where order_id = $1 order by created_at',
      [order.id],
    );
    expect(lines.every((l) => l.kot_sent_at !== null)).toBe(true);
    expect(lines[1]!.kot_sent_at!.getTime()).toBeGreaterThanOrEqual(
      lines[0]!.kot_sent_at!.getTime(),
    );
    const [o] = await admin<{ order_status: string }>(
      'select order_status from public.orders where id = $1',
      [order.id],
    );
    expect(o!.order_status).toBe('sent_to_kitchen');
    const events = await admin<{ event_type: string }>(
      'select event_type::text from public.order_events where order_id = $1 order by occurred_at, event_type',
      [order.id],
    );
    expect(events.map((e) => e.event_type)).toContain('items_added');

    const nothingNew = await attempt(ctx, 'select public.send_to_kitchen($1,$2,$3,$4,$5)', [
      ctx.org.id,
      ctx.branchId,
      order.id,
      ctx.deviceId,
      ctx.cashierStaff,
    ]);
    expect(nothingNew.ok).toBe(false);
  });
});

describe('payments, change and completion', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  it('cash above the balance is change, not revenue', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]); // 315.00
    const paid = await pay(ctx, order.id, 'cash', 50_000);
    expect(paid.payment_status).toBe('paid');
    const [p] = await admin<{ amount_poisha: string; tendered_poisha: string }>(
      'select amount_poisha, tendered_poisha from public.payments where order_id = $1',
      [order.id],
    );
    expect(n(p!.amount_poisha)).toBe(31_500);
    expect(n(p!.tendered_poisha)).toBe(50_000);
  });

  it('a card or wallet payment above the balance is refused', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    const res = await attempt(ctx, PAY, [
      ctx.org.id,
      ctx.branchId,
      order.id,
      'bkash',
      50_000,
      randomUUID(),
      ctx.deviceId,
      ctx.cashierStaff,
    ]);
    expect(res.ok).toBe(false);
  });

  it('paying keeps the kitchen ticket open; serving a paid order completes it', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }], {
      channel: ctx.takeaway,
    });
    await sendKitchen(ctx, order.id);
    const paid = await pay(ctx, order.id, 'nagad', 31_500);
    expect(paid).toMatchObject({ payment_status: 'paid', order_status: 'sent_to_kitchen' });
    for (const s of ['preparing', 'ready', 'served']) expect(await advance(ctx, order.id)).toBe(s);
    const [o] = await admin<{ order_status: string }>(
      'select order_status from public.orders where id = $1',
      [order.id],
    );
    expect(o!.order_status).toBe('completed');
  });

  it('a served order that is paid afterwards completes at payment', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    await sendKitchen(ctx, order.id);
    for (let i = 0; i < 3; i++) await advance(ctx, order.id);
    const paid = await pay(ctx, order.id, 'cash', 31_500);
    expect(paid).toMatchObject({ payment_status: 'paid', order_status: 'completed' });
  });
});

describe('refunds', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  const REFUND = 'select * from public.refund_order($1,$2,$3,$4,$5,$6,null,$7,$8,$9,$10)';
  const refundParams = (
    ctx: Ctx,
    orderId: unknown,
    amount: number,
    approval: unknown,
    key = randomUUID(),
  ) => [
    ctx.org.id,
    ctx.branchId,
    orderId,
    'cash',
    amount,
    ctx.reasonRefund,
    key,
    ctx.deviceId,
    ctx.cashierStaff,
    approval,
  ];

  it('needs a manager approval, never exceeds what was paid, and a retry is a no-op', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    await pay(ctx, order.id, 'cash', 31_500);

    const noApproval = await attempt(ctx, REFUND, refundParams(ctx, order.id, 10_000, null));
    expect(noApproval.ok).toBe(false);
    if (!noApproval.ok) expect(noApproval.code).toBe('42501');

    const key = randomUUID();
    const a1 = await approve(ctx, ctx.managerStaff, '9999', 'refund');
    const [partial] = await call(
      ctx,
      REFUND,
      refundParams(ctx, order.id, 10_000, a1.approval_id, key),
    );
    expect(partial!.payment_status).toBe('partially_refunded');
    const [again] = await call(
      ctx,
      REFUND,
      refundParams(ctx, order.id, 10_000, a1.approval_id, key),
    );
    expect(again!.payment_status).toBe('partially_refunded');
    const [count] = await admin<{ c: number }>(
      'select count(*)::int as c from public.refunds where order_id = $1',
      [order.id],
    );
    expect(count!.c).toBe(1);

    const a2 = await approve(ctx, ctx.managerStaff, '9999', 'refund');
    const tooMuch = await attempt(ctx, REFUND, refundParams(ctx, order.id, 21_501, a2.approval_id));
    expect(tooMuch.ok).toBe(false);
    const a3 = await approve(ctx, ctx.managerStaff, '9999', 'refund');
    const [full] = await call(ctx, REFUND, refundParams(ctx, order.id, 21_500, a3.approval_id));
    expect(full!.payment_status).toBe('refunded');
    const audits = await admin<{ c: number }>(
      `select count(*)::int as c from public.audit_log where org_id = $1 and action = 'order.refund' and entity_id = $2`,
      [ctx.org.id, order.id],
    );
    expect(audits[0]!.c).toBe(2);
  });

  it('shift math: expected = float + cash taken (change excluded) − cash refunded', async () => {
    const [shift] = await call(ctx, 'select * from public.open_shift($1,$2,$3,$4,$5)', [
      ctx.org.id,
      ctx.branchId,
      ctx.deviceId,
      ctx.cashierStaff,
      100_000,
    ]);
    const cashOrder = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    await pay(ctx, cashOrder.id, 'cash', 50_000); // ৳315 bill, ৳500 handed over, ৳185 change
    const cardOrder = await submit(ctx, [{ menu_item_id: ctx.borhani, quantity: 1 }]);
    await pay(ctx, cardOrder.id, 'card', 6_300);
    const a = await approve(ctx, ctx.managerStaff, '9999', 'refund');
    await call(ctx, REFUND, refundParams(ctx, cashOrder.id, 5_000, a.approval_id));

    // The cashier is not manager-level: closing needs a manager approval too.
    const CLOSE = 'select * from public.close_shift($1,$2,$3,$4,$5,$6,$7)';
    const expected = 100_000 + 31_500 - 5_000;
    const noApproval = await attempt(ctx, CLOSE, [
      ctx.org.id,
      ctx.branchId,
      shift!.id,
      expected,
      ctx.deviceId,
      ctx.cashierStaff,
      null,
    ]);
    expect(noApproval.ok).toBe(false);
    const closeApproval = await approve(ctx, ctx.managerStaff, '9999', 'close_shift');
    const [closed] = await call(ctx, CLOSE, [
      ctx.org.id,
      ctx.branchId,
      shift!.id,
      expected - 2_000,
      ctx.deviceId,
      ctx.cashierStaff,
      closeApproval.approval_id,
    ]);
    expect(n(closed!.expected_cash_poisha)).toBe(expected);
    expect(n(closed!.over_short_poisha)).toBe(-2_000);
  });
});

describe('cancelling an order', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  const CANCEL = 'select * from public.cancel_order($1,$2,$3,$4,null,$5,$6,$7)';

  it('an order that never reached the kitchen cancels without approval', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 2 }]);
    const [c] = await call(ctx, CANCEL, [
      ctx.org.id,
      ctx.branchId,
      order.id,
      ctx.reasonVoid,
      ctx.deviceId,
      ctx.cashierStaff,
      null,
    ]);
    expect(c).toMatchObject({ order_status: 'cancelled' });
    expect(n(c!.total_poisha)).toBe(0);
    const [v] = await admin<{ c: number }>(
      'select count(*)::int as c from public.voids where order_id = $1',
      [order.id],
    );
    expect(v!.c).toBe(1);
  });

  it('after the KOT it needs an approval, and a paid order cannot be cancelled', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    await sendKitchen(ctx, order.id);
    const params = (approval: unknown) => [
      ctx.org.id,
      ctx.branchId,
      order.id,
      ctx.reasonVoid,
      ctx.deviceId,
      ctx.cashierStaff,
      approval,
    ];
    expect((await attempt(ctx, CANCEL, params(null))).ok).toBe(false);
    const a = await approve(ctx, ctx.managerStaff, '9999', 'cancel_order');
    const [c] = await call(ctx, CANCEL, params(a.approval_id));
    expect(c!.order_status).toBe('cancelled');

    const paidOrder = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    await pay(ctx, paidOrder.id, 'cash', 31_500);
    const res = await attempt(ctx, CANCEL, [
      ctx.org.id,
      ctx.branchId,
      paidOrder.id,
      ctx.reasonVoid,
      ctx.deviceId,
      ctx.cashierStaff,
      null,
    ]);
    expect(res.ok).toBe(false);
  });
});

describe('customers at the till (CLAUDE.md #8)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  it('normalises Bangladeshi mobile numbers and rejects everything else', async () => {
    const cases: [string, string | null][] = [
      ['01712345678', '+8801712345678'],
      ['+880 1712-345678', '+8801712345678'],
      ['8801912345678', '+8801912345678'],
      ['008801512345678', '+8801512345678'],
      ['০১৭১২৩৪৫৬৭৮', '+8801712345678'],
      ['01212345678', null],
      ['1712345678', null],
      ['+14155552671', null],
      ['', null],
    ];
    for (const [input, expected] of cases) {
      const [r] = await admin<{ p: string | null }>('select private.normalize_bd_phone($1) as p', [
        input,
      ]);
      expect(r!.p, input).toBe(expected);
    }
  });

  it('attaches the customer, records consent only when the answer changes, and masks the phone in the audit log', async () => {
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    const ATTACH = 'select public.attach_customer($1,$2,$3,$4,$5,$6,$7,$8) as id';
    const attach = (phone: string, consent: boolean | null) =>
      call<{ id: string }>(ctx, ATTACH, [
        ctx.org.id,
        ctx.branchId,
        order.id,
        phone,
        'Nadia',
        consent,
        ctx.deviceId,
        ctx.cashierStaff,
      ]);
    const [c1] = await attach('01712345678', true);
    const [c2] = await attach('+8801712345678', true);
    expect(c2!.id).toBe(c1!.id);
    const consentCount = async () =>
      (
        await admin<{ c: number }>(
          'select count(*)::int as c from public.consents where customer_id = $1',
          [c1!.id],
        )
      )[0]!.c;
    expect(await consentCount()).toBe(2); // whatsapp + sms, not duplicated on the repeat
    await attach('01712345678', false);
    expect(await consentCount()).toBe(4);

    const [o] = await admin<{ customer_id: string }>(
      'select customer_id from public.orders where id = $1',
      [order.id],
    );
    expect(o!.customer_id).toBe(c1!.id);
    const audits = await admin<{ after: { phone: string } }>(
      `select after from public.audit_log where org_id = $1 and action = 'order.customer'`,
      [ctx.org.id],
    );
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) {
      expect(a.after.phone).toBe('+88017******78');
      expect(JSON.stringify(a)).not.toContain('1712345678');
    }
    const bad = await attempt(ctx, ATTACH, [
      ctx.org.id,
      ctx.branchId,
      order.id,
      '12345',
      null,
      null,
      ctx.deviceId,
      ctx.cashierStaff,
    ]);
    expect(bad.ok).toBe(false);
  });
});

describe('staff: a branch manager cannot mint a manager-level identity', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  const INSERT = `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, $3, $4) returning id`;

  it('the manager can add a cashier but not a manager; the owner can add both; all audited', async () => {
    const asManager = (sql: string, params: unknown[]) =>
      asUser(ctx.manager, (s) => s.attempt<{ id: string }>(sql, params), { commit: true });
    const cashierRow = await asManager(INSERT, [ctx.org.id, ctx.branchId, 'Karim', 'cashier']);
    expect(cashierRow.ok).toBe(true);
    const managerRow = await asManager(INSERT, [
      ctx.org.id,
      ctx.branchId,
      'Sock Puppet',
      'manager',
    ]);
    expect(managerRow.ok).toBe(false);
    if (!managerRow.ok) expect(managerRow.code).toBe('42501');
    if (cashierRow.ok) {
      const promote = await asManager(`update public.staff set role = 'manager' where id = $1`, [
        cashierRow.rows[0]!.id,
      ]);
      expect(promote.ok).toBe(false);
      const audit = await admin<{ action: string }>(
        `select action from public.audit_log where org_id = $1 and entity = 'staff' and entity_id = $2`,
        [ctx.org.id, cashierRow.rows[0]!.id],
      );
      expect(audit.map((a) => a.action)).toContain('staff.insert');
    }
    const ownerRow = await asUser(
      ctx.org.owner,
      (s) => s.attempt(INSERT, [ctx.org.id, ctx.branchId, 'Deputy', 'manager']),
      { commit: true },
    );
    expect(ownerRow.ok).toBe(true);
  });

  it('the manager cannot reset a manager-level PIN; the owner can', async () => {
    const byManager = await asUser(ctx.manager, (s) =>
      s.attempt('select public.set_staff_pin($1, $2)', [ctx.managerStaff, '1111']),
    );
    expect(byManager.ok).toBe(false);
    if (!byManager.ok) expect(byManager.code).toBe('42501');
    const cashierPin = await asUser(ctx.manager, (s) =>
      s.attempt('select public.set_staff_pin($1, $2)', [ctx.cashierStaff, '2468']),
    );
    expect(cashierPin.ok).toBe(true);
    const byOwner = await asUser(ctx.org.owner, (s) =>
      s.attempt('select public.set_staff_pin($1, $2)', [ctx.managerStaff, '1111']),
    );
    expect(byOwner.ok).toBe(true);
  });
});

describe('price history (CLAUDE.md #5)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);

  it('a base price change and a branch override are both recorded and audited', async () => {
    await asUser(
      ctx.org.owner,
      (s) =>
        s.q('update public.menu_items set base_price_poisha = 32000 where id = $1', [ctx.kacchi]),
      { commit: true },
    );
    await asUser(
      ctx.manager,
      (s) =>
        s.q(
          `insert into public.branch_item_prices (org_id, branch_id, menu_item_id, price_poisha) values ($1, $2, $3, 33000)`,
          [ctx.org.id, ctx.branchId, ctx.kacchi],
        ),
      { commit: true },
    );
    const history = await admin<{
      branch_id: string | null;
      old_price_poisha: string | null;
      new_price_poisha: string;
      changed_by: string;
    }>(
      `select branch_id, old_price_poisha, new_price_poisha, changed_by from public.price_history
       where menu_item_id = $1 order by changed_at, new_price_poisha`,
      [ctx.kacchi],
    );
    expect(
      history.map((h) => [
        h.branch_id,
        h.old_price_poisha && n(h.old_price_poisha),
        n(h.new_price_poisha),
      ]),
    ).toEqual([
      [null, 30_000, 32_000],
      [ctx.branchId, null, 33_000],
    ]);
    expect(history[0]!.changed_by).toBe(ctx.org.owner.id);
    const audit = await admin<{ action: string }>(
      `select action from public.audit_log where org_id = $1 and action in ('menu_item.update', 'branch_item_price.insert')`,
      [ctx.org.id],
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      'branch_item_price.insert',
      'menu_item.update',
    ]);

    // The till now charges the branch price.
    const order = await submit(ctx, [{ menu_item_id: ctx.kacchi, quantity: 1 }]);
    expect(n(order.net_poisha)).toBe(33_000);
  });
});

describe('defaults for a new restaurant', () => {
  it('ensure_org_defaults is owner-only and idempotent', async () => {
    const org = await createOrg({ branches: ['Uttara', 'Banani'] });
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const byManager = await asUser(manager, (s) =>
      s.attempt('select public.ensure_org_defaults($1)', [org.id]),
    );
    expect(byManager.ok).toBe(false);
    for (let i = 0; i < 2; i++) {
      await asUser(org.owner, (s) => s.q('select public.ensure_org_defaults($1)', [org.id]), {
        commit: true,
      });
    }
    const [counts] = await admin<{ channels: number; reasons: number; stations: number }>(
      `select (select count(*)::int from public.channels where org_id = $1) as channels,
              (select count(*)::int from public.reason_codes where org_id = $1) as reasons,
              (select count(*)::int from public.stations where org_id = $1) as stations`,
      [org.id],
    );
    // 10 till reasons (void, discount, refund) + 5 waste reasons from Phase 5 (ADR 0018).
    expect(counts).toEqual({ channels: 5, reasons: 15, stations: 2 });
  });
});

// The offline outbox (src/modules/pos/outbox.ts) replays operations whose responses were lost.
// ROADMAP Phase 1: "20 orders created with network off sync exactly once after reconnect".
describe('offline replay is exactly-once', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  });

  it('replaying 20 queued orders, kitchen sends and payments creates each once', async () => {
    const { at } = await one<{ at: string }>(
      `select (now() - interval '40 minutes')::text as at`,
      [],
    );
    const queued = Array.from({ length: 20 }, (_, i) => ({
      orderId: randomUUID(),
      orderKey: randomUUID(),
      payKey: randomUUID(),
      provisional: `P-OFF-${i + 1}`,
    }));
    const lines = JSON.stringify([{ menu_item_id: ctx.kacchi, quantity: 1 }]);

    const replayAll = async () => {
      for (const q of queued) {
        await call(ctx, SUBMIT, [
          ctx.org.id,
          ctx.branchId,
          q.orderId,
          q.orderKey,
          ctx.deviceId,
          ctx.cashierStaff,
          ctx.takeaway,
          null,
          at,
          lines,
          q.provisional,
        ]);
        const sent = await asUser(
          ctx.manager,
          (s) =>
            s.attempt('select public.send_to_kitchen($1,$2,$3,$4,$5)', [
              ctx.org.id,
              ctx.branchId,
              q.orderId,
              ctx.deviceId,
              ctx.cashierStaff,
            ]),
          { commit: true },
        );
        // The outbox treats exactly this refusal as "already sent" (client.ts posTransport).
        if (!sent.ok) expect(sent.message).toContain('nothing new to send to the kitchen');
        await pay(ctx, q.orderId, 'cash', 40_000, q.payKey);
      }
    };
    await replayAll();
    await replayAll();

    const ids = queued.map((q) => q.orderId);
    const [counts] = await admin<{
      orders: number;
      payments: number;
      paid: number;
      creates: number;
      numbers: number;
      span: number;
    }>(
      `select (select count(*)::int from public.orders where id = any($1::uuid[])) as orders,
              (select count(*)::int from public.payments where order_id = any($1::uuid[])) as payments,
              (select count(*)::int from public.orders where id = any($1::uuid[]) and payment_status = 'paid') as paid,
              (select count(*)::int from public.audit_log where action = 'order.create' and entity_id = any($2::text[])) as creates,
              (select count(distinct order_number)::int from public.orders where id = any($1::uuid[])) as numbers,
              (select (max(order_number) - min(order_number) + 1)::int from public.orders where id = any($1::uuid[])) as span`,
      [ids, ids],
    );
    expect(counts).toEqual({
      orders: 20,
      payments: 20,
      paid: 20,
      creates: 20,
      numbers: 20,
      span: 20,
    });

    const rows = await admin<{ provisional_receipt_no: string; placed_at: string; amount: string }>(
      `select o.provisional_receipt_no, o.placed_at::text, p.amount_poisha::text as amount
         from public.orders o join public.payments p on p.order_id = o.id
        where o.id = any($1::uuid[]) order by o.provisional_receipt_no`,
      [ids],
    );
    expect(new Set(rows.map((r) => r.provisional_receipt_no)).size).toBe(20);
    // The order keeps the time it was rung up offline, and change never counts as revenue.
    expect(rows.every((r) => r.placed_at === at)).toBe(true);
    expect(rows.every((r) => r.amount === '31500')).toBe(true);
  });
});
