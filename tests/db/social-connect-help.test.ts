/**
 * ADR 0059: an owner asks Xedine to help connect Facebook (Page access or a Tester invite). Only the owner
 * asks or cancels; only a platform admin sees the inbox and moves a request on; clients cannot write the
 * table directly; a link must be a facebook.com link; every step is audited.
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

describe('social connect help requests', () => {
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

  const row = async () =>
    (
      await admin<Row>(
        'select way, facebook_link, status from public.social_connect_requests where org_id = $1',
        [org.id],
      )
    )[0] ?? null;

  it('only the owner can ask; a tester ask needs a Facebook link', async () => {
    const asManager = await asUser(manager, (s) =>
      s.attempt('select public.request_social_connect($1, $2, $3)', [org.id, 'page_access', null]),
    );
    expect(code(asManager)).toBe('42501');
    const stranger = await asUser(other.owner, (s) =>
      s.attempt('select public.request_social_connect($1, $2, $3)', [org.id, 'page_access', null]),
    );
    expect(code(stranger)).toBe('42501');
    const noLink = await asUser(org.owner, (s) =>
      s.attempt('select public.request_social_connect($1, $2, $3)', [org.id, 'tester', '  ']),
    );
    expect(code(noLink)).toBe('22023');
    const badLink = await asUser(org.owner, (s) =>
      s.attempt('select public.request_social_connect($1, $2, $3)', [
        org.id,
        'tester',
        'javascript:alert(1)',
      ]),
    );
    expect(code(badLink)).toBe('23514');
    const direct = await asUser(org.owner, (s) =>
      s.attempt(
        `insert into public.social_connect_requests (org_id, way) values ($1, 'page_access')`,
        [org.id],
      ),
    );
    expect(code(direct)).toBe('42501');
    expect(await row()).toBeNull();
  });

  it('the owner asks, the admin marks invited, then done; audited; owner reads own only', async () => {
    await asUser(
      org.owner,
      (s) =>
        s.q('select public.request_social_connect($1, $2, $3)', [
          org.id,
          'tester',
          'https://www.facebook.com/kacchi.owner',
        ]),
      commit,
    );
    expect(await row()).toEqual({
      way: 'tester',
      facebook_link: 'https://www.facebook.com/kacchi.owner',
      status: 'waiting',
    });
    const ownerSees = await asUser(org.owner, (s) =>
      s.q<Row>('select status from public.social_connect_requests'),
    );
    expect(ownerSees).toHaveLength(1);
    const otherSees = await asUser(other.owner, (s) =>
      s.q<Row>('select status from public.social_connect_requests where org_id = $1', [org.id]),
    );
    expect(otherSees).toHaveLength(0);

    // The inbox and the marks are the admin's only.
    const ownerInbox = await asUser(org.owner, (s) =>
      s.attempt('select * from public.admin_social_connect_requests(now())'),
    );
    expect(code(ownerInbox)).toBe('42501');
    const ownerMark = await asUser(org.owner, (s) =>
      s.attempt('select public.admin_mark_social_connect($1, $2)', [org.id, 'done']),
    );
    expect(code(ownerMark)).toBe('42501');

    const inbox = await asUser(operator, (s) =>
      s.q<Row>('select org_id, way, status from public.admin_social_connect_requests(now())'),
    );
    expect(inbox).toContainEqual({ org_id: org.id, way: 'tester', status: 'waiting' });
    await asUser(
      operator,
      (s) => s.q('select public.admin_mark_social_connect($1, $2)', [org.id, 'invited']),
      commit,
    );
    expect((await row())?.status).toBe('invited');

    // Asking again (a different way) starts over as waiting.
    await asUser(
      org.owner,
      (s) => s.q('select public.request_social_connect($1, $2, $3)', [org.id, 'page_access', null]),
      commit,
    );
    expect(await row()).toEqual({ way: 'page_access', facebook_link: null, status: 'waiting' });

    const audit = await admin<Row>(
      `select action from public.audit_log where org_id = $1 and entity = 'social_connect_request' order by created_at`,
      [org.id],
    );
    expect(audit.map((a) => a.action)).toEqual([
      'social.connect_request',
      'social.connect_mark',
      'social.connect_request',
    ]);
  });

  it('the owner can cancel; a manager cannot', async () => {
    const asManager = await asUser(manager, (s) =>
      s.attempt('select public.cancel_social_connect($1)', [org.id]),
    );
    expect(code(asManager)).toBe('42501');
    await asUser(
      org.owner,
      (s) => s.q('select public.cancel_social_connect($1)', [org.id]),
      commit,
    );
    expect(await row()).toBeNull();
  });
});
