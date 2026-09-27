/**
 * Slow, opt-in (XEDINE_SLOW=1): S12 on the real seed — Uttara's regulars lapse after its July price rise.
 * Loads Kacchi House's orders from the lapse detector's 90-day look-back to the anchor (no order lines;
 * the detector reads orders only) inside a transaction and rolls it back.
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

describe.skipIf(!process.env.XEDINE_SLOW)('lapsed regulars on the seeded year', () => {
  it(
    'only Uttara is flagged, with the price change as evidence, within tolerance',
    { timeout: 1_800_000 },
    async () => {
      const client = await getPool().connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('xedine.bulk_load', 'on', true)`);
        for (const org of ORGS) await loadStatic(client, org);
        const buffer = new DayBuffer();
        const manifest: Manifest = await runSeed(async (orgKey, _b, date, rows) => {
          if (orgKey !== 'demo_kacchi_house' || date < '2026-04-29') return;
          buffer.push({ ...emptyDayRows(), shifts: rows.shifts, orders: rows.orders });
          if (buffer.size >= 3000) await buffer.flush(client);
        });
        await buffer.flush(client);
        const kacchi = ORGS.find((o) => o.key === 'demo_kacchi_house')!;
        const f = manifest.scenarios.find((s) => s.id === 'S12')!.facts as Record<string, unknown>;
        const { rows } = await client.query(
          `select branch_id, impact_poisha, evidence from private.detect_all($1, $2::date, $3::date, array['customers'])`,
          [ids.org(kacchi), f.period_from, f.period_to],
        );
        const uttara = ids.branch(
          kacchi,
          kacchi.branches.find((b) => b.key === 'uttara')!,
        );
        expect(rows.map((r) => r.branch_id)).toEqual([uttara]);
        const expected = n(f.impact_poisha);
        process.stderr.write(
          `S12 impact ${n(rows[0].impact_poisha)} vs planted ${expected}; evidence ${JSON.stringify(rows[0].evidence)}\n`,
        );
        expect(Math.abs(n(rows[0].impact_poisha) - expected)).toBeLessThanOrEqual(expected * 0.1);
        expect(rows[0].evidence.price_changes.length).toBeGreaterThan(0);
      } finally {
        await client.query('rollback');
        client.release();
      }
    },
  );
});
