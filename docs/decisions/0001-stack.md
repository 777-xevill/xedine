# ADR 0001 — Stack and versions

- Date: 2026-09-22
- Status: accepted

## Context
CLAUDE.md requires the latest stable versions to be confirmed in Phase 0 and recorded here. Versions were looked up on the npm registry on 2026-09-22 (`pnpm view <pkg> version`), and each was then checked against its peers rather than taken blindly — two "latest" releases turned out not to work with the rest of the toolchain.

## Decision

| Area | Choice | Version | Note |
|---|---|---|---|
| Runtime | Node.js | 24 LTS (`.nvmrc`) | `engines.node >= 24` |
| Package manager | pnpm | 12.4.2 | pinned via `packageManager`; build scripts denied by default (`pnpm-workspace.yaml`) |
| Framework | Next.js (App Router) | 16.3.5 | Next 16 renamed `middleware` to `proxy` — see `src/proxy.ts` |
| UI runtime | React | 19.3.0 | |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | **6.0.3** | **not 7.0.2** — see below |
| Styling | Tailwind CSS | 4.3.3 | brand tokens as CSS variables (ADR 0009) |
| Components | shadcn-style primitives (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`) | current | hand-written, no runtime component library |
| Database / auth | Supabase (Postgres 17, Auth, RLS, Realtime, Storage) | CLI 2.117.0 | `@supabase/supabase-js` 2.116, `@supabase/ssr` 0.12.7 |
| Validation | Zod | 4.6.5 | |
| i18n | next-intl | **4.14.5** | not 4.14.6 — see below |
| Unit / DB tests | Vitest | 5.0.1 | `unit` and `db` projects |
| E2E | Playwright | 1.63.0 | |
| Lint / format | ESLint **9.39.5**, typescript-eslint 8.70, Prettier 3.9 | | **not ESLint 10** — see below |
| CI | GitHub Actions | | quality, database (real Supabase), e2e |
| Hosting | Vercel | | production project at Pilot gate A (ADR 0002) |

Deferred until the phase that needs them (dependency discipline — CLAUDE.md "Don'ts"): TanStack Query, PWA/IndexedDB (Phase 1), Anthropic SDK (Phase 3), Sentry (Phase 10).

### Three "latest" versions rejected, and why
1. **TypeScript 7.0.2 → 6.0.3.** `typescript-eslint` declares `typescript >=4.8.4 <6.1.0`. TypeScript 7 is the native port and does not expose the compiler API that typescript-eslint needs, so linting would break. Revisit when typescript-eslint supports 7.
2. **ESLint 10.11 → 9.39.5.** ESLint 10 removed `context.getFilename()`, which `eslint-plugin-react` 7.37 (shipped inside `eslint-config-next` 16.3.5) still calls: every lint run crashed with `TypeError: contextOrFilename.getFilename is not a function`. Found by running it, not by reading peer ranges. Revisit when `eslint-config-next` ships a plugin version that supports ESLint 10.
3. **next-intl 4.14.6 → 4.14.5.** 4.14.6 was published the same day. pnpm's release-age guard flagged it and offered to auto-exclude it from the check; that would have quietly disabled a supply-chain protection, so we pinned the previous release (one week old) instead. `pnpm-workspace.yaml` therefore has no `minimumReleaseAgeExclude` entries — keep it that way.

### Build scripts
pnpm 12 blocks dependency install scripts by default. `pnpm-workspace.yaml` explicitly denies the four that were requested (`@parcel/watcher`, `@swc/core`, `esbuild`, `unrs-resolver`): each ships its native binary as an optional dependency and only re-verifies it in a postinstall. Nothing was needed to be allowed; tsx, vitest, next and the Supabase CLI all run.

## Alternatives considered
- **Latest of everything** — rejected for the three cases above; a passing `pnpm add` is not evidence the toolchain works.
- **A component library (Radix/shadcn CLI-generated)** — deferred: Phase 0 needs a handful of primitives, and hand-written ones are easier to keep on the brand tokens and to audit for accessibility.

## Consequences
- Easier: `pnpm typecheck`, `pnpm lint`, `pnpm unit` all pass on the pinned set, and CI runs the same commands.
- Harder: three pins that must be revisited (TypeScript 7, ESLint 10, next-intl release age). They are listed here so the next dependency review starts from a known list rather than rediscovering the failures.
- **Revisit** at the start of each phase: `pnpm outdated`, and re-test the three pins.
