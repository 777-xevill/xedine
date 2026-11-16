/**
 * Restaurants in any country, steps 2–3 (ADR 0062): the business day, the hour of a sale and dayparts follow
 * the restaurant's own time zone; a customer's mobile number follows its country; the member card page
 * carries its currency and clock. A Bangladeshi restaurant sees exactly what it did before.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closePool, createOrg, type TestOrg } from './harness';

afterAll(closePool);

async function placeAt(org: TestOrg, country: string, timezone: string, currency: string) {
  await admin(
    `update public.org_settings set country = $2, timezone = $3, currency = $4 where org_id = $1`,
    [org.id, country, timezone, currency],
  );
}

async function orderAt(org: TestOrg, placedAt: string): Promise<string> {
  const [ch] = await admin<{ id: string }>(
    `insert into public.channels (org_id, name, kind) values ($1, $2, 'dine_in') returning id`,
    [org.id, `Dine in ${randomUUID().slice(0, 6)}`],
  );
  const [row] = await admin<{ business_date: string }>(
    `insert into public.orders (id, org_id, branch_id, channel_id, order_status, payment_status, placed_at,
       gross_poisha, net_before_discount_poisha, discount_net_poisha, net_poisha, total_poisha,
       price_includes_vat, vat_rate_bps)
     values ($1, $2, $3, $4, 'completed', 'paid', $5, 1000, 1000, 0, 1000, 1000, true, 0)
     returning business_date::text`,
    [randomUUID(), org.id, org.branchIds[0], ch!.id, placedAt],
  );
  return row!.business_date;
}

describe('restaurant clock and phones', () => {
  let dhaka: TestOrg;
  let dubai: TestOrg;
  let london: TestOrg;

  beforeAll(async () => {
    dhaka = await createOrg({ branches: ['Main'] });
    dubai = await createOrg({ branches: ['Main'] });
    london = await createOrg({ branches: ['Main'] });
    await placeAt(dubai, 'AE', 'Asia/Dubai', 'AED');
    await placeAt(london, 'GB', 'Europe/London', 'GBP');
  });

  it('counts a sale in the business day of the restaurant’s own clock (cutoff 04:00 local)', async () => {
    // 23:30 UTC on the 16th: 05:30 on the 17th in Dhaka, 03:30 on the 17th in Dubai (before its cutoff).
    expect(await orderAt(dhaka, '2026-11-16T23:30:00Z')).toBe('2026-11-17');
    expect(await orderAt(dubai, '2026-11-16T23:30:00Z')).toBe('2026-11-16');
    // 03:30 UTC on the 17th: 03:30 in London (still the 16th's business day), 09:30 in Dhaka.
    expect(await orderAt(london, '2026-11-17T03:30:00Z')).toBe('2026-11-16');
    expect(await orderAt(dhaka, '2026-11-17T03:30:00Z')).toBe('2026-11-17');
  });

  it('shifts the cutoff the metrics use by the distance from Dhaka (none for Dhaka)', async () => {
    const cut = async (org: TestOrg) =>
      (await admin<{ c: number }>(`select private.org_cutoff($1) as c`, [org.id]))[0]!.c;
    expect(await cut(dhaka)).toBe(240);
    expect(await cut(dubai)).toBe(360);
    const [{ today }] = (await admin<{ today: string }>(
      `select private.business_date('2026-11-16T23:30:00Z'::timestamptz, private.org_cutoff($1))::text as today`,
      [dubai.id],
    )) as [{ today: string }];
    expect(today).toBe('2026-11-16');
  });

  it('puts a sale in the daypart of the restaurant’s own hour', async () => {
    const parts = await admin<{ dhaka: string; london: string }>(
      `select private.daypart_of_tz('Asia/Dhaka', '2026-11-16T13:00:00Z', d) as dhaka,
              private.daypart_of_tz('Europe/London', '2026-11-16T13:00:00Z', d) as london
         from (select dayparts as d from public.org_settings where org_id = $1) s`,
      [london.id],
    );
    expect(parts[0]).toEqual({ dhaka: 'dinner', london: 'lunch' });
  });

  it('reads a customer’s mobile number the way people write it in the restaurant’s country', async () => {
    const norm = async (org: TestOrg, phone: string) =>
      (
        await admin<{ p: string | null }>(`select private.normalize_phone($2, $1) as p`, [
          org.id,
          phone,
        ])
      )[0]!.p;
    expect(await norm(dhaka, '01712-345678')).toBe('+8801712345678');
    expect(await norm(dhaka, '+44 7700 900123')).toBeNull();
    expect(await norm(london, '07700 900123')).toBe('+447700900123');
    expect(await norm(london, '+44 (0)7700-900123')).toBe('+447700900123');
    expect(await norm(london, '+44 7700 900123')).toBe('+447700900123');
    expect(await norm(london, '0044 7700 900123')).toBe('+447700900123');
    expect(await norm(dubai, '050 123 4567')).toBe('+971501234567');
    expect(await norm(dubai, '12')).toBeNull();
    expect(await norm(dubai, 'call me')).toBeNull();
  });
});
