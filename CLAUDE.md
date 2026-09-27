# Xedine

AI profit-intelligence platform + restaurant OS for Bangladesh (single- and multi-branch, any restaurant type).
Core promise: **show the owner where money is leaking, with proof in BDT, and what to do next.**
Founder: solo developer (Xevill). You are the senior engineer.

## Read before working (only what the task needs)
- Product & modules: docs/PRODUCT.md
- Architecture & AI rules: docs/ARCHITECTURE.md
- Every number's definition: docs/METRICS.md  ← metric code must match this exactly
- Phases, acceptance criteria, test oracle: docs/ROADMAP.md
- Tables: docs/DATA-MODEL.md · Decisions: docs/decisions/ · Visual rules: docs/BRAND.md

**Decisions already made (read before planning):** ADR 0001 stack & versions · 0002 repo/environments · 0003 auth · 0004 jobs · 0005 VAT & price basis · 0006 test-oracle clock & P0 scope · 0007 money visibility by role · 0008 provisional pricing · 0009 brand tokens · 0010 external approvals · 0011 verification without Docker · 0012 Phase 0 design decisions · 0013 POS device auth · 0014 single-use manager approvals · 0015 Phase 2 metrics & detectors · 0016 Phase 3 costing & LLM gateway · 0017 Phase 4 assistant & WhatsApp · 0018 Phase 5 purchasing, inventory & waste.

## Non-negotiables
1. **Numbers are deterministic.** Every figure shown to a user comes from a metric function defined in docs/METRICS.md (SQL/TS). LLMs never calculate, estimate, or invent numbers; they explain, route, and draft. Any LLM text containing numbers must pass the numeric-consistency validator (every number appears in the tool results) or it is rejected.
2. **Tenant isolation.** Every tenant table has `org_id` (and `branch_id` where relevant), RLS enabled, policies via helper functions. Never disable RLS. Never use the service-role key in client code. Jobs using the service role filter by `org_id` explicitly. Every new table ships with an isolation test.
3. **Money & time.** Money = integer poisha (`bigint`, ৳1 = 100). Quantities in base units (g, ml, pcs) as `numeric`. Store `timestamptz` (UTC); business logic uses Asia/Dhaka and the branch's business-day cutoff (default 04:00). Order lines store the full decomposition (`net`, `vat`, `service_charge`, `total`) — never derive money by multiplying a price by a quantity in a component; use the shared helper (ADR 0005). **No `now()` / `new Date()` in business logic** — the clock is injected, so business-day and rolling-window behaviour is testable (ADR 0006).
4. **Draft → approve.** AI outputs that change data or reach people (recipes, purchases from photo/voice, supplier orders, review replies, campaigns) are saved as drafts and need explicit human approval. No autonomous sends in MVP.
5. **Audit sensitive actions.** Voids, refunds, discounts, price/recipe edits, stock adjustments, role changes → `audit_log` (who, what, before/after, when, device).
6. **Bangla + English.** No hardcoded UI strings; everything via i18n (`bn`, `en`). BDT with lakh grouping (1,23,456) via shared formatters; Bangla digits when locale is `bn`.
7. **POS works offline.** Client-generated UUIDs + idempotency keys; outbox sync; never double-charge or double-count.
8. **PII care.** Customer phones/names: consent flags, masked in logs, excluded from LLM prompts unless essential.
9. **Brand colour is READY; typography is not.** Use the colour tokens in docs/BRAND.md as CSS variables — never a hex literal in a component, so rebranding stays a token swap. Dark theme only. Typography stays on a neutral system stack until the guideline's type section arrives. The gradient and the "AI Generated" badge mark narrative and drafts, **never a number** (ADR 0009).
10. **Money visibility.** Cost, margin, profit and finding ৳ impacts are visible to owner and accountant only — enforced in SQL via `can_see_money(org)`, not in the UI. The AI assistant inherits the caller's permissions (ADR 0007).

## Stack
Versions and the reasons three "latest" releases were rejected are in docs/decisions/0001-stack.md — re-check them at the start of each phase.
Next.js (App Router, TypeScript strict) · Tailwind + shadcn/ui · Supabase (Postgres, Auth, RLS, Realtime, Storage, CLI migrations) · Zod · TanStack Query where client caching is needed · i18n library (bn/en) · PWA + IndexedDB for offline POS · Vitest · Playwright · Anthropic API through a server-only gateway · WhatsApp Cloud API through a messaging gateway · pnpm · GitHub Actions · Vercel.
Scheduled work runs on **Supabase `pg_cron` → authenticated job routes**, not Vercel Cron (ADR 0004). Auth is **email + password, managers by invite** (ADR 0003).

