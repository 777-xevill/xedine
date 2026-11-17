/**
 * Checks the Google Play listing text in LISTING.md against Play's limits (ADR 0065):
 *   node docs/play-store/check-listing.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'LISTING.md'), 'utf8');
const LIMITS = { name: 30, short: 80, full: 4000 };
let ok = true;
for (const lang of ['en', 'bn']) {
  for (const [field, max] of Object.entries(LIMITS)) {
    const m = text.match(new RegExp(`<!-- ${field}:${lang} -->\\n([\\s\\S]*?)\\n<!-- /${field}:${lang} -->`));
    if (!m) {
      console.log(`MISSING ${field}:${lang}`);
      ok = false;
      continue;
    }
    // Play counts characters (code points), not bytes.
    const length = [...m[1].trim()].length;
    const pass = length <= max;
    ok &&= pass;
    console.log(`${pass ? 'ok  ' : 'LONG'} ${field}:${lang} ${length}/${max}`);
  }
}
process.exit(ok ? 0 : 1);
