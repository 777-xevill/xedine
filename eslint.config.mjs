import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

/** ADR 0006: business logic never reads the wall clock directly; it uses src/lib/time/clock.ts. */
const noWallClock = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      'Do not call new Date() in business logic. Use now() from @/lib/time/clock (ADR 0006).',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message:
      'Do not call Date.now() in business logic. Use now() from @/lib/time/clock (ADR 0006).',
  },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([
    '.next/**',
    'out/**',
    'coverage/**',
    'node_modules/**',
    'files (4)/**',
    '.scratch/**',
    'next-env.d.ts',
    'supabase/**',
  ]),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // CLIs print to the terminal on purpose.
    files: ['scripts/**', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // ADR 0006: injected clock.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/time/clock.ts', '**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...noWallClock] },
  },
  {
    // CLAUDE.md non-negotiable #6: no hardcoded UI strings.
    files: ['src/app/**/*.tsx', 'src/components/**/*.tsx'],
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: false,
          ignoreProps: true,
          allowedStrings: ['·', '—', '/', '|', '(', ')', '+'],
        },
      ],
    },
  },
  {
    // CLAUDE.md non-negotiable #2: the service-role client is server-only, in jobs/webhooks.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/app/api/jobs/**',
      'src/app/api/webhooks/**',
      'src/modules/**/jobs/**',
      'src/lib/db/service-role.ts',
      // Creates the confirmed account for a holder of a live invitation token (ADR 0035).
      'src/modules/tenancy/invite-account.ts',
      // ai_usage is written only by the LLM gateway (ARCHITECTURE.md "AI layer"), for an explicit org.
      'src/lib/llm-gateway/**',
      '**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/db/service-role', '@/lib/db/service-role'],
              message:
                'The service-role client is only for jobs and webhooks, with explicit org_id filters.',
            },
          ],
        },
      ],
    },
  },
]);
