/**
 * Shared POS devices (ARCHITECTURE.md "Tenancy & security"): a device is registered to a branch and
 * staff switch with a hashed 4–6 digit PIN. With so few digits the lockout is the real protection, so
 * it is tested most carefully — including that failed attempts survive (a raised error would roll
 * the counter back and defeat the lock).
 */
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

let org: TestOrg;
let manager: TestUser;
let cashierAccount: TestUser;
let deviceId: string;
let staffId: string;

async function newStaff(branchId: string, name = 'Rahim'): Promise<string> {
  const [row] = await admin<{ id: string }>(
    `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, $3, 'cashier') returning id`,
    [org.id, branchId, name],
  );
  return row!.id;
}

const start = (user: TestUser, device: string, staff: string, pin: string) =>
  asUser(
    user,
    async (s) =>
      (
        await s.q<{ r: Record<string, unknown> }>(
          'select public.start_staff_session($1, $2, $3) as r',
          [device, staff, pin],
        )
      )[0]!.r,
    {
      commit: true,
    },
  );

beforeAll(async () => {
  org = await createOrg({ branches: ['Dhanmondi', 'Mirpur'] });
  manager = await addMember(org, 'manager', [org.branchIds[0]!]);
  cashierAccount = await addMember(org, 'cashier', [org.branchIds[0]!]);
  staffId = await newStaff(org.branchIds[0]!);

  const reg = await asUser(
    manager,
    async (s) =>
      (
        await s.q<{ r: { device_id: string; pairing_code: string } }>(
          `select public.register_device($1, $2, 'Counter 1') as r`,
          [org.id, org.branchIds[0]],
        )
      )[0]!.r,
    { commit: true },
  );
  deviceId = reg.device_id;
  await asUser(
    cashierAccount,
    (s) => s.q('select public.claim_device($1, $2)', [deviceId, reg.pairing_code]),
    { commit: true },
  );
  await asUser(manager, (s) => s.q('select public.set_staff_pin($1, $2)', [staffId, '4821']), {
    commit: true,
  });
}, 60_000);

