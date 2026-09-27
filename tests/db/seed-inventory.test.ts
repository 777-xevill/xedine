/**
 * The seed's stock ledger (scripts/seed/inventory.ts) and the database's stock maths (private.m_stock,
 * m_variance, m_discipline) must agree exactly, or the Phase 5–6 manifest facts could not be recovered.
 * Loads the last four weeks of the real seed with the real loader inside a transaction and rolls it back
 * (the whole year does not fit the embedded Postgres; CI's golden script checks the full seed too).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { addDays } from '../../src/lib/time/business-date';
import { runSeed } from '../../scripts/seed/build';
import { ORGS } from '../../scripts/seed/config';
import { emptyDayRows, ids } from '../../scripts/seed/generate';
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
          // Price Watch compares against the 28 days before the period: load those purchases too.
          if (date < addDays(PERIOD_FROM, -28)) return;
          if (date < PERIOD_FROM) {
            buffer.push({
              ...emptyDayRows(),
              purchases: rows.purchases,
              purchase_lines: rows.purchase_lines,
            });
            return;
          }
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

        // Phase 6: the leak detectors recover S6–S9 within the manifest's tolerance, and nothing else;
        // the clean café stays quiet.
        const kacchi = ORGS.find((o) => o.key === 'demo_kacchi_house')!;
        const cafe = ORGS.find((o) => o.key === 'demo_cafe')!;
        const period = [manifest.inventory.period.from, manifest.inventory.period.to];
        const detect = async (orgKey: typeof kacchi) =>
          (
            await client.query(
              `select type, branch_id, subject, impact_poisha from private.detect_all($1, $2::date, $3::date, array['stock', 'price', 'transfer'])`,
              [ids.org(orgKey), ...period],
            )
          ).rows as {
            type: string;
            branch_id: string;
            subject: Record<string, string>;
            impact_poisha: string;
          }[];
        const found = await detect(kacchi);
        const facts = (sid: string) =>
          manifest.scenarios.find((s) => s.id === sid)!.facts as Record<string, number | string>;
        const branchId = (key: string) =>
          ids.branch(
            kacchi,
            kacchi.branches.find((b) => b.key === key)!,
          );
        const pct = manifest.tolerances.finding_impact_pct;
        const within = (label: string, expected: number, actual: number) =>
          expect(
            Math.abs(actual - expected) * 100,
            `${label}: ${actual} vs ${expected}`,
          ).toBeLessThanOrEqual(expected * pct);
        const pick = (type: string, branch: string, ing: string) =>
          found.find(
            (f) =>
              f.type === type &&
              f.branch_id === branchId(branch) &&
              f.subject.ingredient_id === invIds.ingredient(kacchi, ing),
          );
        const s6 = pick('transfer.suspected', 'dhanmondi', 'chicken');
        expect(s6?.subject.to_branch_id, 'S6 detected').toBe(branchId('mirpur'));
        within('S6', Number(facts('S6').moved_value_poisha), n(s6!.impact_poisha));
        const s7 = pick('usage.unexplained', 'mirpur', 'mutton');
        within('S7', Number(facts('S7').extra_value_poisha), n(s7?.impact_poisha));
        const s8 = pick('price.drift', 'dhanmondi', 'beef');
        within('S8', Number(facts('S8').overpaid_poisha), n(s8?.impact_poisha));
        const s9 = pick('usage.unexplained', 'uttara', 'rice');
        within('S9', Number(facts('S9').wasted_value_poisha), n(s9?.impact_poisha));
        console.info(
          `Phase 6 recovered (detector vs planted, poisha): S6 ${n(s6?.impact_poisha)}/${facts('S6').moved_value_poisha}, ` +
            `S7 ${n(s7?.impact_poisha)}/${facts('S7').extra_value_poisha}, S8 ${n(s8?.impact_poisha)}/${facts('S8').overpaid_poisha}, ` +
            `S9 ${n(s9?.impact_poisha)}/${facts('S9').wasted_value_poisha}`,
        );
        // Besides the four plants, only the transfer Uttara never confirmed.
        const others = found.filter((f) => ![s6, s7, s8, s9].includes(f));
        expect(others.map((f) => f.type)).toEqual(['transfer.unconfirmed']);
        expect(await detect(cafe)).toEqual([]);

        // Phase 8 (S11): Friday nights at Dhanmondi are a slow slot; nothing else is, and the café is quiet.
        const s11 = manifest.scenarios.find((x) => x.id === 'S11')!.facts as Record<
          string,
          number | string
        >;
        const service = async (o: typeof kacchi) =>
          (
            await client.query(
              `select branch_id, subject, impact_poisha, evidence from private.detect_all($1, $2::date, $3::date, array['service'])`,
              [ids.org(o), s11.period_from, s11.period_to],
            )
          ).rows as {
            branch_id: string;
            subject: Record<string, number>;
            impact_poisha: string;
            evidence: Record<string, number>;
          }[];
        const slow = await service(kacchi);
        expect(slow.map((x) => [x.branch_id, x.subject.weekday, x.subject.from_hour])).toEqual([
          [branchId('dhanmondi'), 5, 20],
        ]);
        within('S11', Number(s11.net_poisha), n(slow[0]!.impact_poisha));
        expect(slow[0]!.evidence).toMatchObject({
          orders: s11.orders,
          median_seconds: s11.median_seconds,
        });
        expect(await service(cafe)).toEqual([]);
      } finally {
        await client.query('rollback');
        client.release();
      }
    },
  );
});
