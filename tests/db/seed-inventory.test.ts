/**
 * The seed's stock ledger (scripts/seed/inventory.ts) and the database's stock maths (private.m_stock,
 * m_variance, m_discipline) must agree exactly, or the Phase 5–6 manifest facts could not be recovered.
 * Loads the last four weeks of the real seed with the real loader inside a transaction and rolls it back
 * (the whole year does not fit the embedded Postgres; CI's golden script checks the full seed too).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { runSeed } from '../../scripts/seed/build';
import { ORGS } from '../../scripts/seed/config';
import { ids } from '../../scripts/seed/generate';
import { invIds, PERIOD_FROM } from '../../scripts/seed/inventory';
import { DayBuffer, loadStatic } from '../../scripts/seed/load';
import type { Manifest } from '../../scripts/seed/manifest';
import { closePool, getPool } from './harness';

afterAll(closePool);

const n = (v: unknown) => Number(v ?? 0);
const day = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

describe('seed stock ledger matches the database’s stock maths', () => {
  it(
    'stock and cover at the anchor, variance over the period, discipline by day',
    { timeout: 600_000 },
    async () => {
      const client = await getPool().connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('xedine.bulk_load', 'on', true)`);
        for (const org of ORGS) await loadStatic(client, org);
        const buffer = new DayBuffer();
        const manifest: Manifest = await runSeed(async (_org, _branch, date, rows) => {
          if (date < PERIOD_FROM) return;
          buffer.push(rows);
          if (buffer.size >= 3000) await buffer.flush(client);
        });
        await buffer.flush(client);
        let checked = 0;
        for (const org of ORGS) {
          const orgId = ids.org(org);
          const branches = org.branches.map((b) => ids.branch(org, b));
          await client.query('select private.backfill_item_costs($1, $2::date, $3::date)', [
            orgId,
            PERIOD_FROM,
            manifest.anchor_date,
          ]);
          const expected = manifest.inventory.orgs[org.key]!;
          const key = new Map(
            Object.keys(expected.branches[org.branches[0]!.key]!.stock).map((k) => [
              invIds.ingredient(org, k),
              k,
            ]),
          );
          const stock = (
            await client.query(`select * from private.m_stock($1, $2::uuid[], $3::date)`, [
              orgId,
              branches,
              manifest.anchor_date,
            ])
          ).rows;
          const variance = (
            await client.query(
              `select * from private.m_variance($1, $2::uuid[], $3::date, $4::date)`,
              [orgId, branches, manifest.inventory.period.from, manifest.inventory.period.to],
            )
          ).rows;
          const dates = Object.keys(expected.branches[org.branches[0]!.key]!.discipline);
          const discipline = (
            await client.query(
              `select * from private.m_discipline($1, $2::uuid[], $3::date, $4::date)`,
              [orgId, branches, dates[0], dates[dates.length - 1]],
            )
          ).rows;
          for (const b of org.branches) {
            const e = expected.branches[b.key]!;
            const bid = ids.branch(org, b);
            for (const [ing, es] of Object.entries(e.stock)) {
              const r = stock.find((x) => x.branch_id === bid && key.get(x.ingredient_id) === ing);
              const path = `${org.key}.${b.key}.${ing}`;
              expect(
                {
                  last: day(r?.last_count_date),
                  stock: n(r?.stock_qty),
                  use14: n(r?.usage_14d_qty),
                  transit: n(r?.in_transit_qty),
                  cover: r?.days_of_cover === null ? null : Math.round(n(r?.days_of_cover) * 100),
                  band: r?.band,
                },
                path,
              ).toEqual({
                last: es.last_count_date,
                stock: es.stock_qty,
                use14: es.usage_14d_qty,
                transit: es.in_transit_qty,
                cover: es.days_of_cover_x100,
                band: es.band,
              });
              checked++;
            }
            for (const [ing, ev] of Object.entries(e.variance)) {
              const r = variance.find(
                (x) => x.branch_id === bid && key.get(x.ingredient_id) === ing,
              )!;
              const actual = Object.fromEntries(Object.keys(ev).map((k) => [k, n(r[k])]));
              expect(actual, `${org.key}.${b.key}.variance.${ing}`).toEqual(ev);
              checked++;
            }
            for (const [date, score] of Object.entries(e.discipline)) {
              const r = discipline.find(
                (x) => x.branch_id === bid && day(x.business_date) === date,
              );
              expect(n(r?.score), `${org.key}.${b.key}.discipline.${date}`).toBe(score);
            }
          }
        }
        expect(checked).toBeGreaterThan(100);
      } finally {
        await client.query('rollback');
        client.release();
      }
    },
  );
});