describe('device registration', () => {
  it('a pairing code activates the device once, and only for someone with branch access', async () => {
    const reg = await asUser(
      manager,
      async (s) =>
        (
          await s.q<{ r: { device_id: string; pairing_code: string } }>(
            `select public.register_device($1, $2, 'Counter 2') as r`,
            [org.id, org.branchIds[0]],
          )
        )[0]!.r,
      { commit: true },
    );
    const outsider = await createOrg();
    const stolen = await asUser(
      outsider.owner,
      async (s) =>
        (
          await s.q<{ ok: boolean }>('select public.claim_device($1, $2) as ok', [
            reg.device_id,
            reg.pairing_code,
          ])
        )[0]!.ok,
    );
    expect(stolen).toBe(false);

    const wrong = await asUser(
      cashierAccount,
      async (s) =>
        (
          await s.q<{ ok: boolean }>('select public.claim_device($1, $2) as ok', [
            reg.device_id,
            'WRONGCODE1',
          ])
        )[0]!.ok,
    );
    expect(wrong).toBe(false);
    const right = await asUser(
      cashierAccount,
      async (s) =>
        (
          await s.q<{ ok: boolean }>('select public.claim_device($1, $2) as ok', [
            reg.device_id,
            reg.pairing_code,
          ])
        )[0]!.ok,
      { commit: true },
    );
    expect(right).toBe(true);
    const reuse = await asUser(
      cashierAccount,
      async (s) =>
        (
          await s.q<{ ok: boolean }>('select public.claim_device($1, $2) as ok', [
            reg.device_id,
            reg.pairing_code,
          ])
        )[0]!.ok,
    );
    expect(reuse).toBe(false);

    const [dev] = await admin<{ status: string; pairing_code_hash: string | null }>(
      'select status, pairing_code_hash from public.devices where id = $1',
      [reg.device_id],
    );
    expect(dev).toEqual({ status: 'active', pairing_code_hash: null });
  });

  it('a cashier cannot register devices; a manager cannot register for a branch they do not have', async () => {
    const asCashier = await asUser(cashierAccount, (s) =>
      s.attempt(`select public.register_device($1, $2, 'x')`, [org.id, org.branchIds[0]]),
    );
    expect(asCashier.ok).toBe(false);
    const otherBranch = await asUser(manager, (s) =>
      s.attempt(`select public.register_device($1, $2, 'x')`, [org.id, org.branchIds[1]]),
    );
    expect(otherBranch.ok).toBe(false);
  });

  it('the pairing code is stored hashed, never in clear', async () => {
    const rows = await admin<{ pairing_code_hash: string | null }>(
      'select pairing_code_hash from public.devices where org_id = $1 and pairing_code_hash is not null',
      [org.id],
    );
    for (const r of rows) expect(r.pairing_code_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('staff PIN sessions', () => {
  it('the right PIN starts a session and audits it', async () => {
    const r = await start(cashierAccount, deviceId, staffId, '4821');
    expect(r.ok).toBe(true);
    expect(r.session_id).toBeTruthy();
    const audit = await admin(
      `select 1 from public.audit_log where org_id = $1 and action = 'staff.session_start' and actor_staff_id = $2`,
      [org.id, staffId],
    );
    expect(audit.length).toBeGreaterThan(0);
  });

  it('PINs are bcrypt-hashed, and staff_pins is unreachable by clients', async () => {
    const [row] = await admin<{ pin_hash: string }>(
      'select pin_hash from public.staff_pins where staff_id = $1',
      [staffId],
    );
    expect(row!.pin_hash).toMatch(/^\$2[aby]\$/);
    expect(row!.pin_hash).not.toContain('4821');
    const read = await asUser(manager, (s) => s.attempt('select * from public.staff_pins'));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe('42501');
  });

  it('rejects malformed PINs', async () => {
    for (const bad of ['123', '1234567', 'abcd', '12 34', '']) {
      const res = await asUser(manager, (s) =>
        s.attempt('select public.set_staff_pin($1, $2)', [staffId, bad]),
      );
      expect(res.ok, `PIN "${bad}"`).toBe(false);
    }
  });

  it('a wrong PIN does not raise, counts down, and five misses lock the account — and the count persists', async () => {
    const s2 = await newStaff(org.branchIds[0]!, 'Karim');
    await asUser(manager, (s) => s.q('select public.set_staff_pin($1, $2)', [s2, '9999']), {
      commit: true,
    });

    const attempts = [] as Record<string, unknown>[];
    for (let i = 0; i < 5; i++) attempts.push(await start(cashierAccount, deviceId, s2, '0000'));
    expect(attempts.map((a) => a.reason)).toEqual([
      'wrong_pin',
      'wrong_pin',
      'wrong_pin',
      'wrong_pin',
      'locked',
    ]);
    expect(attempts.map((a) => a.attempts_left)).toEqual([4, 3, 2, 1, 0]);

    // Locked: even the correct PIN is refused until the lock expires.
    const locked = await start(cashierAccount, deviceId, s2, '9999');
    expect(locked).toMatchObject({ ok: false, reason: 'locked' });
    const [pin] = await admin<{ locked_until: Date | null }>(
      'select locked_until from public.staff_pins where staff_id = $1',
      [s2],
    );
    expect(pin!.locked_until).not.toBeNull();

    // After the lock passes the right PIN works again and the counter is clean.
    await admin(
      `update public.staff_pins set locked_until = now() - interval '1 second' where staff_id = $1`,
      [s2],
    );
    expect((await start(cashierAccount, deviceId, s2, '9999')).ok).toBe(true);
    const [after] = await admin<{ failed_attempts: number }>(
      'select failed_attempts from public.staff_pins where staff_id = $1',
      [s2],
    );
    expect(after!.failed_attempts).toBe(0);
  });

  it('records failed attempts in the audit log', async () => {
    const rows = await admin(
      `select 1 from public.audit_log where org_id = $1 and action = 'staff.pin_failed'`,
      [org.id],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('refuses a staff member from another branch, a revoked device, and an outsider', async () => {
    const otherBranchStaff = await newStaff(org.branchIds[1]!, 'Other');
    await admin(
      `insert into public.staff_pins (staff_id, org_id, pin_hash) values ($1, $2, extensions.crypt('1111', extensions.gen_salt('bf', 4)))`,
      [otherBranchStaff, org.id],
    );
    expect(await start(cashierAccount, deviceId, otherBranchStaff, '1111')).toMatchObject({
      ok: false,
      reason: 'not_allowed',
    });

    const outsider = await createOrg();
    expect(await start(outsider.owner, deviceId, staffId, '4821')).toMatchObject({
      ok: false,
      reason: 'not_allowed',
    });

    await asUser(manager, (s) => s.q('select public.revoke_device($1)', [deviceId]), {
      commit: true,
    });
    expect(await start(cashierAccount, deviceId, staffId, '4821')).toMatchObject({
      ok: false,
      reason: 'not_allowed',
    });
    const open = await admin(
      'select 1 from public.staff_sessions where device_id = $1 and ended_at is null',
      [deviceId],
    );
    expect(open).toHaveLength(0);
  });
});
