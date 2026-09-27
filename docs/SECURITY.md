# Security review (Phase 10)

Status at 2026-10-08. This is the founder's working checklist, not a certification — re-read it before
onboarding paying customers and before every later phase that touches auth, payments or PII.

## RLS and tenant isolation (CLAUDE.md #2)
- Every tenant table carries `org_id` (and `branch_id` where relevant), RLS enabled, and is registered with
  `private.policy_registry`. `tests/db/isolation.test.ts` enumerates every table from the database at test
  time — a new table is covered the moment it is migrated, and the suite fails if it isn't registered.
  For each table it proves: another org's owner can neither read, insert into, update nor delete this
  org's rows; each role sees exactly what its policy says; a positive control that the owner *can* read
  their own rows (so a table can't pass by returning nothing to everyone).
- `tests/db/structure.test.ts` additionally checks: every `SECURITY DEFINER` function pins `search_path`
  (so it can't be hijacked by a search-path attack); every tenant table has an index leading with `org_id`,
  and branch-scoped tables index `branch_id` too; every money column is `bigint` poisha, never float.
- The service-role key is never imported outside `src/app/api/jobs/**`, `src/app/api/webhooks/**`,
  `src/modules/**/jobs/**` and `src/lib/llm-gateway/**` (ESLint `no-restricted-imports`, CLAUDE.md #2); every
  service-role query in those paths filters by an explicit `org_id`.
- Money, cost and finding-impact figures are gated by `can_see_money(org)` / `require_money(org)` in SQL, not
  the UI (ADR 0007); the assistant inherits the caller's own session, so it never sees more than the caller.
- Every SQL function new to Phase 8–10 ends with an explicit `revoke ... from public, anon` /
  `grant ... to authenticated` sweep — a function otherwise defaults to callable by anyone signed in, which
  `structure.test.ts`'s "no function executable by anon" check catches.

## Secrets
- `.env.local` and every `.env.*` variant are gitignored; only `.env.example` (placeholders) is committed.
- `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `JOB_SECRET` and the WhatsApp tokens are read from
  `process.env` only, server-side; none appear in client bundles (the ESLint rule above enforces this for
  the service-role key specifically).
- Searched the tracked tree for API-key-shaped strings (`sk-ant-…`, JWT-shaped tokens, literal
  `SUPABASE_SERVICE_ROLE_KEY=`) — none found. `pnpm audit --prod` reported no known vulnerabilities
  (2026-10-08; re-run this before each release, dependency advisories change).

## Headers (`next.config.ts`)
`X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` · `Referrer-Policy: strict-origin-when-cross-origin`
· `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` · `Permissions-Policy` (only
`microphone=(self)`, for voice entry in purchases/waste; everything else denied) · a narrow
`Content-Security-Policy` (`frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`).
**Deferred:** a full `script-src`/`style-src` CSP needs per-request nonces threaded through Next's inline
scripts — worth doing before launch, but a partial CSP now is safer than none.

## CSRF and forms
Next.js 16 Server Actions (`package.json` pins `next@16.3.5`, ADR 0001) enforce same-origin `Origin`/`Host`
checks on every action POST by default — the framework refuses a cross-origin form submission before it
reaches our code. No additional CSRF token is needed for the server-action forms this app is built from
(`ActionForm`, plain `<form action={...}>`).

## Public, unauthenticated surfaces
- `/f/[token]` + `/api/webhooks/feedback`: the token is 144 bits of randomness, only its SHA-256 is stored,
  it is single-use and expires after 14 days (`submit_feedback`). Brute-forcing it is impractical; no rate
  limit is applied.
- `/api/webhooks/whatsapp`: POST bodies are verified against `X-Hub-Signature-256` (HMAC-SHA256 with the
  Meta app secret) before anything is processed.
- `/api/jobs/[job]`: requires a long bearer secret (`JOB_SECRET`) compared with `timingSafeEqual`; every
  call is claimed in `job_runs` so a retry or a double fire is a no-op.
- `/api/export/[kind]`: requires a signed-in session with an owner/accountant membership row; no service
  role involved.
- **Gap — no rate limiting.** None of the above is rate-limited. A serverless deployment (Vercel) has no
  in-process memory to count requests across invocations, so an in-memory limiter would give false
  confidence; a real one needs a shared store (e.g. Upstash Redis) and is a deliberate dependency choice
  the founder should make, not one to add silently (CLAUDE.md "don't add a dependency without saying why").
  **Recommended before launch:** a Redis-backed limiter in front of the four routes above, keyed by IP
  and/or org.

## Backups, monitoring, performance — deferred to launch prep
- **Backups:** Supabase manages Postgres backups per plan tier; point-in-time recovery needs a paid tier.
  `TODO(verify)`: confirm the plan and retention period once a production project exists.
- **Monitoring:** none configured beyond Vercel's and Supabase's own dashboards. No error tracking (e.g.
  Sentry) or uptime alerting yet — needed before real customers depend on the product.
- **Performance:** `scripts/validate-metrics.ts`'s `dashboardLatency()` asserts the Health Monitor's four
  queries load in under 2 s p95 on the seeded year of data (single org, single machine). No load test has
  been run under concurrent multi-tenant traffic — worth doing once there are real pilots.

## What "done" means here
This document exists so the gaps are named, not hidden. The RLS/isolation/structure suites are real,
automated and re-run on every `pnpm db:test:embedded`; the four items above are not — they are ops and
infrastructure decisions for the founder to make before onboarding paying customers, tracked here so they
are not forgotten.
