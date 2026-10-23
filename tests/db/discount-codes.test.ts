/**
 * Discount codes (ADR 0038): the owner or a manager makes a secret code, the cashier types it at the till.
 * One Kacchi is ৳300.00 = 30000 poisha gross, so 10% is 3000 and 25% is 7500.
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

interface Fx {
  org: TestOrg;
  branch: string;
  manager: TestUser;
  cashier: TestUser;
  deviceId: string;
  staffId: string;
  channel: string;
  item: string;
  reason: string;
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
  const [reason] = await admin<{ id: string }>(
    `insert into public.reason_codes (org_id, kind, code, label) values ($1, 'discount', 'regular', 'Regular customer') returning id`,
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
    reason: reason!.id,
  };
}

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
    { commit: true },
  ).then((r) => r[0]!);

const CALL = 'select * from public.apply_discount_code($1,$2,$3,$4,$5,$6)';
const args = (fx: Fx, orderId: unknown, code: string) => [
  fx.org.id,
  fx.branch,
  orderId,
  code,
  fx.deviceId,
  fx.staffId,
];

/** Try a code and roll back, so it leaves no use behind. */
const tryCode = (fx: Fx, orderId: unknown, code: string) =>
  asUser(fx.manager, (s) => s.attempt(CALL, args(fx, orderId, code)));

/** Use a code for real, so the next bill sees this use. */
const useCode = (fx: Fx, orderId: unknown, code: string) =>
  asUser(fx.manager, (s) => s.q<Record<string, unknown>>(CALL, args(fx, orderId, code)), {
    commit: true,
  }).then((r) => r[0]!);

