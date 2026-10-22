/**
 * ADR 0036: a new branch needs a platform admin's approval. The owner asks; only the approval creates the
 * branch (with a default Kitchen station); clients cannot insert branches or rewrite requests themselves.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  admin,
  asUser,
  closePool,
  createOrg,
  createUser,
  type TestOrg,
  type TestUser,
} from './harness';

afterAll(closePool);

type Row = Record<string, unknown>;
const code = (r: { ok: true } | { ok: false; code: string }) => (r.ok ? 'ok' : r.code);
const commit = { commit: true };

describe('branch requests', () => {
  let org: TestOrg;
  let other: TestOrg;
  let manager: TestUser;
  let operator: TestUser;
  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    other = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    operator = await createUser('operator');
    await admin(`insert into public.platform_admins (user_id) values ($1)`, [operator.id]);
  });

  const branches = async () =>
    (
      await admin<Row>('select name from public.branches where org_id = $1 order by name', [org.id])
    ).map((r) => r.name);

  it('nobody can create a branch directly, not even the owner', async () => {
    const direct = await asUser(org.owner, (s) =>
      s.attempt(`insert into public.branches (org_id, name) values ($1, 'Sneaky')`, [org.id]),
    );
    expect(code(direct)).toBe('42501');
    expect(await branches()).toEqual(['Main']);
  });

  it('only the owner can ask, and a used or empty name is refused', async () => {
    const asManager = await asUser(manager, (s) =>
      s.attempt('select public.request_branch($1, $2, $3)', [org.id, 'Mirpur', null]),
    );
    expect(code(asManager)).toBe('42501');
    const stranger = await asUser(other.owner, (s) =>
      s.attempt('select public.request_branch($1, $2, $3)', [org.id, 'Mirpur', null]),
    );
    expect(code(stranger)).toBe('42501');
    const used = await asUser(org.owner, (s) =>
      s.attempt('select public.request_branch($1, $2, $3)', [org.id, ' main ', null]),
    );
    expect(code(used)).toBe('23505');
    const empty = await asUser(org.owner, (s) =>
      s.attempt('select public.request_branch($1, $2, $3)', [org.id, '  ', null]),
    );
    expect(code(empty)).toBe('22023');
  });

  it('a request waits; approving creates the branch and a Kitchen station; it is audited', async () => {
    const [made] = await asUser(
      org.owner,
      (s) =>
        s.q<{ id: string }>('select public.request_branch($1, $2, $3) as id', [
          org.id,
          'Mirpur',
          'Mirpur 10',
        ]),
      commit,
    );
    const requestId = made!.id;
    expect(await branches()).toEqual(['Main']);

    // A second tap for the same name does not queue it twice.
    const twice = await asUser(org.owner, (s) =>
      s.attempt('select public.request_branch($1, $2, $3)', [org.id, 'mirpur', null]),
    );
    expect(code(twice)).toBe('23505');

    // The owner sees their own request, and cannot decide it or edit it.
    const mine = await asUser(org.owner, (s) =>
      s.q<Row>('select name, status from public.branch_requests where org_id = $1', [org.id]),
    );
    expect(mine.map((r) => [r.name, r.status])).toEqual([['Mirpur', 'pending']]);
    const selfApprove = await asUser(org.owner, (s) =>
      s.attempt('select public.admin_decide_branch_request($1, true, null)', [requestId]),
    );
    expect(code(selfApprove)).toBe('42501');
    const edit = await asUser(org.owner, (s) =>
      s.attempt(`update public.branch_requests set status = 'approved' where id = $1`, [requestId]),
    );
    expect(code(edit)).toBe('42501');
    const peek = await asUser(other.owner, (s) =>
      s.q<Row>('select id from public.branch_requests where org_id = $1', [org.id]),
    );
    expect(peek).toEqual([]);
    const inbox = await asUser(org.owner, (s) =>
      s.attempt('select * from public.admin_branch_requests(now())'),
    );
    expect(code(inbox)).toBe('42501');

    const list = await asUser(operator, (s) =>
      s.q<Row>('select * from public.admin_branch_requests(now())'),
    );
    const row = list.find((r) => r.id === requestId)!;
    expect([row.org_name, row.status, row.name, Number(row.branches)]).toEqual([
      `Org ${org.slug}`,
      'pending',
      'Mirpur',
      1,
    ]);

    await asUser(
      operator,
      (s) => s.q('select public.admin_decide_branch_request($1, true, $2)', [requestId, 'welcome']),
      commit,
    );
    expect(await branches()).toEqual(['Main', 'Mirpur']);
    const stations = await admin<Row>(
      `select s.name from public.stations s join public.branches b on b.id = s.branch_id
        where s.org_id = $1 and b.name = 'Mirpur'`,
      [org.id],
    );
    expect(stations).toHaveLength(1);
    const again = await asUser(operator, (s) =>
      s.attempt('select public.admin_decide_branch_request($1, false, null)', [requestId]),
    );
    expect(code(again)).toBe('22023');
    const audited = await admin<Row>(
      `select action from public.audit_log where org_id = $1 and action like 'branch.%' order by created_at, action`,
      [org.id],
    );
    expect(audited.map((r) => r.action)).toEqual(['branch.request', 'branch.approve']);
  });

  it('a declined request creates nothing; the owner can cancel their own open request', async () => {
    const [a] = await asUser(
      org.owner,
      (s) =>
        s.q<{ id: string }>('select public.request_branch($1, $2, null) as id', [org.id, 'Uttara']),
      commit,
    );
    await asUser(
      operator,
      (s) => s.q('select public.admin_decide_branch_request($1, false, $2)', [a!.id, 'not yet']),
      commit,
    );
    expect(await branches()).toEqual(['Main', 'Mirpur']);
    const [r] = await asUser(org.owner, (s) =>
      s.q<Row>('select status, decision_note from public.branch_requests where id = $1', [a!.id]),
    );
    expect([r!.status, r!.decision_note]).toEqual(['declined', 'not yet']);

    const [b] = await asUser(
      org.owner,
      (s) =>
        s.q<{ id: string }>('select public.request_branch($1, $2, null) as id', [
          org.id,
          'Gulshan',
        ]),
      commit,
    );
    const byManager = await asUser(manager, (s) =>
      s.attempt('select public.cancel_branch_request($1)', [b!.id]),
    );
    expect(code(byManager)).toBe('42501');
    await asUser(org.owner, (s) => s.q('select public.cancel_branch_request($1)', [b!.id]), commit);
    const [c] = await asUser(org.owner, (s) =>
      s.q<Row>('select status from public.branch_requests where id = $1', [b!.id]),
    );
    expect(c!.status).toBe('cancelled');
  });
});
