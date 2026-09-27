# Overnight worklog — 2026-09-27

You asked me to work unattended: resume from the last task and push through the phases, with a
checklist before each phase/big task, no questions, and a list of anything you need to run by hand.
This file is that record. Newest status is at the bottom of each section.

Ground rules I'm following (from CLAUDE.md + your instructions):
- Glassmorphism look from `UI_UX_design/`, **brand colours only** (tokens in docs/BRAND.md, never a new hex).
- Numbers only from metric functions; RLS on every table; money in poisha; injected clock.
- Verify with `pnpm typecheck && pnpm lint && pnpm unit && pnpm db:test:embedded` (no Docker here, ADR 0011).
  Real-Supabase checks (seed, e2e, DATA-MODEL.md) only run in GitHub Actions — listed under "Run by hand".
- One commit per finished slice on branch `phase-1-complete`. **Nothing is pushed** — pushing is yours.
- Never weaken a test or RLS to go green.

---

## Phase 1 — finish (POS, KDS, orders & cash)

State at start: backend completion migration + 52 integrity tests written, glass redesign done,
`en.json` updated, `bn.json` stale, no checks run, no commit.

Checklist:
- [x] 1.1 Rewrite `src/messages/bn.json` to match `en.json` (every key, Bangla, same placeholders)
- [x] 1.2 `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm unit` — fix everything
- [x] 1.3 `pnpm db:test:embedded` — full DB suite green
- [x] 1.4 ADR 0014 — single-use manager approval tokens
- [x] 1.5 Commit "Phase 1 (3/N)": approvals, lockdown, glass UI, staff/branch/settings screens
- [x] 1.6 POS variant/modifier picker
- [x] 1.7 POS "add round" (add items to a sent order)
- [x] 1.8 Offline: cached menu, IndexedDB outbox, idempotent sync, sync-status UI + test for "20 orders offline sync exactly once"
- [x] 1.9 Order history / lookup (refund an older order)
- [x] 1.10 E2E spec: order → KDS ready → split payment → receipt preview (runs in CI)
- [x] 1.11 ROADMAP Phase 1 boxes ticked with evidence; commit

## Run by hand (things I can't do from this machine)
- **Get CI to run.** CI only triggers on a push to `main` or on a pull request, and I don't push or open PRs
  without you. Run: `git push -u origin phase-1-complete` then `gh pr create --fill` (or merge to main).
  CI is the only place the real-Supabase DB suite, the seed + manifest and the new `tests/e2e/pos.spec.ts` run.
- **Known CI risk from before tonight:** the seed took ~3,375 s (was ~57 s) after `orders`/`order_items` were
  added to the Realtime publication. Suspected Realtime WAL decoding; untested fix is `supabase start -x realtime`
  in the CI database job. If CI times out on the seed, that's the first thing to try.
- **Try the till on a real 10" Android tablet** (Chrome): pair, PIN, place an order, pull the Wi-Fi, place
  two more, reconnect, and watch the sync badge go back to "All synced".
- If CI's data-model check fails: download the `data-model` artifact from the run and commit it
  as `docs/DATA-MODEL.md` (it can't be regenerated without Docker).

## Log

### Phase 1 log
- 3/N committed (47f3dc6): bn.json rewritten; fixed a server-component `onClick` crash on the menu page; ADR 0014.
- Till rebuilt around an outbox: place order / send to kitchen / payments are queued in IndexedDB and synced
  with the existing idempotency keys; voids/refunds/discounts/cancels stay online-only (ADR 0014).
- Fixed split payments: after a partial payment the till used to show the full total as still due.
- New: variant/add-on picker, add-round, order list (reopen/refund older orders), receipt header from receipt
  settings, provisional receipt numbers, sync badge + queue panel, service worker for offline reloads.
- Kitchen screen: only sent lines, order number + table, timer from the latest round, voided lines struck
  through, staff switch, poll fallback for Realtime.
- Tests: outbox unit tests (20 offline orders, lost responses), local money/tender tests, DB replay test,
  e2e spec for the Phase 1 journey (CI only). 104 unit + 725 DB tests green locally.
- Not done: optional QR table ordering (deferred by the roadmap itself); tablet check on a real device.
- Couldn't run `pnpm build` locally (1.8 GB free memory); CI builds it.

---

## Phase 2 — Metrics layer, Health Monitor & zero-input leaks

Plan (decisions go in ADR 0015):
- One SQL implementation per metric (`private.m_*`), thin `public.metric_*` wrappers that check branch
  access, and `can_see_money()` for anything with cost/profit/commission (ADR 0007). Clock is a parameter.
- Detectors in SQL too, so the nightly job and the CI golden check run the same code.
- S1/S2 baseline = the staff member's peers at the same branch over the same period (that is how the
  manifest defines "excess"); z-score + count floor + ৳ floor keep the clean café quiet.
- Commission drag = monthly structural-cost finding; anomaly findings weekly.

Checklist:
- [x] 2.1 Migration: helpers, sales / by-channel / by-daypart / by-payment / item velocity / pace metrics
- [x] 2.2 Money metrics: commission, labour.daily, fixed.daily, flash P&L, break-even (owner/accountant only)
- [x] 2.3 Findings engine: void, discount, refund, cash share (daypart-normalised), cash over/short, commission drag; upsert + status workflow RPC; day-close job (auto-complete paid orders, run detectors)
- [x] 2.4 DB tests: exact metrics on fixtures, windows with a frozen clock, money gating, detectors fire/stay quiet, workflow audited
- [x] 2.5 CI golden script: metrics = manifest, S1/S2/S3 within ±10%, S13 quiet, dashboard p95 < 2 s
- [x] 2.6 TS metric module + job route fan-out per org
- [x] 2.7 UI: Health Monitor (today), Item velocity explorer, "Where am I losing money?", costs setup (assumed food cost %, fixed costs, salaries)
- [x] 2.8 i18n bn/en, checks, ADR 0015, ROADMAP, commit

### Phase 2 log
- Migration `20260928000001_metrics_and_leaks.sql`: metrics, money metrics, 5 detectors, findings upsert,
  owner workflow + scan, evidence rows, day-close job. ADR 0015 lists the definitions I had to settle —
  **please confirm §1 (refunds net of VAT), §2 (split-tender pro rata) and §5 (peer baseline).**
- UI: Health Monitor on the overview, `/sales` explorer, `/leaks` + evidence page, `/costs` setup.
- Tests: 25 DB tests; `pnpm metrics:validate` golden script added to CI (runs after the seed).
- Not built: summary tables (deferred until the CI p95 check needs them); price-override detector (no
  manual override exists in the till).
- **Run by hand:** after CI seeds the demo org, open Demo Kacchi House → Leaks → "Scan the last 4 weeks"
  (or wait for the nightly job) to see findings in the UI; the golden script doesn't write findings.
