/**
 * `pnpm db:seed` — load the synthetic Dhaka dataset and (re)write the ground-truth manifest.
 * Refuses to touch a non-local database unless SEED_ALLOW_REMOTE=1: this is demo data, never production.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import { MANIFEST_PATH, runSeed, serializeManifest } from './seed/build';
import { ORGS } from './seed/config';
import { ids } from './seed/generate';
import { DayBuffer, loadBenchmarkReferences, loadStatic } from './seed/load';

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.SEED_ALLOW_REMOTE !== '1') {
  console.error(
    `Refusing to seed ${host}: demo data is for local/CI databases only. Set SEED_ALLOW_REMOTE=1 to override.`,
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
const started = Date.now();

try {
  const [existing] = (
    await client.query(`select 1 from public.organizations where slug = any($1)`, [
      ORGS.map((o) => o.slug),
    ])
  ).rows;
  if (existing) {
    console.error(
      'Demo organizations already exist. Run `pnpm db:reset:seed` for a clean database.',
    );
    process.exit(1);
  }

  await client.query('begin');
  // Order lines are costed in one statement per org after the load, not one trigger call per line.
  await client.query(`select set_config('xedine.bulk_load', 'on', true)`);
  for (const org of ORGS) await loadStatic(client, org);
  await loadBenchmarkReferences(client);

  const buffer = new DayBuffer();
  let days = 0;
  const manifest = await runSeed(async (_org, _branch, _date, rows) => {
    buffer.push(rows);
    if (buffer.size >= 6000) await buffer.flush(client);
    if (++days % 400 === 0) process.stdout.write('.');
  });
  await buffer.flush(client);
  for (const org of ORGS) {
    await client.query('select private.backfill_item_costs($1, $2::date, $3::date)', [
      ids.org(org),
      manifest.first_date,
      manifest.anchor_date,
    ]);
  }
  await client.query('commit');

  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, serializeManifest(manifest));
  const orders = Object.values(manifest.orgs).reduce((s, o) => s + o.totals.orders_completed, 0);
  console.log(
    `\nSeeded ${ORGS.length} orgs, ${orders.toLocaleString('en')} completed orders in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
  console.log(`Manifest written to ${MANIFEST_PATH}. Validate with: pnpm manifest:validate`);
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  throw e;
} finally {
  client.release();
  await pool.end();
}
