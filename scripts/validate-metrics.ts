/**
 * `pnpm metrics:validate` — ROADMAP Phase 2 "Done when", against the seeded year (CI only: the full seed
 * does not fit in the embedded Postgres). Unlike validate-manifest.ts, which recomputes the manifest with
 * independent SQL, this runs the product's own metric and detector functions and holds them to it:
 *   - metrics equal the manifest exactly, every velocity window included;
 *   - S1, S2 and S3's commission drag are detected with ৳ within ±10%;
 *   - S13 (the clean café) stays quiet: at most one anomaly finding per branch-week;
 *   - the Health Monitor's queries answer with p95 < 2 s for the three-branch org.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { MANIFEST_PATH } from './seed/build';
import { ORGS, type OrgCfg } from './seed/config';
import { ids } from './seed/generate';
import { QTY_ITEM } from './seed/ledger';
import { ManifestSchema, type Manifest } from './seed/manifest';

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const manifest: Manifest = ManifestSchema.parse(
  JSON.parse(readFileSync(process.env.MANIFEST_FILE ?? MANIFEST_PATH, 'utf8')),
);
const pool = new pg.Pool({ connectionString: url, max: 2 });
const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await pool.query(sql, params)).rows as T[];
const n = (v: unknown) => Number(v ?? 0);

const failures: string[] = [];
const notes: string[] = [];
const expectEq = (path: string, expected: number, actual: number) => {
  if (expected !== actual) failures.push(`${path}: manifest ${expected} ≠ metric ${actual}`);
};
const expectWithin = (path: string, expected: number, actual: number, pct: number) => {
  const diff = Math.abs(actual - expected);
  if (expected === 0 ? actual !== 0 : diff * 100 > Math.abs(expected) * pct) {
    failures.push(`${path}: ${actual} is not within ±${pct}% of ${expected}`);
  } else
    notes.push(
      `${path}: ${actual} vs ${expected} (${((diff * 100) / Math.abs(expected || 1)).toFixed(2)}%)`,
    );
};

const orgId = (o: OrgCfg) => ids.org(o);
const branchIds = (o: OrgCfg) => o.branches.map((b) => ids.branch(o, b));
const staffId = (o: OrgCfg, branch: string, staff: string) => {
  const b = o.branches.find((x) => x.key === branch)!;
  return ids.staff(
    o,
    b,
    b.staff.find((s) => s.key === staff)!,
  );
};

type Finding = { type: string; branch_id: string; subject_key: string; impact_poisha: string };
const detect = (o: OrgCfg, from: string, to: string, kinds: string[]) =>
  q<Finding>(
    `select type, branch_id, subject_key, impact_poisha from private.detect_all($1, $2::date, $3::date, $4::text[])`,
    [orgId(o), from, to, kinds],
  );

async function metricsMatchManifest(o: OrgCfg) {
  const expected = manifest.orgs[o.key]!;
  const sales = await q(
    `select * from private.m_sales($1, $2::uuid[], $3::date, $4::date) where branch_id is not null`,
    [orgId(o), branchIds(o), manifest.first_date, manifest.anchor_date],
  );
  for (const b of o.branches) {
    const e = expected.branches[b.key]!;
    const row = sales.find((r) => r.branch_id === ids.branch(o, b))!;
    const path = `${o.key}.${b.key}`;
    expectEq(`${path}.orders_completed`, e.orders_completed, n(row.orders_completed));
    expectEq(`${path}.orders_cancelled`, e.orders_cancelled, n(row.orders_cancelled));
    expectEq(`${path}.sales.gross`, e.gross_poisha, n(row.gross_poisha));
    expectEq(`${path}.sales.discounts`, e.discount_net_poisha, n(row.discounts_poisha));
    expectEq(`${path}.sales.net`, e.net_poisha, n(row.net_poisha));
    expectEq(`${path}.sales.vat`, e.vat_poisha, n(row.vat_poisha));
    expectEq(`${path}.sales.service_charge`, e.service_charge_poisha, n(row.service_charge_poisha));
    expectEq(`${path}.total`, e.total_poisha, n(row.total_poisha));

    const channels = await q(
      `select * from private.m_sales_split($1, $2::uuid[], $3::date, $4::date, 'channel')`,
      [orgId(o), [ids.branch(o, b)], manifest.first_date, manifest.anchor_date],
    );
    for (const [kind, c] of Object.entries(e.by_channel)) {
      const row_ = channels.find((r) => r.key === kind);
      expectEq(`${path}.by_channel.${kind}.orders`, c.orders, n(row_?.orders));
      expectEq(`${path}.by_channel.${kind}.net`, c.net_poisha, n(row_?.net_poisha));
    }

    const item = ids.item(
      o,
      o.menu.find((m) => m.key === QTY_ITEM[o.key])!,
    );
    const windows: [keyof typeof e.item_qty, string][] = [
      ['last_2h', 'last_2h'],
      ['today', 'today'],
      ['yesterday', 'yesterday'],
      ['last_7d', 'last_7d'],
      ['month_to_date', 'month_to_date'],
    ];
    for (const [key, window] of windows) {
      const [r] = await q(
        `select coalesce(sum(i.qty), 0) as qty
           from private.window_bounds($1, $3, $4::timestamptz) w
           cross join lateral private.m_item_qty($1, $2::uuid[], w.from_date, w.to_date, w.from_ts, w.to_ts, $5) i`,
        [orgId(o), [ids.branch(o, b)], window, manifest.frozen_now, item],
      );
      expectEq(`${path}.items.qty_sold(${window})`, e.item_qty[key], n(r!.qty));
    }
  }
}

async function scenarios() {
  const kacchi = ORGS.find((o) => o.key === 'demo_kacchi_house')!;
  const cafe = ORGS.find((o) => o.key === 'demo_cafe')!;
  const s = (id: string) =>
    manifest.scenarios.find((x) => x.id === id)!.facts as Record<string, unknown>;
  const pct = manifest.tolerances.finding_impact_pct;

  const year = await detect(kacchi, manifest.first_date, manifest.anchor_date, [
    'staff',
    'commission',
  ]);

  // S1 — Mirpur's cashier voiding after KOT.
  const s1 = year.find(
    (f) => f.type === 'void.after_kot' && f.subject_key === staffId(kacchi, 'mirpur', 'rafiq'),
  );
  if (!s1) failures.push('S1: no void.after_kot finding for the Mirpur cashier');
  else expectWithin('S1.impact', n(s('S1').excess_void_value_poisha), n(s1.impact_poisha), pct);

  // S2 — Uttara's manager discounting on Thursdays.
  const s2 = year.find(
    (f) => f.type === 'discount.rate' && f.subject_key === staffId(kacchi, 'uttara', 'habib'),
  );
  if (!s2) failures.push('S2: no discount.rate finding for the Uttara manager');
  else expectWithin('S2.impact', n(s('S2').excess_discount_poisha), n(s2.impact_poisha), pct);

  // S3 — foodpanda's commission drag in every branch.
  const s3 = s('S3').branches as Record<string, Record<string, number>>;
  for (const b of kacchi.branches) {
    const f = year.find(
      (x) =>
        x.type === 'commission.drag' &&
        x.branch_id === ids.branch(kacchi, b) &&
        x.subject_key === ids.channel(kacchi, 'foodpanda'),
    );
    if (!f) failures.push(`S3.${b.key}: no commission.drag finding for foodpanda`);
    else
      expectWithin(
        `S3.${b.key}.impact`,
        s3[b.key]!.foodpanda_commission_poisha!,
        n(f.impact_poisha),
        pct,
      );
  }
  const others = year.filter((f) => f !== s1 && f !== s2 && f.type !== 'commission.drag');
  notes.push(`Kacchi House, full year: ${year.length} findings (${others.length} beyond S1/S2/S3)`);

  // S13 — the clean café. Anomaly detectors (not the structural commission cost) over the year and week by week.
  const anomalyKinds = ['staff', 'cash_share', 'over_short'];
  const cafeYear = await detect(cafe, manifest.first_date, manifest.anchor_date, anomalyKinds);
  if (cafeYear.length > 0)
    failures.push(
      `S13: ${cafeYear.length} anomaly finding(s) on the clean café over the year: ${cafeYear.map((f) => f.type).join(', ')}`,
    );
  let worstWeek = 0;
  let weeksWithFindings = 0;
  const first = new Date(`${manifest.first_date}T00:00:00Z`);
  for (let start = first; ; start = new Date(start.getTime() + 7 * 86_400_000)) {
    const from = start.toISOString().slice(0, 10);
    const to = new Date(start.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
    if (to > manifest.anchor_date) break;
    const week = await detect(cafe, from, to, anomalyKinds);
    const perBranch = new Map<string, number>();
    for (const f of week) perBranch.set(f.branch_id, (perBranch.get(f.branch_id) ?? 0) + 1);
    const worst = Math.max(0, ...perBranch.values());
    worstWeek = Math.max(worstWeek, worst);
    if (worst > 0) weeksWithFindings++;
  }
  const limit = manifest.tolerances.max_false_positives_per_branch_week_on_clean_org;
  if (worstWeek > limit)
    failures.push(`S13: a café branch-week had ${worstWeek} anomaly findings (limit ${limit})`);
  notes.push(
    `S13: worst branch-week ${worstWeek} finding(s); weeks with any finding: ${weeksWithFindings}`,
  );
}

async function dashboardLatency() {
  const kacchi = ORGS.find((o) => o.key === 'demo_kacchi_house')!;
  const org = orgId(kacchi);
  const branches = branchIds(kacchi);
  const now = manifest.frozen_now;
  const today = manifest.anchor_date;
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await Promise.all([
      q(`select * from private.m_sales($1, $2::uuid[], $3::date, $3::date)`, [
        org,
        branches,
        today,
      ]),
      q(`select * from private.m_pace($1, $2::uuid[], $3::timestamptz)`, [org, branches, now]),
      q(`select * from private.m_flash_pnl($1, $2::uuid[], $3::date)`, [org, branches, today]),
      q(`select * from private.m_sales_split($1, $2::uuid[], $3::date, $3::date, 'channel')`, [
        org,
        branches,
        today,
      ]),
    ]);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(0.95 * times.length) - 1]!;
  notes.push(`Health Monitor p95: ${p95.toFixed(0)} ms over ${times.length} loads`);
  if (p95 >= 2000) failures.push(`Dashboard p95 ${p95.toFixed(0)} ms is not under 2 s`);
}

try {
  for (const o of ORGS) await metricsMatchManifest(o);
  await scenarios();
  await dashboardLatency();
  for (const note of notes) console.log(`  · ${note}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} Phase 2 check(s) failed:`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      '✓ Metrics match the manifest; S1, S2, S3 detected within tolerance; S13 quiet; p95 < 2 s.',
    );
  }
} finally {
  await pool.end();
}
