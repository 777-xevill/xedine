# ADR 0011 — Database verification runs in CI when local Docker is unavailable

- Date: 2026-09-22
- Status: accepted (revisit when the development machine can run Docker)

## Context
ADR 0002 chose local Supabase (Docker) for day-to-day development. On the founder's machine (Windows 11, 9.9 GB RAM, a 2.2 GB page file) that is not currently possible:

- **Docker Desktop's installer failed** (`winget` exit code 2 — it needs an interactive administrator approval that was never given).
- **The Windows commit limit is nearly exhausted** by ordinary applications (12 GB total, ~11.9 GB committed): free virtual memory sat between 70 and 300 MB during the build. Symptoms were `memory allocation failed` from pnpm, `WebAssembly.Memory(): could not allocate memory` from an in-process Postgres (PGlite), and PowerShell failing to start (`0x800705AF`, "paging file too small"). A Docker VM plus the Supabase stack would not fit.

An in-process Postgres emulator (PGlite) was tried as a substitute and rejected: it cannot allocate memory here either, and it would not exercise the real thing — Supabase's `auth` schema, roles, `pg_cron`/`pg_net`, PostgREST.

## Decision
**GitHub Actions is the verification environment for everything that needs a database.** The `database` job runs `supabase start` (real Postgres 17 + Supabase Auth), applies every migration, runs the full DB test suite, seeds the synthetic dataset, validates the manifest, and regenerates `docs/DATA-MODEL.md`. The `e2e` job runs the browser journey against a real Supabase.

Everything that does not need a database (types, lint, formatting, unit tests including the seed generator and the committed manifest) still runs locally in seconds.

The DB tests are written against `DATABASE_URL`, so they are identical locally (with Docker) and in CI. Nothing about the suite is CI-specific.

## Alternatives considered
- **PGlite locally** — tried; cannot allocate memory here, and is not real Supabase.
- **A cloud Supabase project as the test database** — free tier pauses, tests would write to a shared environment, and it makes a laptop the only place a green run can happen.
- **Skip database verification until Docker works** — rejected: RLS is the security boundary of the product and the riskiest part of Phase 0.

## Consequences
- Easier: verification is the same real stack every time, on a clean machine, for every push; a green run is reproducible evidence.
- Harder: the feedback loop for SQL is a push and a few minutes, not seconds. Mitigated by keeping migrations small and the suite fail-fast on the structural checks.
- **Recommended for the founder:** raise the Windows page file (System → Advanced → Performance → Virtual memory) to at least 16 GB, and close idle dev servers; then install Docker Desktop and run `pnpm db:start`. Nothing in the repo needs to change.
- **Revisit** once Docker runs locally: `pnpm db:start && pnpm db:test` should reproduce CI exactly.