## Layout
```
src/app/            (auth) (dashboard)/[org] (pos) (kds) (qr) (admin) api/
src/modules/<domain>/  tenancy menu pos kds payments customers recipes inventory purchasing
                       metrics leaks forecasting assistant messaging reviews benchmarking
                       compliance staff growth billing
src/lib/            db i18n money time llm-gateway messaging validation
supabase/           migrations/ seed/ tests/
tests/              e2e/ ai-evals/
scripts/
```
Domain logic lives in `src/modules/*` (server-only files import `server-only`). UI never computes metrics; it calls metric functions.

## Commands (keep current)
- dev: `pnpm dev` · typecheck: `pnpm typecheck` · lint: `pnpm lint` · format: `pnpm format` / `pnpm format:check` · unit: `pnpm unit`
- db start/stop: `pnpm db:start` / `pnpm db:stop` (needs Docker — see ADR 0011) · db reset + seed: `pnpm db:reset:seed`
- db tests (structure, RLS isolation for every table, tenancy, money visibility, PINs, audit, time, jobs): `pnpm db:test` (real Supabase; needs Docker) · **no Docker:** `pnpm db:test:embedded` (same suite on an in-process Postgres, ~25s — an emulation, CI is the authority)
- Golden checks against the seeded year (CI): `pnpm metrics:validate` (`SEED_PHASE=5` adds the stock ledger)
- seed only: `pnpm db:seed` · regenerate the manifest without a DB: `pnpm manifest:build` · validate it against the DB: `pnpm manifest:validate` (`SEED_PHASE=n`)
- regenerate docs/DATA-MODEL.md from the live schema: `pnpm db:docs` (CI fails if it is stale) · TS types from the schema: `pnpm db:types`
- e2e: `pnpm build && pnpm e2e` (needs a running Supabase and `.env.local`) · ai evals: `pnpm ai:evals` (Phase 3–4)
- **Without Docker** (this founder's machine, ADR 0011): `pnpm typecheck && pnpm lint && pnpm unit && pnpm db:test:embedded` run locally; real-Supabase checks (seed + manifest, e2e, data-model) run in GitHub Actions (`.github/workflows/ci.yml`).

## Repo conventions
- New tenant table → register it with the policy engine (`private.apply_policies` / `private.register_table`) and add a `COMMENT ON TABLE 'purpose | written by: module | phase: n'`. `tests/db/structure.test.ts` and `tests/db/isolation.test.ts` fail if you forget; the isolation suite covers every table automatically.
- Cost/margin/profit data goes in a **separate money-gated table**, never a column on a row managers can read (ADR 0012 §3).
- Tenant-to-tenant foreign keys are composite `(org_id, id)`.
- Never `new Date()` / `Date.now()` under `src/` (ESLint enforces it): use `now()` from `@/lib/time/clock`.
- Never a hardcoded UI string or a hex colour in a component (ESLint / `brand-tokens.test.ts`).

## Workflow for every task
1. Plan first when touching more than 2 files: slices, files, migrations, tests, open questions. Ask before guessing product decisions.
2. Build thin vertical slices (migration + RLS + server logic + UI + tests).
3. Verify with evidence: run typecheck, lint, relevant tests; show the output. Fix root causes; never weaken tests or RLS to go green.
4. Update docs: ROADMAP checkboxes, DATA-MODEL.md, an ADR for any decision.
5. Finish with summary, evidence, gaps, suggested commit message. Don't start the next phase unasked.

## Don'ts
- Don't edit applied migrations; add new ones.
- Don't add a dependency without saying why and checking it's maintained.
- Don't use `any` or disable lint rules to get green.
- Don't hardcode Bangladesh regulatory facts (VAT rates, Mushak fields, licence rules) as truth: make them config and mark `TODO(verify)`.
- Don't put secrets in code or chat; use `.env.local` + `.env.example`.
- Don't generate fake numbers in production paths; synthetic data lives only in the seed/demo orgs.

## Test oracle
The synthetic data generator (supabase/seed) plants known leaks and writes a ground-truth manifest (see docs/ROADMAP.md). Analytics features are done only when they recover the planted truth within tolerance.

When compacting, preserve: current phase, open questions, modified-files list, test commands.
