/**
 * Notes (ADR 0055): private notes about a staff member or the restaurant. Owner and the branch's manager
 * only; a cashier, an accountant and another restaurant see nothing; a deleted staff member leaves the note.
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

describe('notes', () => {
  let org: TestOrg;
  let other: TestOrg;
  let manager: TestUser;
  let otherBranchManager: TestUser;
  let cashier: TestUser;
  let accountant: TestUser;
  let staffId: string;

  beforeAll(async () => {
    org = await createOrg({ branches: ['Main', 'Second'] });
    other = await createOrg({ branches: ['Other'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    otherBranchManager = await addMember(org, 'manager', [org.branchIds[1]!]);
    cashier = await addMember(org, 'cashier', [org.branchIds[0]!]);
    accountant = await addMember(org, 'accountant');
    const [s] = await admin<{ id: string }>(
      `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Rahim', 'cashier') returning id`,
      [org.id, org.branchIds[0]],
    );
    staffId = s!.id;
  });

  const add = (user: TestUser, branch: string, staff: string | null, body: string) =>
    asUser(
      user,
      (s) =>
        s.attempt(
          `insert into public.notes (org_id, branch_id, staff_id, body) values ($1, $2, $3, $4)`,
          [org.id, branch, staff, body],
        ),
      { commit: true },
    );

  it('the owner and the branch manager can write; the writer is recorded', async () => {
    expect((await add(org.owner, org.branchIds[0]!, staffId, 'Always on time')).ok).toBe(true);
    expect((await add(manager, org.branchIds[0]!, null, 'Fridge door is loose')).ok).toBe(true);
    const rows = await admin<{ created_by: string | null }>(
      `select created_by from public.notes where org_id = $1 and body = 'Fridge door is loose'`,
      [org.id],
    );
    expect(rows[0]!.created_by).toBe(manager.id);
  });

  it('a cashier and an accountant can neither read nor write; a manager of another branch sees nothing', async () => {
    expect((await add(cashier, org.branchIds[0]!, null, 'x')).ok).toBe(false);
    expect((await add(accountant, org.branchIds[0]!, null, 'x')).ok).toBe(false);
    expect((await add(otherBranchManager, org.branchIds[0]!, null, 'x')).ok).toBe(false);
    for (const u of [cashier, accountant, otherBranchManager]) {
      const rows = await asUser(u, (s) =>
        s.q(`select id from public.notes where org_id = $1`, [org.id]),
      );
      expect(rows).toHaveLength(0);
    }
    const seen = await asUser(manager, (s) =>
      s.q(`select id from public.notes where org_id = $1`, [org.id]),
    );
    expect(seen).toHaveLength(2);
  });

  it('another restaurant never sees these notes, and an empty note is refused', async () => {
    const rows = await asUser(other.owner, (s) =>
      s.q(`select id from public.notes where org_id = $1`, [org.id]),
    );
    expect(rows).toHaveLength(0);
    expect((await add(org.owner, org.branchIds[0]!, null, '   ')).ok).toBe(false);
  });

  it('the manager can delete a note; deleting the staff member keeps the note as a restaurant note', async () => {
    await asUser(
      manager,
      (s) => s.q(`delete from public.notes where body = 'Fridge door is loose'`),
      {
        commit: true,
      },
    );
    await admin(`delete from public.staff where id = $1`, [staffId]);
    const rows = await admin<{ staff_id: string | null; body: string }>(
      `select staff_id, body from public.notes where org_id = $1`,
      [org.id],
    );
    expect(rows).toEqual([{ staff_id: null, body: 'Always on time' }]);
  });
});
