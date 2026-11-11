/**
 * Offer notifications (ADR 0048): a member who ticked offers can save their phone; one who did not cannot;
 * a phone belongs to one customer; at most 5 phones each; nobody but the service role touches the keys or
 * the subscriptions; and the server's key pair is stored once.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asService, asUser, closePool, createOrg, type TestOrg } from './harness';

afterAll(closePool);

const commit = { commit: true };
const NOW = '2026-11-13T08:00:00Z';
const P256DH = 'B' + 'A'.repeat(86);
const AUTH = 'A'.repeat(22);

describe('web push', () => {
  let org: TestOrg;
  let token: string;
  let tableToken: string;

  const join = (phone: string, offers: boolean) =>
    asService(
      (s) =>
        s.q<{ v: { status: string; token?: string } }>(
          'select public.join_member_at_table($1, $2, null, $3, $4) as v',
          [tableToken, phone, offers, NOW],
        ),
      commit,
    ).then((r) => r[0]!.v);

  const save = (card: string, endpoint: string) =>
    asService(
      (s) =>
        s.q<{ v: { status: string } }>(
          'select public.save_push_subscription($1, $2, $3, $4) as v',
          [card, endpoint, P256DH, AUTH],
        ),
      commit,
    ).then((r) => r[0]!.v.status);

  beforeAll(async () => {
    org = await createOrg({ branches: ['Dhanmondi'] });
    const [tb] = await admin<{ qr_token: string }>(
      `insert into public.dining_tables (org_id, branch_id, name) values ($1, $2, '1') returning qr_token`,
      [org.id, org.branchIds[0]],
    );
    tableToken = tb!.qr_token;
    await admin(
      `insert into public.loyalty_settings (org_id, is_on, earn_points, earn_every_poisha, point_value_poisha, min_redeem_points)
       values ($1, true, 1, 10000, 100, 50)`,
      [org.id],
    );
    token = (await join('01755555555', true)).token!;
  });

  it('saves the phone of a member who ticked offers, and refuses one who did not', async () => {
    expect(await save(token, 'https://fcm.googleapis.com/fcm/send/one')).toBe('saved');
    const quiet = (await join('01766666666', false)).token!;
    expect(await save(quiet, 'https://fcm.googleapis.com/fcm/send/two')).toBe('no_consent');
    const rows = await admin<{ n: number }>(
      'select count(*)::int as n from public.push_subscriptions where org_id = $1',
      [org.id],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('refuses an unknown card and a bad subscription', async () => {
    expect(await save('x'.repeat(24), 'https://fcm.googleapis.com/fcm/send/three')).toBe('gone');
    expect(await save('not a token', 'https://fcm.googleapis.com/fcm/send/three')).toBe('gone');
    expect(await save(token, 'http://insecure.example/x')).toBe('invalid');
  });

  it('the same phone is saved once, and a customer keeps at most 5 phones', async () => {
    expect(await save(token, 'https://fcm.googleapis.com/fcm/send/one')).toBe('saved');
    for (let i = 0; i < 7; i++) {
      await save(token, `https://fcm.googleapis.com/fcm/send/many-${i}`);
    }
    const [n] = await admin<{ n: number }>(
      'select count(*)::int as n from public.push_subscriptions where org_id = $1',
      [org.id],
    );
    expect(n!.n).toBe(5);
  });

  it('nobody but the service role can call the functions or read the table', async () => {
    for (const sql of [
      'select public.web_push_keys_get()',
      `select public.web_push_keys_put('p', 'k')`,
      `select public.save_push_subscription('${token}', 'https://x.example/a', '${P256DH}', '${AUTH}')`,
      'select * from public.push_subscriptions',
    ]) {
      const r = await asUser(org.owner, (s) => s.attempt(sql));
      expect(r.ok, sql).toBe(false);
    }
  });

  it('stores the server key pair once and keeps the first', async () => {
    const put = (p: string) =>
      asService(
        (s) =>
          s.q<{ v: { public_key: string; private_jwk: string } }>(
            'select public.web_push_keys_put($1, $2) as v',
            [p, `jwk-${p}`],
          ),
        commit,
      ).then((r) => r[0]!.v);
    const first = await put('first');
    const second = await put('second');
    expect(second).toEqual(first);
    const got = await asService((s) =>
      s.q<{ v: { public_key: string } | null }>('select public.web_push_keys_get() as v'),
    );
    expect(got[0]!.v?.public_key).toBe(first.public_key);
  });
});
