/**
 * X7 and the assistant that acts (ADR 0067): X7's questions per week by plan, and the changes the assistant
 * prepares (`ai_actions`), which move only through `decide_ai_action` and only for the person who asked.
 * A new restaurant is on the Growth trial (= Pro on the home page): 20 X7 questions a week.
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

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const DAY = 86_400_000;
// A moment inside the 14-day trial; +7 days is the next business week, still inside it.
const T0 = new Date(Date.now() + DAY).toISOString();
const T7 = new Date(Date.now() + 8 * DAY).toISOString();

describe('X7 per week', () => {
  let org: TestOrg;
  let manager: TestUser;
  let cashier: TestUser;
  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    cashier = await addMember(org, 'cashier', [org.branchIds[0]!]);
  });

  const allowance = (user: TestUser, at: string) =>
    asUser(user, (s) =>
      s.q<Row>(
        'select per_week, used, left_count, resets_on::text as resets_on from public.x7_allowance($1, $2)',
        [org.id, at],
      ),
    );
  const use = (user: TestUser, at: string) =>
    asUser(user, (s) => s.q<{ ok: boolean }>('select public.use_x7($1, $2) as ok', [org.id, at]), {
      commit: true,
    });

  it('the trial (Growth = Pro) gives 20 a week, counted per question, refused past the limit', async () => {
    const [a] = await allowance(org.owner, T0);
    expect([n(a!.per_week), n(a!.used), n(a!.left_count)]).toEqual([20, 0, 20]);
    // resets_on is the Monday after T0's business week.
    expect(new Date(`${String(a!.resets_on)}T00:00:00Z`).getUTCDay()).toBe(1);
    for (let i = 0; i < 19; i++) expect((await use(org.owner, T0))[0]!.ok).toBe(true);
    expect((await use(manager, T0))[0]!.ok).toBe(true); // the 20th, by a manager: one allowance per restaurant
    expect((await use(org.owner, T0))[0]!.ok).toBe(false);
    const [b] = await allowance(manager, T0);
    expect([n(b!.used), n(b!.left_count)]).toEqual([20, 0]);
  });

  it('starts again the next week', async () => {
    const [a] = await allowance(org.owner, T7);
    expect([n(a!.used), n(a!.left_count)]).toEqual([0, 20]);
    expect((await use(org.owner, T7))[0]!.ok).toBe(true);
  });

  it('roles that cannot chat can neither read nor spend it', async () => {
    const read = await asUser(cashier, (s) =>
      s.attempt('select * from public.x7_allowance($1, $2)', [org.id, T0]),
    );
    expect(read.ok ? 'ok' : read.code).toBe('42501');
    const spend = await asUser(cashier, (s) =>
      s.attempt('select public.use_x7($1, $2)', [org.id, T0]),
    );
    expect(spend.ok ? 'ok' : spend.code).toBe('42501');
  });

  it('Starter (no AI in this database’s plans) has no X7', async () => {
    const other = await createOrg({ branches: ['Main'] });
    await admin(
      `insert into public.subscriptions (org_id, plan_id, status)
       select $1, id, 'active' from public.plans where code = 'starter'`,
      [other.id],
    );
    const [a] = await asUser(other.owner, (s) =>
      s.q<Row>('select * from public.x7_allowance($1, $2)', [other.id, T0]),
    );
    expect([n(a!.per_week), n(a!.left_count)]).toEqual([0, 0]);
    const [u] = await asUser(other.owner, (s) =>
      s.q<{ ok: boolean }>('select public.use_x7($1, $2) as ok', [other.id, T0]),
    );
    expect(u!.ok).toBe(false);
  });

  it('the plans hold the weekly numbers of the home page (Starter 3, Pro 20)', async () => {
    const plans = await admin<{ code: string; x7: string }>(
      `select code, limits ->> 'x7_per_week' as x7 from public.plans order by code`,
    );
    expect(Object.fromEntries(plans.map((p) => [p.code, Number(p.x7)]))).toEqual({
      chain: 20,
      growth: 20,
      starter: 3,
    });
  });
});

describe('changes the assistant prepared', () => {
  let org: TestOrg;
  let manager: TestUser;
  let conversation: string;
  let message: string;
  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    [conversation, message] = await asUser(
      org.owner,
      async (s) => {
        const [c] = await s.q<{ id: string }>(
          `insert into public.ai_conversations (org_id, user_id, title) values ($1, $2, 'Menu') returning id`,
          [org.id, org.owner.id],
        );
        const [m] = await s.q<{ id: string }>(
          `insert into public.ai_messages (org_id, user_id, conversation_id, role, content, numeric_check)
           values ($1, $2, $3, 'assistant', '{"text":"Ready."}', 'general') returning id`,
          [org.id, org.owner.id, c!.id],
        );
        return [c!.id, m!.id];
      },
      { commit: true },
    );
  });

  let seq = 0;
  const propose = (user: TestUser, extra: Partial<Record<'status' | 'user_id', string>> = {}) =>
    asUser(
      user,
      (s) =>
        s.attempt<{ id: string }>(
          `insert into public.ai_actions (org_id, user_id, conversation_id, message_id, seq, kind, params, view, status)
           values ($1, $2, $3, $4, $5, 'add_dish', '{"name":"Chicken Tehari","price_minor":22000}',
                   '{"name":"Chicken Tehari"}', $6::public.ai_action_status) returning id`,
          [
            org.id,
            extra.user_id ?? user.id,
            conversation,
            message,
            seq++,
            extra.status ?? 'proposed',
          ],
        ),
      { commit: true },
    );
  const decide = (user: TestUser, id: string, status: string, at = new Date().toISOString()) =>
    asUser(
      user,
      (s) =>
        s.attempt('select public.decide_ai_action($1, $2::public.ai_action_status, null, $3)', [
          id,
          status,
          at,
        ]),
      { commit: true },
    );
  const code = (r: { ok: boolean; code?: string; message?: string }) =>
    r.ok ? 'ok' : `${r.code} ${r.message}`;

  it('an answer may be "general knowledge"', async () => {
    const [m] = await admin<{ numeric_check: string }>(
      'select numeric_check from public.ai_messages where id = $1',
      [message],
    );
    expect(m!.numeric_check).toBe('general');
  });

  it('the asker saves them as proposed only, for themselves', async () => {
    const ok = await propose(org.owner);
    expect(ok.ok).toBe(true);
    expect((await propose(org.owner, { status: 'done' })).ok).toBe(false);
    expect((await propose(org.owner, { user_id: manager.id })).ok).toBe(false);
  });

  it('nobody else reads or moves them, not even a manager of the same restaurant', async () => {
    const r = await propose(org.owner);
    const id = (r as { rows: { id: string }[] }).rows[0]!.id;
    const seen = await asUser(manager, (s) =>
      s.q('select id from public.ai_actions where id = $1', [id]),
    );
    expect(seen).toHaveLength(0);
    expect(code(await decide(manager, id, 'running'))).toMatch(/^42501/);
  });

  it('proposed → running → done, audited with what was sent; nothing skips a step or goes back', async () => {
    const r = await propose(org.owner);
    const id = (r as { rows: { id: string }[] }).rows[0]!.id;
    expect(code(await decide(org.owner, id, 'done'))).toMatch(/ai_action_state/);
    expect(code(await decide(org.owner, id, 'running'))).toBe('ok');
    expect(code(await decide(org.owner, id, 'dismissed'))).toMatch(/ai_action_state/);
    expect(code(await decide(org.owner, id, 'done'))).toBe('ok');
    expect(code(await decide(org.owner, id, 'running'))).toMatch(/ai_action_state/);
    const [row] = await admin<Row>(
      'select status, decided_at from public.ai_actions where id = $1',
      [id],
    );
    expect(row!.status).toBe('done');
    expect(row!.decided_at).not.toBeNull();
    const audit = await admin<Row>(
      `select actor_user_id, after from public.audit_log where entity = 'ai_action' and entity_id = $1 and action = 'ai.action'`,
      [id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_user_id).toBe(org.owner.id);
    expect(
      (audit[0]!.after as { kind: string; params: { price_minor: number } }).params.price_minor,
    ).toBe(22000);
  });

  it('a failed one keeps its reason; "Not now" sets one aside', async () => {
    const a = (await propose(org.owner)) as { rows: { id: string }[] };
    await decide(org.owner, a.rows[0]!.id, 'running');
    await asUser(
      org.owner,
      (s) =>
        s.q(`select public.decide_ai_action($1, 'failed', 'notAllowed', $2)`, [
          a.rows[0]!.id,
          new Date().toISOString(),
        ]),
      { commit: true },
    );
    const b = (await propose(org.owner)) as { rows: { id: string }[] };
    expect(code(await decide(org.owner, b.rows[0]!.id, 'dismissed'))).toBe('ok');
    const rows = await admin<Row>(
      'select id, status, error from public.ai_actions where id = any($1)',
      [[a.rows[0]!.id, b.rows[0]!.id]],
    );
    const by = Object.fromEntries(rows.map((r) => [r.id as string, [r.status, r.error]]));
    expect(by[a.rows[0]!.id]).toEqual(['failed', 'notAllowed']);
    expect(by[b.rows[0]!.id]).toEqual(['dismissed', null]);
  });

  it('a proposal older than a day cannot be made any more', async () => {
    const r = (await propose(org.owner)) as { rows: { id: string }[] };
    await admin(
      `update public.ai_actions set created_at = now() - interval '25 hours' where id = $1`,
      [r.rows[0]!.id],
    );
    expect(code(await decide(org.owner, r.rows[0]!.id, 'running'))).toMatch(/ai_action_expired/);
    // Setting it aside is still allowed.
    expect(code(await decide(org.owner, r.rows[0]!.id, 'dismissed'))).toBe('ok');
  });
});
