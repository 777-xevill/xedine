/**
 * TikTok for the social autopilot (ADR 0041). An org can hold a TikTok account next to its Facebook Page,
 * with TikTok's non-numeric account id; the token row keeps a refresh token that no client can read;
 * the owner picks how TikTok posts, a manager cannot.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { addMember, admin, asService, asUser, closePool, createOrg } from './harness';

afterAll(closePool);

describe('social TikTok', () => {
  it('stores a TikTok account beside Facebook, and keeps digits-only ids for Meta', async () => {
    const org = await createOrg();
    const insert = `insert into public.social_accounts (org_id, platform, external_id, name)
                    values ($1, $2, $3, 'Test') returning id`;
    await asService(async (s) => {
      expect((await s.attempt(insert, [org.id, 'facebook', '1234567'])).ok).toBe(true);
      expect((await s.attempt(insert, [org.id, 'tiktok', '-000AbC_d3f-9.x'])).ok).toBe(true);
      const badMeta = await s.attempt(insert, [org.id, 'instagram', 'not-a-number']);
      expect(badMeta.ok).toBe(false);
      if (!badMeta.ok) expect(badMeta.code).toBe('23514');
      const badTikTok = await s.attempt(insert, [org.id, 'tiktok', "x' or 1=1"]);
      expect(badTikTok.ok).toBe(false);
      const unknown = await s.attempt(insert, [org.id, 'snapchat', '1']);
      expect(unknown.ok).toBe(false);
    });
  });

  it('keeps TikTok tokens, refresh token included, away from every signed-in user', async () => {
    const org = await createOrg();
    const [account] = await admin<{ id: string }>(
      `insert into public.social_accounts (org_id, platform, external_id, name)
       values ($1, 'tiktok', 'open-id-1', 'Test') returning id`,
      [org.id],
    );
    await admin(
      `insert into public.social_tokens (account_id, org_id, access_token, refresh_token, expires_at)
       values ($1, $2, 'access', 'refresh', now() + interval '1 day')`,
      [account!.id, org.id],
    );
    const read = await asUser(org.owner, (s) =>
      s.attempt(`select refresh_token from public.social_tokens where org_id = $1`, [org.id]),
    );
    // Service-only: either no access at all or no rows, never the token.
    if (read.ok) expect(read.rows).toEqual([]);
    else expect(read.code).toBe('42501');
  });

  it('lets the owner choose draft or direct, never anything else, and not a manager', async () => {
    const org = await createOrg();
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    await admin(`insert into public.social_settings (org_id) values ($1)`, [org.id]);
    const [row] = await admin<{ tiktok_mode: string }>(
      `select tiktok_mode from public.social_settings where org_id = $1`,
      [org.id],
    );
    expect(row!.tiktok_mode).toBe('draft');
    const set = (mode: string) =>
      `update public.social_settings set tiktok_mode = '${mode}' where org_id = '${org.id}'`;
    const owner = await asUser(org.owner, (s) => s.attempt(set('direct')));
    expect(owner.ok && owner.rowCount).toBe(1);
    const bad = await asUser(org.owner, (s) => s.attempt(set('shout')));
    expect(bad.ok).toBe(false);
    const byManager = await asUser(manager, (s) => s.attempt(set('direct')));
    expect(byManager.ok && byManager.rowCount).not.toBe(1);
  });
});
