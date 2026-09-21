/**
 * ROADMAP Phase 0 "Done when": an owner signs up, creates an org with branches, and invites a
 * manager limited to one branch (ADR 0003). Every membership change is audited (CLAUDE.md #5).
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  addMember,
  admin,
  asAnon,
  asUser,
  closePool,
  createOrg,
  createUser,
  membershipId,
} from './harness';

afterAll(closePool);

describe('create_organization', () => {
  it('creates the org, its settings, its branches and an all-branch owner membership atomically', async () => {
    const org = await createOrg({ branches: ['Dhanmondi', 'Mirpur'] });
    const [m] = await admin<{ role: string; branch_scope: string }>(
      'select role, branch_scope from public.memberships where org_id = $1 and user_id = $2',
      [org.id, org.owner.id],
    );
    expect(m).toMatchObject({ role: 'owner', branch_scope: 'all' });
    const counts = await admin<{ s: number; p: number; c: number; b: number }>(
      `select (select count(*)::int from public.org_settings where org_id = $1) as s,
              (select count(*)::int from public.org_profile where org_id = $1) as p,
              (select count(*)::int from public.org_cost_settings where org_id = $1) as c,
              (select count(*)::int from public.branches where org_id = $1) as b`,
      [org.id],
    );
    expect(counts[0]).toEqual({ s: 1, p: 1, c: 1, b: 2 });
  });

  it('defaults to a single Main branch when none are supplied', async () => {
    const owner = await createUser('owner');
    const orgId = await asUser(
      owner,
      async (s) =>
        (
          await s.q<{ id: string }>(`select public.create_organization('Solo', $1) as id`, [
            `solo-${Date.now()}`,
          ])
        )[0]!.id,
      { commit: true },
    );
    const branches = await admin<{ name: string }>(
      'select name from public.branches where org_id = $1',
      [orgId],
    );
    expect(branches.map((b) => b.name)).toEqual(['Main']);
  });

  it('rejects a duplicate slug, a malformed slug, and a blank name', async () => {
    const org = await createOrg();
    const other = await createUser('owner');
    const dup = await asUser(other, (s) =>
      s.attempt(`select public.create_organization('Dup', $1)`, [org.slug]),
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('23505');
    const bad = await asUser(other, (s) =>
      s.attempt(`select public.create_organization('Bad', 'Not A Slug!')`),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('23514');
    const blank = await asUser(other, (s) =>
      s.attempt(`select public.create_organization('   ', $1)`, [`blank-${Date.now()}`]),
    );
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.code).toBe('22023');
  });

  it('is not callable when signed out', async () => {
    const res = await asAnon((s) =>
      s.attempt(`select public.create_organization('X', 'x-slug-1')`),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('42501');
  });

  it('writes an audit entry', async () => {
    const org = await createOrg();
    const rows = await asUser(org.owner, (s) =>
      s.q<{ action: string }>(`select action from public.audit_log where org_id = $1`, [org.id]),
    );
    expect(rows.map((r) => r.action)).toContain('org.create');
  });
});

describe('inviting a manager limited to one branch', () => {
  it('the manager sees only their branch, not the other', async () => {
    const org = await createOrg({ branches: ['Dhanmondi', 'Mirpur'] });
    const [dhanmondi, mirpur] = org.branchIds as [string, string];
    const manager = await addMember(org, 'manager', [mirpur]);

    const visible = await asUser(manager, (s) =>
      s.q<{ id: string }>('select id from public.branches'),
    );
    expect(visible.map((b) => b.id)).toEqual([mirpur]);
    expect(visible.map((b) => b.id)).not.toContain(dhanmondi);

    const [m] = await admin<{ role: string; branch_scope: string }>(
      'select role, branch_scope from public.memberships where org_id = $1 and user_id = $2',
      [org.id, manager.id],
    );
    expect(m).toMatchObject({ role: 'manager', branch_scope: 'list' });
  });

  it('the manager cannot invite, cannot read invitations, and cannot see other members', async () => {
    const org = await createOrg();
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const invite = await asUser(manager, (s) =>
      s.attempt(`select public.create_invitation($1, 'x@example.com', 'cashier', $2::uuid[])`, [
        org.id,
        `{${org.branchIds[0]}}`,
      ]),
    );
    expect(invite.ok).toBe(false);
    if (!invite.ok) expect(invite.code).toBe('42501');

    const invitations = await asUser(manager, (s) => s.q('select * from public.invitations'));
    expect(invitations).toEqual([]);
    const members = await asUser(manager, (s) =>
      s.q<{ user_id: string }>('select user_id from public.memberships'),
    );
    expect(members.map((m) => m.user_id)).toEqual([manager.id]);
  });

  it('an accountant sees every branch', async () => {
    const org = await createOrg();
    const accountant = await addMember(org, 'accountant');
    const visible = await asUser(accountant, (s) => s.q('select id from public.branches'));
    expect(visible).toHaveLength(org.branchIds.length);
  });
});

describe('invitation rules', () => {
  const invite = (
    owner: Parameters<typeof asUser>[0],
    orgId: string,
    email: string,
    role: string,
    branches: string[],
  ) =>
    // Committed: later steps (accept, revoke, expire) rely on the invitation existing.
    asUser(
      owner,
      (s) =>
        s.attempt<{ r: { token: string } }>(
          'select public.create_invitation($1, $2, $3::public.app_role, $4::uuid[]) as r',
          [orgId, email, role, `{${branches.join(',')}}`],
        ),
      { commit: true },
    );

  it('cannot be accepted by a different email', async () => {
    const org = await createOrg();
    const res = await invite(org.owner, org.id, 'invited@example.com', 'manager', [
      org.branchIds[0]!,
    ]);
    if (!res.ok) throw new Error(res.message);
    const stranger = await createUser('stranger');
    const accept = await asUser(stranger, (s) =>
      s.attempt('select public.accept_invitation($1)', [res.rows[0]!.r.token]),
    );
    expect(accept.ok).toBe(false);
    if (!accept.ok) expect(accept.code).toBe('42501');
  });

  it('is single-use, and expires', async () => {
    const org = await createOrg();
    const user = await createUser('invitee');
    const res = await invite(org.owner, org.id, user.email, 'cashier', [org.branchIds[0]!]);
    if (!res.ok) throw new Error(res.message);
    const token = res.rows[0]!.r.token;
    await asUser(user, (s) => s.q('select public.accept_invitation($1)', [token]), {
      commit: true,
    });
    const again = await asUser(user, (s) =>
      s.attempt('select public.accept_invitation($1)', [token]),
    );
    expect(again.ok).toBe(false);

    const late = await createUser('late');
    const res2 = await invite(org.owner, org.id, late.email, 'kitchen', [org.branchIds[0]!]);
    if (!res2.ok) throw new Error(res2.message);
    await admin(
      `update public.invitations set expires_at = now() - interval '1 minute' where org_id = $1 and lower(email) = lower($2)`,
      [org.id, late.email],
    );
    const expired = await asUser(late, (s) =>
      s.attempt('select public.accept_invitation($1)', [res2.rows[0]!.r.token]),
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.code).toBe('P0002');
  });

  it('re-inviting an email revokes the earlier pending invitation', async () => {
    const org = await createOrg();
    const user = await createUser('twice');
    const first = await invite(org.owner, org.id, user.email, 'cashier', [org.branchIds[0]!]);
    const second = await invite(org.owner, org.id, user.email, 'cashier', [org.branchIds[1]!]);
    if (!first.ok || !second.ok) throw new Error('invite failed');
    const stale = await asUser(user, (s) =>
      s.attempt('select public.accept_invitation($1)', [first.rows[0]!.r.token]),
    );
    expect(stale.ok).toBe(false);
  });

  it('validates role and branches', async () => {
    const org = await createOrg();
    const other = await createOrg();
    const owner = await invite(org.owner, org.id, 'o@example.com', 'owner', []);
    expect(owner.ok).toBe(false);
    if (!owner.ok) expect(owner.code).toBe('22023');
    const noBranch = await invite(org.owner, org.id, 'm@example.com', 'manager', []);
    expect(noBranch.ok).toBe(false);
    if (!noBranch.ok) expect(noBranch.code).toBe('22023');
    const foreignBranch = await invite(org.owner, org.id, 'f@example.com', 'manager', [
      other.branchIds[0]!,
    ]);
    expect(foreignBranch.ok).toBe(false);
    if (!foreignBranch.ok) expect(foreignBranch.code).toBe('22023');
    const badEmail = await invite(org.owner, org.id, 'not-an-email', 'manager', [
      org.branchIds[0]!,
    ]);
    expect(badEmail.ok).toBe(false);
  });

  it("another organization's owner cannot invite into this organization", async () => {
    const org = await createOrg();
    const intruder = await createOrg();
    const res = await invite(intruder.owner, org.id, 'x@example.com', 'accountant', []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('42501');
  });

  it('can be revoked by the owner', async () => {
    const org = await createOrg();
    const user = await createUser('revoked');
    const res = await invite(org.owner, org.id, user.email, 'cashier', [org.branchIds[0]!]);
    if (!res.ok) throw new Error(res.message);
    const [inv] = await admin<{ id: string }>(
      'select id from public.invitations where org_id = $1',
      [org.id],
    );
    await asUser(org.owner, (s) => s.q('select public.revoke_invitation($1)', [inv!.id]), {
      commit: true,
    });
    const accept = await asUser(user, (s) =>
      s.attempt('select public.accept_invitation($1)', [res.rows[0]!.r.token]),
    );
    expect(accept.ok).toBe(false);
  });
});

describe('membership changes are owner-only and audited', () => {
  it('update_membership changes role and branches, and records before/after', async () => {
    const org = await createOrg();
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const id = await membershipId(org.id, manager.id);
    await asUser(
      org.owner,
      (s) =>
        s.q('select public.update_membership($1, $2, $3::uuid[])', [
          id,
          'cashier',
          `{${org.branchIds[1]}}`,
        ]),
      {
        commit: true,
      },
    );

    const [m] = await admin<{ role: string }>('select role from public.memberships where id = $1', [
      id,
    ]);
    expect(m!.role).toBe('cashier');
    const visible = await asUser(manager, (s) =>
      s.q<{ id: string }>('select id from public.branches'),
    );
    expect(visible.map((b) => b.id)).toEqual([org.branchIds[1]]);

    const [audit] = await admin<{ before: { role: string }; after: { role: string } }>(
      `select before, after from public.audit_log where org_id = $1 and action = 'member.update' and entity_id = $2`,
      [org.id, id],
    );
    expect(audit!.before.role).toBe('manager');
    expect(audit!.after.role).toBe('cashier');
  });

  it('a non-owner cannot change or remove memberships', async () => {
    const org = await createOrg();
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const cashier = await addMember(org, 'cashier', [org.branchIds[0]!]);
    const id = await membershipId(org.id, cashier.id);
    const update = await asUser(manager, (s) =>
      s.attempt(`select public.update_membership($1, 'manager', null)`, [id]),
    );
    expect(update.ok).toBe(false);
    const remove = await asUser(manager, (s) =>
      s.attempt('select public.remove_membership($1)', [id]),
    );
    expect(remove.ok).toBe(false);
  });

  it('remove_membership revokes access at once and is audited', async () => {
    const org = await createOrg();
    const cashier = await addMember(org, 'cashier', [org.branchIds[0]!]);
    const id = await membershipId(org.id, cashier.id);
    await asUser(org.owner, (s) => s.q('select public.remove_membership($1)', [id]), {
      commit: true,
    });
    const visible = await asUser(cashier, (s) => s.q('select id from public.branches'));
    expect(visible).toEqual([]);
    const audit = await admin(
      `select 1 from public.audit_log where org_id = $1 and action = 'member.remove'`,
      [org.id],
    );
    expect(audit).toHaveLength(1);
  });

  it('owner memberships cannot be changed or removed in this version', async () => {
    const org = await createOrg();
    const id = await membershipId(org.id, org.owner.id);
    const remove = await asUser(org.owner, (s) =>
      s.attempt('select public.remove_membership($1)', [id]),
    );
    expect(remove.ok).toBe(false);
    if (!remove.ok) expect(remove.code).toBe('22023');
    const demote = await asUser(org.owner, (s) =>
      s.attempt(`select public.update_membership($1, 'manager', $2::uuid[])`, [
        id,
        `{${org.branchIds[0]}}`,
      ]),
    );
    expect(demote.ok).toBe(false);
  });

  it('the schema forbids an owner or accountant scoped to a branch list', async () => {
    const org = await createOrg();
    const user = await createUser('scoped');
    await expect(
      admin(
        `insert into public.memberships (user_id, org_id, role, branch_scope) values ($1, $2, 'owner', 'list')`,
        [user.id, org.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('profiles', () => {
  it('every new auth user gets a profile; only co-members can read each other', async () => {
    const org = await createOrg();
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const stranger = await createUser('stranger');
    const [own] = await admin('select 1 from public.profiles where user_id = $1', [manager.id]);
    expect(own).toBeDefined();

    const coMember = await asUser(org.owner, (s) =>
      s.q('select user_id from public.profiles where user_id = $1', [manager.id]),
    );
    expect(coMember).toHaveLength(1);
    const outsider = await asUser(stranger, (s) =>
      s.q('select user_id from public.profiles where user_id = $1', [manager.id]),
    );
    expect(outsider).toHaveLength(0);
  });
});
