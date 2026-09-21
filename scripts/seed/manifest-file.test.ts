import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANIFEST_PATH, runSeed, serializeManifest } from './build';
import { ManifestSchema } from './manifest';

// ADR 0006: the committed manifest is the oracle later phases assert against. If the generator
// changes, regenerate with `pnpm manifest:build` and review the diff deliberately.
describe('supabase/seed/manifest.json', () => {
  it('parses against its schema', () => {
    expect(() =>
      ManifestSchema.parse(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))),
    ).not.toThrow();
  });

  it('is exactly what the generator produces (deterministic, and not stale)', async () => {
    const fresh = serializeManifest(await runSeed());
    expect(readFileSync(MANIFEST_PATH, 'utf8')).toBe(fresh);
  }, 120_000);
});
