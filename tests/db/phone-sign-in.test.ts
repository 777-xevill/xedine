/**
 * Phone sign-in (ADR 0050): a code the Telegram bot issued works once, for 10 minutes, with 5 tries; a new
 * code retires the old one; at most 5 codes per phone an hour; the phone links to one account and lands on
 * the profile; and only the service role can reach any of it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { admin, asService, asUser, closePool, createUser } from './harness';

afterAll(closePool);

const commit = { commit: true };
const H = (c: string) => c.repeat(64);
const T0 = '2026-11-15T08:00:00Z';
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

let n = 0;
/** A fresh phone per test, so rate limits from one test never touch another. */
const phone = () => `+88017${String(10_000_000 + n++).slice(-8)}`;

const issue = (p: string, hash: string, now: string) =>
  asService(
    (s) =>
      s.q<{ v: string }>('select public.phone_sign_in_issue($1, $2, $3, $4) as v', [
        p,
        hash,
        'Rahim',
        now,
      ]),
    commit,
  ).then((r) => r[0]!.v);

const check = (p: string, hash: string, now: string) =>
  asService(
    (s) =>
      s.q<{ v: { status: string; user_id: string | null; full_name: string | null } }>(
        'select public.phone_sign_in_check($1, $2, $3) as v',
        [p, hash, now],
      ),
    commit,
  ).then((r) => r[0]!.v);

describe('phone sign-in codes', () => {
  it('a right code works once and carries the name', async () => {
    const p = phone();
    expect(await issue(p, H('a'), T0)).toBe('sent');
    const ok = await check(p, H('a'), at(1));
    expect(ok.status).toBe('ok');
    expect(ok.full_name).toBe('Rahim');
    expect(ok.user_id).toBeNull();
    expect((await check(p, H('a'), at(2))).status).toBe('no_code');
  });

  it('stops working after 10 minutes', async () => {
    const p = phone();
    await issue(p, H('a'), T0);
    expect((await check(p, H('a'), at(11))).status).toBe('no_code');
  });

  it('locks after 5 wrong tries, even for the right code', async () => {
    const p = phone();
    await issue(p, H('a'), T0);
    for (let i = 0; i < 4; i++) expect((await check(p, H('b'), at(1))).status).toBe('wrong');
    expect((await check(p, H('b'), at(1))).status).toBe('locked');
    expect((await check(p, H('a'), at(1))).status).toBe('locked');
  });

  it('a new code retires the old one', async () => {
    const p = phone();
    await issue(p, H('a'), T0);
    await issue(p, H('b'), at(1));
    expect((await check(p, H('a'), at(2))).status).toBe('wrong');
    expect((await check(p, H('b'), at(2))).status).toBe('ok');
  });

  it('gives at most 5 codes per phone an hour', async () => {
    const p = phone();
    for (let i = 0; i < 5; i++) expect(await issue(p, H('a'), at(i))).toBe('sent');
    expect(await issue(p, H('a'), at(5))).toBe('too_many');
    expect(await issue(p, H('a'), at(61))).toBe('sent');
  });

  it('refuses a phone that is not a Bangladeshi mobile', async () => {
    expect(await issue('+447700900123', H('a'), T0)).toBe('invalid');
  });

  it('links the phone to one account and puts it on the profile', async () => {
    const p = phone();
    const user = await createUser('phone');
    await asService((s) => s.q('select public.phone_account_link($1, $2)', [p, user.id]), commit);
    await issue(p, H('a'), T0);
    expect((await check(p, H('a'), at(1))).user_id).toBe(user.id);
    const [profile] = await admin<{ phone: string }>(
      'select phone from public.profiles where user_id = $1',
      [user.id],
    );
    expect(profile!.phone).toBe(p);
  });

  it('is out of reach of signed-in users', async () => {
    const user = await createUser('nosy');
    await asUser(user, async (s) => {
      for (const sql of [
        `select public.phone_sign_in_issue('+8801711111111', '${H('a')}', 'x', now())`,
        `select public.phone_sign_in_check('+8801711111111', '${H('a')}', now())`,
        `select public.phone_account_link('+8801711111111', '${user.id}')`,
        'select * from private.phone_sign_in_codes',
        'select * from private.phone_accounts',
      ]) {
        expect((await s.attempt(sql)).ok, sql).toBe(false);
      }
    });
  });
});
