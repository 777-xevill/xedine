# ADR 0011 — Database verification without local Docker

- Date: 2026-09-22
- Status: accepted (revisit when the development machine can run Docker)

## Context
ADR 0002 chose local Supabase (Docker) for day-to-day development. On the founder's machine (Windows 11, 9.9 GB RAM, a 2.2 GB page file) that is not currently possible:

- **Docker Desktop's installer failed** (`winget` exit code 2 — it needs an interactive administrator approval that was never given).
- **The Windows commit limit is nearly exhausted** by ordinary applications (12 GB total, ~11.9 GB committed): free virtual memory sat between 70 MB and 1.4 GB during the build. Symptoms were `memory allocation failed` from pnpm, `WebAssembly.Memory(): could not allocate memory` from an in-process Postgres, and PowerShell failing to start (`0x800705AF`, "paging file too small"). A Docker VM plus the Supabase stack would not fit.

## Decision
Two layers, in order of authority:

1. **GitHub Actions against real Supabase is the source of truth.** The `database` job runs `supabase start` (real Postgres 17 + Supabase Auth), applies every migration, runs the full DB suite, seeds the synthetic year, validates the manifest against the database, and regenerates `docs/DATA-MODEL.md`. The `e2e` job runs the browser journey against a real Supabase.
2. **`pnpm db:test:embedded` is a fast local check that needs no Docker.** It runs the *same* DB suite on an in-process Postgres (PGlite): the real migrations, RLS, triggers and RPCs, on real Postgres semantics, in ~25 seconds. It swaps the `pg` driver for `tests/db/embedded/pg.ts` and stands in for the Supabase-only pieces with `tests/db/embedded/supabase-stub.sql` (a two-table `auth` schema, the three API roles, Supabase's default privileges).

Everything that needs no database (types, lint, formatting, unit tests incl. the seed generator and the committed manifest) runs locally in seconds as before.

### What the embedded run does and does not prove
- **Proves:** every migration applies; RLS isolation for every table; the role/branch/money visibility matrix; composite-FK, index, `search_path` and privilege invariants; PIN lockout, audit, VAT guard, business date, job idempotency, the k ≥ 5 floor. It found two real bugs that reading the SQL had missed (an enum-typed `CASE` in two RPCs, and an ambiguously-typed parameter in the seed loader).
- **Does not prove:** anything about Supabase Auth (GoTrue), PostgREST, `pg_cron`/`pg_net`, storage, or Realtime; real `auth.users` column drift; the Next.js app; or the full-year seed (≈1M rows exhausts the in-process WASM heap here — a 10-day slice of the same loader and validator passes, and the full year runs in CI).

### Getting PGlite to run at all on this machine
V8's default WebAssembly tier-up needs far more transient memory than the machine has: the process died with `Fatal process out of memory: Zone`. Running with `--liftoff-only --no-wasm-tier-up` (set in the `db-embedded` Vitest project's `execArgv`; `NODE_OPTIONS` rejects V8 flags) compiles it in a small fraction of the memory. PGlite's socket server (`pglite-socket`) was tried first and rejected: it desynchronizes after Postgres errors, which the tests provoke on purpose.

## Alternatives considered
- **Skip database verification until Docker works** — rejected: RLS is the security boundary of the product and the riskiest part of Phase 0.
- **A cloud Supabase project as the test database** — free tier pauses, tests would write to a shared environment, and a laptop would be the only place a green run can happen.
- **PGlite as the only database test** — rejected: it is an emulation. It is a fast pre-flight, not evidence of compatibility with Supabase.

## Consequences
- Easier: a real DB feedback loop in ~25 s on a machine that cannot run Docker; CI stays the authority and catches Supabase-specific drift.
- Harder: two DB environments to keep aligned. `supabase-stub.sql` must track anything a migration starts to rely on in Supabase's `auth`/role setup; if the embedded run and CI ever disagree, CI wins and the stub is fixed.
- **Recommended for the founder:** raise the Windows page file (System → Advanced → Performance → Virtual memory) to at least 16 GB and close idle dev servers; then install Docker Desktop and run `pnpm db:start && pnpm db:test`. Nothing in the repo needs to change.
- **Revisit** once Docker runs locally: `pnpm db:test` should reproduce CI exactly, and the embedded run can stay as the quick pre-flight or be retired.
