/**
 * Where the restaurant is (restaurants outside Bangladesh, step 1): every restaurant has a country, a time zone
 * and a currency on org_settings, Bangladesh / Asia/Dhaka / BDT by default. Only the owner changes them (RLS),
 * every change is audited, nonsense values are refused, and the currency is fixed once there are orders (every
 * stored amount is in it). The video settings no longer carry a country of their own.
 */
import { randomUUID } from 'node:crypto';
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

const commit = { commit: true };

describe('restaurant place', () => {
  let org: TestOrg;
  let other: TestOrg;
  let manager: TestUser;

  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    other = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
  });

  const place = async (orgId: string) =>
    (
      await admin<{ country: string; timezone: string; currency: string }>(
        `select country, timezone, currency from public.org_settings where org_id = $1`,
        [orgId],
      )
    )[0];
  const set = (who: TestUser, orgId: string, values: Record<string, string>) =>
    asUser(
      who,
      (s) =>
        s.attempt(
          `update public.org_settings set ${Object.keys(values)
            .map((k, i) => `${k} = $${i + 2}`)
            .join(', ')} where org_id = $1 returning org_id`,
          [orgId, ...Object.values(values)],
        ),
      commit,
    );

  it('starts every restaurant in Bangladesh, on Dhaka time, in taka', async () => {
    expect(await place(org.id)).toEqual({
      country: 'BD',
      timezone: 'Asia/Dhaka',
      currency: 'BDT',
    });
  });

  it('lets only the owner move the restaurant; audited', async () => {
    const r = await set(org.owner, org.id, {
      country: 'AE',
      timezone: 'Asia/Dubai',
      currency: 'AED',
    });
    expect(r.ok && r.rowCount).toBe(1);
    expect(await place(org.id)).toEqual({
      country: 'AE',
      timezone: 'Asia/Dubai',
      currency: 'AED',
    });
    // A manager's or another restaurant's owner's update touches no row (RLS: write is the owner's).
    for (const who of [manager, other.owner]) {
      const denied = await set(who, org.id, { country: 'US' });
      expect(denied.ok ? denied.rowCount : 0).toBe(0);
    }
    expect((await place(org.id))!.country).toBe('AE');
    const [audit] = await admin<{ after: Record<string, unknown> }>(
      `select after from public.audit_log where org_id = $1 and action = 'org_settings.update'
        order by created_at desc limit 1`,
      [org.id],
    );
    expect(audit!.after).toMatchObject({ country: 'AE', timezone: 'Asia/Dubai', currency: 'AED' });
  });

  it('refuses values that are not a country, a time zone or a currency code', async () => {
    for (const bad of <Record<string, string>[]>[
      { country: 'usa' },
      { country: 'U' },
      { currency: 'dollar' },
      { currency: 'US' },
      { timezone: 'x' },
      { timezone: 'Asia/Dubai; drop table' },
    ]) {
      const r = await set(org.owner, org.id, bad);
      expect(r.ok ? 'ok' : r.code, JSON.stringify(bad)).toBe('23514');
    }
  });

  it('fixes the currency after the first order, but the country and clock can still move', async () => {
    const [ch] = await admin<{ id: string }>(
      `insert into public.channels (org_id, name, kind) values ($1, 'Dine in', 'dine_in') returning id`,
      [org.id],
    );
    await admin(
      `insert into public.orders (id, org_id, branch_id, channel_id, order_status, payment_status, placed_at,
         gross_poisha, net_before_discount_poisha, discount_net_poisha, net_poisha, total_poisha,
         price_includes_vat, vat_rate_bps)
       values ($1, $2, $3, $4, 'completed', 'paid', now(), 1000, 1000, 0, 1000, 1000, true, 0)`,
      [randomUUID(), org.id, org.branchIds[0], ch!.id],
    );
    const r = await set(org.owner, org.id, { currency: 'USD' });
    expect(r.ok ? 'ok' : r.code).toBe('23514');
    const moved = await set(org.owner, org.id, { country: 'GB', timezone: 'Europe/London' });
    expect(moved.ok).toBe(true);
    expect(await place(org.id)).toEqual({
      country: 'GB',
      timezone: 'Europe/London',
      currency: 'AED',
    });
  });

  it('keeps the place on the restaurant, not on its video settings', async () => {
    const cols = await admin<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'social_settings'
          and column_name in ('country', 'timezone')`,
    );
    expect(cols).toEqual([]);
  });
});
