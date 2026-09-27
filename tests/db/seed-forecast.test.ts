/**
 * Slow, opt-in (XEDINE_SLOW=1): the Phase 7 forecast on the real seed around Ramadan and Eid-ul-Fitr.
 * Loads January–March of the seed inside a transaction and rolls it back. CI's golden script
 * (metrics:validate at SEED_PHASE=7) runs the same checks on the full year.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { runSeed } from '../../scripts/seed/build';
import { ORGS } from '../../scripts/seed/config';
import { emptyDayRows, ids } from '../../scripts/seed/generate';
import { DayBuffer, loadStatic } from '../../scripts/seed/load';
import type { Manifest } from '../../scripts/seed/manifest';
import { closePool, getPool } from './harness';

afterAll(closePool);
const n = (v: unknown) => Number(v ?? 0);

describe.skipIf(!process.env.XEDINE_SLOW)('forecast on the seeded Ramadan and Eid', () => {
  it(
    'closures forecast zero; the Ramadan forecast carries the iftar shift',
    { timeout: 1_800_000 },
    async () => {
      const client = await getPool().connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('xedine.bulk_load', 'on', true)`);
        for (const org of ORGS) await loadStatic(client, org);
        const buffer = new DayBuffer();
        const manifest: Manifest = await runSeed(async (orgKey, _b, date, rows) => {
          if (orgKey !== 'demo_kacchi_house' || date < '2026-01-20' || date > '2026-03-24') return;
          buffer.push({
            ...emptyDayRows(),
            shifts: rows.shifts,
            orders: rows.orders,
            order_items: rows.order_items,
          });
          if (buffer.size >= 3000) await buffer.flush(client);
        });
        await buffer.flush(client);
        const kacchi = ORGS.find((o) => o.key === 'demo_kacchi_house')!;
        const org = ids.org(kacchi);
        const branches = kacchi.branches.map((b) => ids.branch(kacchi, b));
        const s10 = manifest.scenarios.find((s) => s.id === 'S10')!.facts as Record<
          string,
          unknown
        >;

        for (const d of ['2026-03-20', '2026-03-21']) {
          const { rows } = await client.query(
            `select coalesce(sum(model_qty), 0) as m from private.m_forecast($1, $2::uuid[], $3::date, $3::date, $3::date)`,
            [org, branches, d],
          );
          expect(n(rows[0].m), d).toBe(0);
        }
        const w = s10.ramadan_window as { from: string; to: string };
        const { rows: share } = await client.query(
          `select round(10000 * sum(model_qty) filter (where daypart = 'snacks') / nullif(sum(model_qty), 0)) as s
           from private.m_forecast($1, $2::uuid[], $3::date, $4::date)`,
          [org, branches, w.from, w.to],
        );
        const planted = n(s10.snacks_share_ramadan_bps);
        const acc = async (from: string, to: string) =>
          (
            await client.query(
              `select * from private.m_forecast_accuracy($1, $2::uuid[], $3::date, $4::date) where branch_id is null`,
              [org, branches, from, to],
            )
          ).rows[0];
        const ramadan = await acc(w.from, w.to);
        const normal = await acc('2026-02-24', '2026-03-05');
        process.stderr.write(
          `Forecast snacks share in Ramadan ${n(share[0].s)} vs actual ${planted}; ` +
            `WAPE Ramadan ${n(ramadan.wape_bps)} vs naive ${n(ramadan.naive_wape_bps)}; ` +
            `early Ramadan ${n(normal.wape_bps)} vs naive ${n(normal.naive_wape_bps)}
`,
        );
        expect(Math.abs(n(share[0].s) - planted)).toBeLessThanOrEqual(planted * 0.15);
        expect(n(ramadan.wape_bps)).toBeLessThan(n(ramadan.naive_wape_bps));
      } finally {
        await client.query('rollback');
        client.release();
      }
    },
  );
});
