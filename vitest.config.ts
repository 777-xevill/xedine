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
    ],
  },
});
