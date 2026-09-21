/** CLAUDE.md non-negotiable #5: sensitive actions land in an append-only audit_log (who, what, before/after). */
import { afterAll, describe, expect, it } from 'vitest';
import { addMember, admin, asUser, closePool, createOrg } from './harness';

afterAll(closePool);

describe('audit log', () => {
  it('records settings changes with before and after values, attributed to the actor', async () => {
    const org = await createOrg();
    await asUser(
      org.owner,
      (s) => s.q('update public.org_settings set vat_rate_bps = 500 where org_id = $1', [org.id]),
      { commit: true },
    );
    const [row] = await admin<{
      before: { vat_rate_bps: number };
      after: { vat_rate_bps: number };
      actor_user_id: string;
    }>(
      `select before, after, actor_user_id from public.audit_log where org_id = $1 and action = 'org_settings.update'`,
      [org.id],
    );
    expect(row!.before.vat_rate_bps).toBe(0);
    expect(row!.after.vat_rate_bps).toBe(500);
    expect(row!.actor_user_id).toBe(org.owner.id);
  });

  it('does not log no-op updates', async () => {
    const org = await createOrg();
    await asUser(
      org.owner,
      (s) =>
        s.q('update public.org_settings set vat_rate_bps = vat_rate_bps where org_id = $1', [
          org.id,
        ]),
      { commit: true },
    );
    const rows = await admin(
      `select 1 from public.audit_log where org_id = $1 and action = 'org_settings.update'`,
      [org.id],
    );
    expect(rows).toHaveLength(0);
  });

  it('audits recipe edits (ROADMAP: price/recipe edits)', async () => {
    const org = await createOrg();
    const [item] = await admin<{ id: string }>(
      `insert into public.menu_items (org_id, name) values ($1, 'Kacchi') returning id`,
      [org.id],
    );
    const [recipe] = await admin<{ id: string }>(
      `insert into public.recipes (org_id, menu_item_id) values ($1, $2) returning id`,
      [org.id, item!.id],
    );
    await admin(`update public.recipes set notes = 'less salt' where id = $1`, [recipe!.id]);
    const actions = (
      await admin<{ action: string }>(
        `select action from public.audit_log where org_id = $1 and entity = 'recipe' order by created_at`,
        [org.id],
      )
    ).map((r) => r.action);
    expect(actions).toEqual(['recipe.insert', 'recipe.update']);
  });

  it('cannot be forged or edited by a client', async () => {
    const org = await createOrg();
    const forged = await asUser(org.owner, (s) =>
      s.attempt(
        `insert into public.audit_log (org_id, action, entity) values ($1, 'fake', 'fake')`,
        [org.id],
      ),
    );
    expect(forged.ok).toBe(false);
    const edited = await asUser(org.owner, (s) =>
      s.attempt(`update public.audit_log set action = 'x' where org_id = $1`, [org.id]),
    );
    if (edited.ok) expect(edited.rowCount).toBe(0);
    const deleted = await asUser(org.owner, (s) =>
      s.attempt(`delete from public.audit_log where org_id = $1`, [org.id]),
    );
    if (deleted.ok) expect(deleted.rowCount).toBe(0);
  });

  it('log_audit stamps the caller as actor and refuses non-members', async () => {
    const org = await createOrg();
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    await asUser(
      manager,
      (s) =>
        s.q(
          `select public.log_audit($1, $2, 'price.edit', 'menu_item', 'abc', '{"p":1}'::jsonb, '{"p":2}'::jsonb, 'festival')`,
          [org.id, org.branchIds[0]],
        ),
      { commit: true },
    );
    const [row] = await admin<{ actor_user_id: string; reason: string }>(
      `select actor_user_id, reason from public.audit_log where org_id = $1 and action = 'price.edit'`,
      [org.id],
    );
    expect(row).toEqual({ actor_user_id: manager.id, reason: 'festival' });

    const outsider = await createOrg();
    const res = await asUser(outsider.owner, (s) =>
      s.attempt(`select public.log_audit($1, null, 'x', 'x', 'x')`, [org.id]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('42501');
  });

  it('is readable by owner and accountant only', async () => {
    const org = await createOrg();
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const accountant = await addMember(org, 'accountant');
    const outsider = await createOrg();
    const n = (u: typeof manager) =>
      asUser(
        u,
        async (s) =>
          (
            await s.q<{ n: number }>(
              'select count(*)::int as n from public.audit_log where org_id = $1',
              [org.id],
            )
          )[0]!.n,
      );
    expect(await n(org.owner)).toBeGreaterThan(0);
    expect(await n(accountant)).toBeGreaterThan(0);
    expect(await n(manager)).toBe(0);
    expect(await n(outsider.owner)).toBe(0);
  });
});
