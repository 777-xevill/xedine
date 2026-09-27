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

---

## Phase 3 — Recipes, costing & Menu Profit Intelligence (+ LLM gateway v0)

Blocker per ROADMAP: an Anthropic API key with a spend limit. I build everything behind an interface
with a mock transport so it is tested without a key; **you add the key** (see "Run by hand").

Plan:
- Money-gated `ingredient_price_history` (for S4's beef spike) and `order_item_costs` (sale-time recipe
  cost snapshot — never a column managers can read, ADR 0012 §3).
- SQL: ingredient unit cost at a date, recipe cost (sub-recipes, yields), TFC / TFC% / coverage, menu
  engineering (Kasavana–Smith), price & portion simulator, margin detectors (below target; negative
  margin on a channel after commission = S3 in full).
- Seed: ingredients, prices (+ week-20 beef spike), recipes for every item; manifest facts for S3 margin,
  S4, S5 and the matrix classes; golden checks extended.
- LLM gateway v0 (server-only, env models, usage + cost per org/day, daily cap, PII masking, prompt
  versions, prompt caching) and AI recipe drafts → chef edits → owner approves.

Checklist:
- [x] 3.1 Migration: history + snapshot tables, costing functions, food cost, matrix, simulator, detectors, drafts + approve RPC
- [x] 3.2 DB tests (costing exact, sub-recipes, snapshots gated, drafts never active without approval, matrix classes, detectors)
- [x] 3.3 Seed + manifest (S3 margin, S4, S5, matrix) + golden checks
- [x] 3.4 LLM gateway v0 + recipe drafting, unit-tested with a mock transport
- [x] 3.5 UI: ingredients & costs, recipe editor + approval, AI draft review, menu profit (matrix, TFC%, coverage, simulator)
- [x] 3.6 i18n, checks, ADR 0016, ROADMAP, commit

### Phase 3 log
- Migration `20260929000001_recipes_costing.sql`: price history, cost snapshots (money-gated), recipe
  costing with sub-recipes/yields, food cost & coverage, menu matrix, simulator, margin detectors, draft
  table + owner approval, AI usage RPC. ADR 0016 — **please confirm §3 (matrix n) and the $1/day AI cap.**
- Seed: ingredients, prices (beef spike weeks 20–23), a recipe for every demo item; manifest regenerated
  (order data unchanged — only new S3/S4/S5 facts). CI now validates at SEED_PHASE=3.
- Added dependency `@anthropic-ai/sdk` (official SDK, needed for the gateway).
- UI: `/recipes` (recipes, ingredients, AI drafts), `/menu-profit` (TFC, matrix, simulator).
- **Run by hand:** create an Anthropic API key with a monthly spend limit and set `ANTHROPIC_API_KEY`
  (and optionally `AI_MODEL_ASSISTANT`, `AI_MODEL_FAST`, `AI_DAILY_CAP_USD_MICROS`) in Vercel and
  `.env.local`; then try Recipes → AI drafts with a menu photo and check `ai_usage` shows the cost.
  Start Meta/WhatsApp business verification now (Phase 4 needs it).

---

## Phase 4 — AI Owner Assistant + WhatsApp rhythm

Blockers per ROADMAP/ADR 0010: Anthropic key (Phase 3) and Meta business verification for WhatsApp.
Built behind interfaces with mock transports; a deterministic question router answers the common
questions (item counts by window, sales, top items) even with no AI key, and is the eval baseline.