const makeCode = (
  fx: Fx,
  code: string,
  extra: Partial<{ percent: number; maxUses: number; endsOn: string; active: boolean }> = {},
) =>
  admin(
    `insert into public.discount_codes (org_id, code, percent_bps, max_uses, ends_on, is_active)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      fx.org.id,
      code,
      extra.percent ?? 1000,
      extra.maxUses ?? null,
      extra.endsOn ?? null,
      extra.active ?? true,
    ],
  );

describe('discount codes', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture();
  }, 60_000);

  it('a code takes its percent off the bill, and the typing does not have to match case or dashes', async () => {
    await makeCode(fx, 'EID10');
    const order = await newOrder(fx); // net 30000, vat 1500, total 31500
    const res = await useCode(fx, order.id, ' eid-10 ');
    expect(Number(res.discount_poisha)).toBe(3_000);
    expect(Number(res.net_poisha)).toBe(27_000);
    expect(Number(res.total_poisha)).toBe(28_350);
    const [d] = await admin<{
      percent_bps: number;
      reason_note: string;
      discount_code_id: string | null;
    }>(
      'select percent_bps, reason_note, discount_code_id from public.discounts where org_id = $1 and order_id = $2',
      [fx.org.id, order.id],
    );
    expect(d!.percent_bps).toBe(1000);
    expect(d!.reason_note).toBe('Code EID10');
    expect(d!.discount_code_id).not.toBeNull();
    const audit = await admin(
      `select 1 from public.audit_log where org_id = $1 and action = 'order.discount' and entity_id = $2`,
      [fx.org.id, String(order.id)],
    );
    expect(audit).toHaveLength(1);
  });

  it('an unknown code, a turned-off code and a too-short code all say "not found"', async () => {
    await makeCode(fx, 'OFFCODE', { active: false });
    const order = await newOrder(fx);
    for (const code of ['NOPE99', 'OFFCODE', 'AB', '']) {
      const r = await tryCode(fx, order.id, code);
      expect(r.ok, code).toBe(false);
      expect(JSON.stringify(r), code).toContain('code_not_found');
    }
  });

  it('a code stops working after its end date, counted in business days', async () => {
    const order = await newOrder(fx);
    const [row] = await admin<{ d: string }>(
      'select business_date::text as d from public.orders where id = $1',
      [order.id],
    );
    await makeCode(fx, 'LASTDAY', { endsOn: row!.d });
    await makeCode(fx, 'LONGAGO', { endsOn: '2000-01-01' });
    expect((await tryCode(fx, order.id, 'LASTDAY')).ok).toBe(true);
    const late = await tryCode(fx, order.id, 'LONGAGO');
    expect(late.ok).toBe(false);
    expect(JSON.stringify(late)).toContain('code_expired');
  });

  it('a once-only code works for one bill, and the use comes back if that bill is cancelled', async () => {
    await makeCode(fx, 'ONCEONLY', { maxUses: 1, percent: 2500 });
    const first = await newOrder(fx);
    const second = await newOrder(fx);
    const res = await useCode(fx, first.id, 'ONCEONLY');
    expect(Number(res.discount_poisha)).toBe(7_500);
    // Typing it again on the same bill is fine (it is not a second use).
    expect((await tryCode(fx, first.id, 'ONCEONLY')).ok).toBe(true);
    // Another bill is refused.
    const refused = await tryCode(fx, second.id, 'ONCEONLY');
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).toContain('code_used_up');

    // Cancelling the first bill gives the use back.
    await admin(`update public.orders set order_status = 'cancelled' where id = $1`, [first.id]);
    expect((await tryCode(fx, second.id, 'ONCEONLY')).ok).toBe(true);
  });

  it('replacing the code with another discount gives the use back', async () => {
    await makeCode(fx, 'SWAPPED', { maxUses: 1 });
    const first = await newOrder(fx);
    const second = await newOrder(fx);
    await useCode(fx, first.id, 'SWAPPED');
    expect((await tryCode(fx, second.id, 'SWAPPED')).ok).toBe(false);
    await asUser(
      fx.manager,
      (s) =>
        s.q('select * from public.apply_order_discount($1,$2,$3,$4,$5,$6,$7,$8)', [
          fx.org.id,
          fx.branch,
          first.id,
          500,
          fx.reason,
          null,
          fx.deviceId,
          fx.staffId,
        ]),
      { commit: true },
    );
    expect((await tryCode(fx, second.id, 'SWAPPED')).ok).toBe(true);
  });

  it('a code cannot be used on a paid bill', async () => {
    await makeCode(fx, 'PAIDBILL');
    const order = await newOrder(fx);
    await asUser(
      fx.manager,
      (s) =>
        s.q('select public.send_to_kitchen($1,$2,$3,$4,$5)', [
          fx.org.id,
          fx.branch,
          order.id,
          fx.deviceId,
          fx.staffId,
        ]),
      { commit: true },
    );
    await asUser(
      fx.manager,
      (s) =>
        s.q('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          fx.org.id,
          fx.branch,
          order.id,
          'cash',
          order.total_poisha,
          null,
          randomUUID(),
          fx.deviceId,
          fx.staffId,
        ]),
      { commit: true },
    );
    expect((await tryCode(fx, order.id, 'PAIDBILL')).ok).toBe(false);
  });

  it('only the owner and managers can see or change the codes; a cashier cannot', async () => {
    await makeCode(fx, 'SECRET1');
    const seen = (u: TestUser) =>
      asUser(u, (s) =>
        s.q<{ code: string }>('select code from public.discount_codes where org_id = $1', [
          fx.org.id,
        ]),
      );
    expect((await seen(fx.manager)).map((r) => r.code)).toContain('SECRET1');
    expect(await seen(fx.cashier)).toEqual([]);

    const insert = (u: TestUser, code: string) =>
      asUser(u, (s) =>
        s.attempt(
          `insert into public.discount_codes (org_id, code, percent_bps) values ($1, $2, 500)`,
          [fx.org.id, code],
        ),
      );
    expect((await insert(fx.manager, 'BYMANAGER')).ok).toBe(true);
    expect((await insert(fx.cashier, 'BYCASHIER')).ok).toBe(false);
  });

  it('the list of uses counts bills for managers and is refused to a cashier', async () => {
    await makeCode(fx, 'COUNTED', { maxUses: 5 });
    const a = await newOrder(fx);
    const b = await newOrder(fx);
    const c = await newOrder(fx);
    await useCode(fx, a.id, 'COUNTED');
    await useCode(fx, b.id, 'COUNTED');
    await useCode(fx, c.id, 'COUNTED');
    await admin(`update public.orders set order_status = 'cancelled' where id = $1`, [c.id]);
    const [code] = await admin<{ id: string }>(
      `select id from public.discount_codes where org_id = $1 and code = 'COUNTED'`,
      [fx.org.id],
    );
    const uses = await asUser(fx.manager, (s) =>
      s.q<{ discount_code_id: string; uses: string }>(
        'select * from public.discount_code_uses($1)',
        [fx.org.id],
      ),
    );
    expect(Number(uses.find((u) => u.discount_code_id === code!.id)?.uses)).toBe(2);
    const refused = await asUser(fx.cashier, (s) =>
      s.attempt('select * from public.discount_code_uses($1)', [fx.org.id]),
    );
    expect(refused.ok).toBe(false);
  });

  it('a code is written in capitals and digits, 4 to 20 of them, once per restaurant', async () => {
    for (const bad of ['eid10', 'EID-10', 'ABC', 'A'.repeat(21)]) {
      const r = await asUser(fx.manager, (s) =>
        s.attempt(
          `insert into public.discount_codes (org_id, code, percent_bps) values ($1, $2, 500)`,
          [fx.org.id, bad],
        ),
      );
      expect(r.ok, bad).toBe(false);
    }
    const dup = await asUser(fx.manager, (s) =>
      s.attempt(
        `insert into public.discount_codes (org_id, code, percent_bps) values ($1, 'EID10', 500)`,
        [fx.org.id],
      ),
    );
    expect(dup.ok).toBe(false);
  });
});
