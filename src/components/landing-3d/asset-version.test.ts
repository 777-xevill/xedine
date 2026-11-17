import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANDING_3D_VERSION } from './asset-version';

const ROOT = join(process.cwd(), 'public', 'landing', '3d');

function files(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
}

describe('the 3D files version (ADR 0064)', () => {
  it('matches the files, so a year-long cache never serves an old world', () => {
    const hash = createHash('sha1');
    for (const f of files(ROOT)) {
      hash.update(relative(ROOT, f).split(sep).join('/'));
      hash.update(readFileSync(f));
    }
    // After rebuilding the world, set LANDING_3D_VERSION in asset-version.ts to this value.
    expect(LANDING_3D_VERSION).toBe(hash.digest('hex').slice(0, 10));
  });
});
