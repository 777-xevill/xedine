/**
 * The seed's recipe costs (scripts/seed/costing.ts) and the database's (private.recipe_unit_cost) must
 * agree exactly, or the Phase 3 manifest facts could not be recovered. Loads the demo org's static data
 * with the real loader inside a transaction and rolls it back, so CI's seed step starts clean.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { BEEF_SPIKE_FROM, COSTING, unitCostOn } from '../../scripts/seed/costing';
import { FIRST_DATE, ORGS } from '../../scripts/seed/config';
import { ids } from '../../scripts/seed/generate';
import { loadStatic } from '../../scripts/seed/load';
import { closePool, getPool } from './harness';

afterAll(closePool);

describe('seed recipe costs match the database’s costing', () => {
  it('every demo recipe, before and during the beef spike', async () => {
    const client = await getPool().connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('xedine.bulk_load', 'on', true)`);
      let checked = 0;
      for (const org of ORGS) {
        await loadStatic(client, org);
        for (const m of org.menu) {
          if (!COSTING[org.key]!.recipes[m.key]) continue;
          for (const date of [FIRST_DATE, BEEF_SPIKE_FROM]) {
            const { rows } = await client.query<{ c: string }>(
              `select private.recipe_unit_cost($1, r.id, $2::date) as c
                 from public.recipes r where r.org_id = $1 and r.menu_item_id = $3 and r.status = 'active'`,
              [ids.org(org), date, ids.item(org, m)],
            );
            expect(Number(rows[0]!.c), `${org.key}/${m.key} on ${date}`).toBe(
              unitCostOn(org.key, m.key, date),
            );
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(50);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
