/**
 * Branch setup → Tables: the owner or the branch's manager adds, removes (hides) and restores dining tables;
 * every table gets its own QR code; a cashier cannot change tables; another branch's manager cannot either.
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

describe('dining tables', () => {
  let org: TestOrg;
  let manager: TestUser;
  let otherManager: TestUser;
  let cashier: TestUser;

  beforeAll(async () => {
    org = await createOrg({ branches: ['Main', 'Second'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    otherManager = await addMember(org, 'manager', [org.branchIds[1]!]);
    cashier = await addMember(org, 'cashier', [org.branchIds[0]!]);
  });

  const add = (user: TestUser, name: string, seats: number | null = 2) =>
    asUser(
      user,
      (s) =>
        s.attempt(
          `insert into public.dining_tables (org_id, branch_id, name, seats) values ($1, $2, $3, $4)`,
          [org.id, org.branchIds[0], name, seats],
        ),
      { commit: true },
    );

  it('the manager adds a table without seats or with them, and it gets a QR code', async () => {
    expect((await add(manager, 'table one', 2)).ok).toBe(true);
    expect((await add(org.owner, 'T2', null)).ok).toBe(true);
    const rows = await admin<{ name: string; seats: number | null; qr_token: string }>(
      `select name, seats, qr_token from public.dining_tables where org_id = $1 order by name`,
      [org.id],
    );
    expect(rows.map((r) => [r.name, r.seats])).toEqual([
      ['T2', null],
      ['table one', 2],
    ]);
    for (const r of rows) expect(r.qr_token).toMatch(/^[0-9a-f]{32}$/);
    expect(rows[0]!.qr_token).not.toBe(rows[1]!.qr_token);
  });

  it('the same name twice in a branch is refused (code 23505) but is fine in another branch', async () => {
    const dup = await add(manager, 'table one');
    expect(dup.ok).toBe(false);
    expect(dup.ok === false && dup.code).toBe('23505');
    const [sibling] = await admin<{ id: string }>(
      `insert into public.dining_tables (org_id, branch_id, name) values ($1, $2, 'table one') returning id`,
      [org.id, org.branchIds[1]],
    );
    expect(sibling!.id).toBeTruthy();
  });

  it('remove hides a table and restore brings it back with the same QR code', async () => {
    const [before] = await admin<{ id: string; qr_token: string }>(
      `select id, qr_token from public.dining_tables where org_id = $1 and name = 'table one' and branch_id = $2`,
      [org.id, org.branchIds[0]],
    );
    await asUser(
      manager,
      (s) => s.q(`update public.dining_tables set is_active = false where id = $1`, [before!.id]),
      { commit: true },
    );
    // The till and the Table QR page read live tables only.
    const live = await asUser(manager, (s) =>
      s.q<{ name: string }>(
        `select name from public.dining_tables where org_id = $1 and branch_id = $2 and is_active order by name`,
        [org.id, org.branchIds[0]],
      ),
    );
    expect(live.map((r) => r.name)).toEqual(['T2']);
    await asUser(
      manager,
      (s) => s.q(`update public.dining_tables set is_active = true where id = $1`, [before!.id]),
      { commit: true },
    );
    const [after] = await admin<{ is_active: boolean; qr_token: string }>(
      `select is_active, qr_token from public.dining_tables where id = $1`,
      [before!.id],
    );
    expect(after).toEqual({ is_active: true, qr_token: before!.qr_token });
  });

  it('a cashier and another branch’s manager cannot add or hide tables', async () => {
    expect((await add(cashier, 'sneaky')).ok).toBe(false);
    expect((await add(otherManager, 'sneaky')).ok).toBe(false);
    const hidden = await asUser(
      otherManager,
      (s) =>
        s.q(
          `update public.dining_tables set is_active = false where org_id = $1 and branch_id = $2 returning id`,
          [org.id, org.branchIds[0]],
        ),
      { commit: true },
    );
    expect(hidden).toHaveLength(0);
  });
});