Checklist:
- [x] 4.1 Migration: jobs/webhooks may call metric wrappers as the service role (explicit org); owner WhatsApp opt-in; insight feed (rank, novelty, max 3/day, snooze/dismiss with reason); brief templates; schedules
- [x] 4.2 Assistant core: language detection, numeric-consistency validator, tool catalog (inherits the caller's permissions), deterministic router + templates, LLM tool loop with retry-once-then-template
- [x] 4.3 Chat UI + conversation storage; org_context (owner goals/rules) screen
- [x] 4.4 Golden eval set (≥ 40 questions from the manifest) + runner (router or LLM) + CI step
- [x] 4.5 Briefs (morning / evening / weekly): deterministic numbers + optional validated narrative → outbox
- [x] 4.6 Messaging gateway: WhatsApp Cloud API transport + mock, outbox sender job with retries, webhook (verify + signature + delivery status + inbound Q&A)
- [x] 4.7 Tests, i18n, ADR 0017, ROADMAP, commit

### Phase 4 log
- Migration `20260930000001_assistant_messaging.sql`: service-role metric access, insight feed, WhatsApp
  opt-in, brief templates (Meta drafts), schedules, `metric_window`.
- Assistant: router + validator + tools + LLM loop; `/assistant` chat with owner rules; evals in CI.
- Briefs + outbox + WhatsApp transport + webhook (`/api/webhooks/whatsapp`, now public in the proxy).
- Settings → WhatsApp briefs (explicit opt-in). Dashboard → Today's insights.
- Session was cut mid-phase once; resumed, all checks green: 140 unit, 781 DB tests.
- **Run by hand:** Meta business verification; create the 6 brief templates in Meta (names in the
  migration) and set the WHATSAPP_* env vars (see .env.example); add the `ANTHROPIC_API_KEY` repo secret so
  CI's evals exercise the LLM path. Please confirm ADR 0017 §2 and §5.

---

## Phase 5 — Purchasing, inventory & waste

Resumed 2026-09-27 after you said "go ahead and complete all tasks". Same rules as above; nothing pushed.

Plan (decisions go in ADR 0018):
- Stock maths in SQL, one implementation each (METRICS.md "Inventory"): theoretical usage explodes recipes
  in *bought* quantity (qty ÷ yield, sub-recipes included), stock.theoretical from the last submitted count,
  usage.actual / variance between two counts, days of cover with per-ingredient bands.
- Purchases are recorded only through audited RPCs (owner/purchaser, prices never reach managers); a
  confirmed purchase refreshes the ingredient's 14-day weighted-average cost (METRICS.md "Costing").
- AI purchase drafts (chit photo, voice-as-text, pasted text) sit in `purchase_drafts` and cannot touch stock
  until a person confirms them.
- Guided weekly count (blind — no expected quantity shown), waste log (mobile + KDS button, reasons,
  leaderboard), transfers with send/receive confirmation (a short receipt = "disputed").
- Discipline score per branch per day (METRICS.md) + nudges on the dashboard.
- Seed: a 12-week inventory ledger for both demo orgs (purchases, counts, waste, transfers) and the planted
  S6 (unrecorded chicken Dhanmondi → Mirpur), plus S7/S8/S9 data for Phase 6 — generated from separate
  random streams so the order data stays byte-identical.

Checklist:
- [x] 5.1 Migration: settings columns, RPCs (purchase, draft confirm, count, waste, transfer), weighted-average cost refresh, stock/variance/cover/discipline/leaderboard metrics
- [x] 5.2 DB tests (drafts never touch stock, stock & variance exact on fixtures, transfers, waste explode, discipline, money gating)
- [x] 5.3 Seed inventory ledger + manifest facts (S6 + P5 cover/discipline) + validators (SEED_PHASE=5)
- [x] 5.4 AI purchase extraction (photo / text / voice-as-text) behind the gateway, unit-tested with the mock
- [x] 5.5 UI: purchases & suppliers, AI drafts review, stock status + count, waste log + leaderboard, transfers, KDS waste button, discipline nudges
- [x] 5.6 i18n, checks, ADR 0018, ROADMAP, commit

### Phase 5 log
- Migration `20261001000001_inventory_purchasing.sql`: stock maths (moves, stock, variance, discipline, waste
  board), purchase/draft/count/waste/transfer RPCs (all audited, tables RPC-only), unit cost from purchases,
  waste reasons for every org. ADR 0018 — **please confirm §5 (managers who do the bazar get the purchaser
  role too), §6 (browser dictation for voice — Chrome sends the audio to Google) and §9 (a day with no bazar
  loses 25 discipline points).**
- Seed: a 12-week stock ledger for both demo orgs with S6–S9 planted plus realistic noise; the manifest gained
  an `inventory` section and S6–S9 facts (order data unchanged). CI now validates at SEED_PHASE=5.
- The seed's stock facts equal the SQL stock maths exactly — checked locally on the last four seeded weeks
  (`tests/db/seed-inventory.test.ts`, 85 s on the embedded Postgres).
- UI: `/stock` (levels + days of cover, counts & gaps, waste log + leaderboard, transfers), count sheet,
  `/purchases` (form, AI draft from photo / typed / dictated text, history + void, suppliers), KDS waste button,
  dashboard "Today's habits", morning brief nudges.
- `docs/DATA-MODEL.md` regenerated locally from the embedded database (it had been stale since Phase 1, which
  would have failed CI); the unchanged rows came out identical to CI's last version, so the generator agrees.
- Checks: typecheck, lint, format, 150 unit, 800 DB tests (embedded) — all green.
- **Run by hand:** with the API key set, try Purchases → "From photo or voice" with a real bazar chit.
---

## Phase 6 — Leak Detector v2

Checklist:
- [x] 6.1 Migration: variance bridge, usage / transfer / price / transfer-hygiene detectors, count-aligned periods, flash P&L on recipes, reference price import
- [x] 6.2 DB tests (hand-worked) + seed cross-check recovering S6–S9, café quiet
- [x] 6.3 CI golden checks at SEED_PHASE=6
- [x] 6.4 UI: evidence for new types + actions + ask assistant; resolved tab; bridge on Stock; market prices import
- [x] 6.5 Assistant tools (explain_finding, stock, food-cost gap) + deterministic answers
- [x] 6.6 i18n, ADR 0019, ROADMAP, DATA-MODEL.md, commit, push

### Phase 6 log
- Migration `20261002000001_leak_detector_v2.sql`. ADR 0019 — **please confirm §2 (a leak's ৳ is only what
  goes beyond other branches' normal loss) and §4 (the 50% match rule for suspected transfers).**
- Branch pushed to GitHub (you asked); still no pull request, so CI has not run.
- Checks: typecheck, lint, 152 unit, 809 DB tests (embedded) — all green.
