/**
 * ADR 0006 (business_date, in SQL and TS from one shared fixture) and ADR 0005 (the VAT price basis
 * is frozen once an organization has orders).
 */
import { afterAll, describe, expect, it } from 'vitest';
import cases from '../fixtures/business-date-cases.json';
import { admin, asUser, closePool, createOrg } from './harness';

afterAll(closePool);

describe('private.business_date matches the TypeScript implementation', () => {
  for (const c of cases.cases) {
    it(c.name, async () => {
      const [row] = await admin<{ d: string }>(
        'select private.business_date($1::timestamptz, $2)::text as d',
        [c.instant, c.cutoff],
      );
      expect(row!.d).toBe(c.expected);
    });
  }
});

describe('orders.business_date is set at insert and never rewritten', () => {
  const insertOrder = async (orgId: string, branchId: string, placedAt: string) => {
    const [row] = await admin<{ id: string; d: string }>(
      `insert into public.orders (org_id, branch_id, placed_at, business_date)
       values ($1, $2, $3::timestamptz, '2000-01-01') returning id, business_date::text as d`,
      [orgId, branchId, placedAt],
    );
    return row!;
  };

  it('01:30 Dhaka on the 22nd belongs to business day the 21st under the default 04:00 cutoff', async () => {
    const org = await createOrg();
    const o = await insertOrder(org.id, org.branchIds[0]!, '2026-09-21T19:30:00Z');
    expect(o.d).toBe('2026-09-21');
  });

  it('04:00 Dhaka opens the next business day', async () => {
    const org = await createOrg();
    const o = await insertOrder(org.id, org.branchIds[0]!, '2026-09-21T22:00:00Z');
    expect(o.d).toBe('2026-09-22');
  });

  it("a branch cutoff overrides the organization's; an org cutoff applies when the branch has none", async () => {
    const org = await createOrg();
    const [branch] = org.branchIds as [string, string];
    await admin('update public.branches set cutoff_minutes = 0 where id = $1', [branch]);
    expect((await insertOrder(org.id, branch, '2026-09-21T19:30:00Z')).d).toBe('2026-09-22');

    await admin('update public.org_settings set default_cutoff_minutes = 360 where org_id = $1', [
      org.id,
    ]);
    const other = org.branchIds[1]!;
    expect((await insertOrder(org.id, other, '2026-09-21T23:59:00Z')).d).toBe('2026-09-21'); // 05:59 < 06:00
    expect((await insertOrder(org.id, other, '2026-09-22T00:00:00Z')).d).toBe('2026-09-22'); // 06:00
  });

  it('a later cutoff change never rewrites history; placed_at is immutable', async () => {
    const org = await createOrg();
    const o = await insertOrder(org.id, org.branchIds[0]!, '2026-09-21T19:30:00Z');
    await admin('update public.org_settings set default_cutoff_minutes = 0 where org_id = $1', [
      org.id,
    ]);
    await admin(
      `update public.orders set business_date = '1999-01-01', notes = 'x' where id = $1`,
      [o.id],
    );
    const [after] = await admin<{ d: string }>(
      'select business_date::text as d from public.orders where id = $1',
      [o.id],
    );
    expect(after!.d).toBe('2026-09-21');
    await expect(
      admin(`update public.orders set placed_at = now() where id = $1`, [o.id]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('rejects an out-of-range cutoff at the schema level', async () => {
    const org = await createOrg();
    await expect(
      admin('update public.org_settings set default_cutoff_minutes = 1440 where org_id = $1', [
        org.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      admin('update public.branches set cutoff_minutes = -1 where id = $1', [org.branchIds[0]]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('ADR 0005: price_includes_vat is frozen once orders exist', () => {
  it('can be changed freely before the first order, and not after', async () => {
    const org = await createOrg();
    const flip = (value: boolean) =>
      asUser(
        org.owner,
        (s) =>
          s.attempt('update public.org_settings set price_includes_vat = $2 where org_id = $1', [
            org.id,
            value,
          ]),
        { commit: true },
      );

    const before = await flip(false);
    expect(before.ok && before.rowCount).toBe(1);
    await admin(
      `insert into public.orders (org_id, branch_id, business_date) values ($1, $2, '2000-01-01')`,
      [org.id, org.branchIds[0]],
    );

    const after = await flip(true);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.code).toBe('23514');
    const [row] = await admin<{ price_includes_vat: boolean }>(
      'select price_includes_vat from public.org_settings where org_id = $1',
      [org.id],
    );
    expect(row!.price_includes_vat).toBe(false);
  });

  it('other settings stay editable after orders exist', async () => {
    const org = await createOrg();
    await admin(
      `insert into public.orders (org_id, branch_id, business_date) values ($1, $2, '2000-01-01')`,
      [org.id, org.branchIds[0]],
    );
    const res = await asUser(org.owner, (s) =>
      s.attempt('update public.org_settings set vat_rate_bps = 750 where org_id = $1', [org.id]),
    );
    expect(res.ok && res.rowCount).toBe(1);
  });

  it('orders keep their own tax snapshot, so a later rate change cannot rewrite them', async () => {
    const org = await createOrg();
    const [order] = await admin<{ id: string }>(
      `insert into public.orders (org_id, branch_id, business_date, vat_rate_bps, price_includes_vat, net_poisha, vat_poisha, total_poisha)
       values ($1, $2, '2000-01-01', 500, true, 28571, 1429, 30000) returning id`,
      [org.id, org.branchIds[0]],
    );
    await admin('update public.org_settings set vat_rate_bps = 1500 where org_id = $1', [org.id]);
    const [row] = await admin<{ vat_rate_bps: number; vat_poisha: string }>(
      'select vat_rate_bps, vat_poisha from public.orders where id = $1',
      [order!.id],
    );
    expect(row).toEqual({ vat_rate_bps: 500, vat_poisha: '1429' });
  });
});
