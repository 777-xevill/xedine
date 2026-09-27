import { defineConfig } from 'vitest/config';
import path from 'node:path';

const alias = {
  '@': path.resolve(import.meta.dirname, 'src'),
  // `server-only` throws when imported outside a React Server environment; tests are plain Node.
  'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        // The assistant's golden questions against the seeded year (CI). Skips its live part when no
        // Supabase URL is configured; the golden set's own checks always run.
        extends: true,
        test: {
          name: 'ai-evals',
          environment: 'node',
          include: ['tests/ai-evals/**/*.test.ts'],
          testTimeout: 600_000,
        },
      },
      {
        // Needs a real Supabase Postgres: DATABASE_URL (local `pnpm db:start`, or CI).
        extends: true,
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/db/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
      {
        // The same DB suite on an in-process Postgres (PGlite): no Docker. An emulation of Supabase — CI is the
        // authority (ADR 0011). The `pg` module is swapped for tests/db/embedded/pg.ts; the V8 flags keep
        // WASM compilation small enough for a memory-constrained machine.
        extends: true,
        resolve: {
          alias: { ...alias, pg: path.resolve(import.meta.dirname, 'tests/db/embedded/pg.ts') },
        },
        test: {
          name: 'db-embedded',
          environment: 'node',
          include: ['tests/db/**/*.test.ts'],
          exclude: ['tests/db/embedded/**'],
          testTimeout: 120_000,
          hookTimeout: 240_000,
          fileParallelism: false,
          pool: 'forks',
          execArgv: ['--liftoff-only', '--no-wasm-tier-up'],
        },
      },
    ],
  },
});
