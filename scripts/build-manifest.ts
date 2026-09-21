/** `pnpm manifest:build` — regenerate supabase/seed/manifest.json without a database. Deterministic. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MANIFEST_PATH, runSeed, serializeManifest } from './seed/build';

const manifest = await runSeed();
mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
writeFileSync(MANIFEST_PATH, serializeManifest(manifest));
const orders = Object.values(manifest.orgs).reduce((s, o) => s + o.totals.orders_completed, 0);
console.log(
  `Wrote ${MANIFEST_PATH} (${orders.toLocaleString('en')} completed orders across ${Object.keys(manifest.orgs).length} orgs).`,
);
