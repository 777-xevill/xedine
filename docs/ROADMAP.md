# Xedine — Roadmap

**How to use:** one phase per conversation → `/phase N`. A phase is done only when every "Done when" box is ticked with evidence. Sizes are rough for one focused developer.

## Order & gates
```
P0 Foundation → P1 POS/KDS → P2 Metrics + zero-input leaks → [Pilot gate A]
→ P3 Recipes & menu profit → P4 AI assistant + WhatsApp → [Pilot gate B]
→ P5 Purchasing/inventory/waste → P6 Leak detector v2 → P7 Forecast + bazar list
→ P8 Customers/retention/reviews → P9 Branch intelligence + benchmarking
→ P10 Compliance, staff-lite, growth, billing, launch hardening
```
Parallel from week 1: manual leak audit with 3–5 restaurants (spreadsheets) to validate thresholds and recruit pilots.

## Test oracle — planted scenarios (built in Phase 0, used by later phases)
Demo org **"Demo Kacchi House"** (3 branches: Dhanmondi, Mirpur, Uttara) + **"Demo Café"** (single branch). 365 days of orders ending on the manifest's **`anchor_date` (2026-09-21)** — not on today — with BD patterns (weekend, salary week, Ramadan/Eid from the seeded calendar, rainy days). Scenarios are written to `supabase/seed/manifest.json` with exact expected values.

**Clock and phase scoping ([ADR 0006](decisions/0006-test-oracle-clock-and-p0-scope.md)):** tests freeze "now" to `anchor_date 23:30 Asia/Dhaka`, so `last_2h`, `today` and `week_to_date` are deterministic and non-empty. Each scenario carries `available_from_phase`; the validator only asserts scenarios at or below `SEED_PHASE` and reports the rest as pending rather than failing. Phase 0 migrates the **full core schema** (so RLS and the isolation suite are written once) but only generates data for the scenarios its phase can detect.

| # | Scenario | Detected in |
|---|---|---|
| S1 | Mirpur cashier voids after KOT on cash orders at ~6× baseline | P2 |
| S2 | Uttara manager gives ~3× normal discounts on Thursdays | P2 |
| S3 | A delivery combo is negative-margin after foodpanda commission | Commission drag: P2 · full negative margin: P3 (needs recipe cost) |
| S4 | Beef price spike (week 20) pushes Beef Tehari below target margin | P3 |
| S5 | One Dog and one Puzzle item on the menu | P3 |
| S6 | Unrecorded chicken transfers Dhanmondi → Mirpur twice a week | P5–P6 |
| S7 | Mirpur over-portions kacchi mutton by ~12% | P6 |
| S8 | Dhanmondi purchaser pays 9–12% above median for beef on some days | P6 |
| S9 | Uttara unlogged rice waste ≈ 4 kg/day | P6 |
| S10 | Ramadan iftar surge, Eid closure + rebound, salary-week lift, rainy-day dine-in dip | P7 |
| S11 | Dhanmondi Friday 20:00–22:00 ticket times double; "slow" complaints | P8 |
| S12 | Uttara regulars lapse after a price increase | P8 |
| S13 | Demo Café is clean (false-positive control) | all |

Tolerances: sums exact · finding ৳ impact within ±10% of manifest · every designed scenario detected · ≤ 1 false-positive finding per branch-week on the clean org.

---

## Phase 0 — Foundation
Status: ☑ **done — CI green against real Supabase** (run 35695870786, 2026-09-22) · Size: 1–2 weeks
**Goal:** secure multi-tenant skeleton, test harness, demo data.
**Evidence:** `quality` (typecheck, lint, format, 95 unit tests) · `database` — 662 DB tests over 93 tables on real Supabase, seed of **105,417 completed orders in 64s**, `✓ Manifest matches the database exactly` (S1, S2, S3, S13 validated; S4–S12 pending by design), `docs/DATA-MODEL.md` regenerated from the live schema and verified not stale · `e2e` — 10/10 Playwright tests.
**Build**
Decisions already settled: ADRs 0001–0012. Read them before planning.
- [x] Verify latest stable versions; scaffold Next.js (App Router, TS strict), Tailwind, ESLint/Prettier, Vitest, Playwright, pnpm; ADR 0001-stack (three "latest" releases rejected and why). Component primitives are hand-written on the brand tokens, not the shadcn CLI
- [x] `git init` at repo root + private GitHub remote (`777-xevill/xedine`, ADR 0002); `.gitignore` excludes `files (4)*`
- [ ] Supabase local (CLI + Docker) and a free dev cloud project — **CLI project configured and proven in CI (`supabase start` applies every migration); Docker could not be installed on this machine (ADR 0011), and no cloud dev project exists yet (needs the founder's Supabase account)**. `.env.example` done; `pnpm db:types` runs once a database is reachable
- [x] Auth: email + password; manager invite creates user + membership atomically (ADR 0003); device registration, pairing codes and staff PIN sessions with lockout — **database and RPCs only; the POS PIN screen and the device's own credential are Phase 1** (ADR 0012 §7)
- [x] Tenancy: organizations, branches, memberships, roles, org_settings (incl. `price_includes_vat`, VAT rate, cutoff, dayparts, week start), org_profile; RLS helpers incl. `can_see_money` (ADR 0007); org/branch switcher
- [x] Full core schema migrated per ARCHITECTURE.md's entity list (93 tables), so RLS + isolation tests are written once (ADR 0006)
- [x] Money helper: VAT decomposition + poisha rounding, one shared function (ADR 0005)
- [x] Injected clock module; lint rule banning `new Date()` / `Date.now()` in business logic (ADR 0006) — proven to fire by a deliberate violation
- [x] audit_log + helper; job_runs; `pg_cron` bootstrap + an alert on missing runs (`job_health()`, ADR 0004)
- [x] i18n bn/en; formatters: BDT (poisha), lakh grouping, Bangla digits, Asia/Dhaka, business_date(cutoff)
- [x] App shell with route groups (dashboard, pos, kds, qr, admin) on the BRAND.md colour tokens, dark theme, system font stack (ADR 0009)
- [x] Synthetic data generator + manifest with `anchor_date` and per-scenario `available_from_phase`; one command for db reset + seed (`pnpm db:reset:seed`)
- [x] CI: typecheck, lint, unit, DB tests — plus seed, manifest validation, generated data-model doc and the browser journey
- [x] Fill "Commands" in CLAUDE.md; docs/DATA-MODEL.md is generated from the live schema (`pnpm db:docs`)
**Done when**
- [x] Owner signs up, creates an org with branches, invites a manager limited to one branch — `tests/e2e/onboarding.spec.ts`, 10/10 green
- [x] RLS suite proves org A users can't read/write any org B row (**every table, with fixture rows inserted as org A**) — 525 isolation assertions over 93 tables, real Supabase
- [x] A branch manager cannot read any cost, margin or profit value, proven at the SQL layer — `tests/db/money-visibility.test.ts`
- [x] Seed runs from scratch in one command; **manifest validates for phase-0 scenarios (S1, S2, S3-commission, S13)** — 105,417 orders, `✓ Manifest matches the database exactly`
- [x] bn/en switch works; formatters unit-tested (1,23,45,678; business_date around 00:00 and 04:00) — unit tests + the live switch in the browser journey
- [x] VAT decomposition tested both ways: a receipt's lines sum to its total under `price_includes_vat` true and false — `src/lib/money/money.test.ts`
- [x] CI green

**What running it for real caught** (none of it visible from reading the code): `name[]` arrays — FK/PK columns and enum labels — come back from node-postgres unparsed, so the fixture builder read `"{"` as an enum value; an enum-typed `CASE` in two RPCs; an ambiguously typed parameter in the seed loader; a `DISTINCT`/`ORDER BY` mismatch in the doc generator; and a session-cookie race in the browser tests. The embedded Postgres check (ADR 0011) missed the first and last classes — it is a pre-flight, not the authority.

**Open questions from the kit — settled in [ADR 0012](decisions/0012-phase-0-design-decisions.md):** invoice numbering (server-assigned; offline receipts carry a provisional number) · `business_date` (stored, set at insert). **Still open, deliberately:** PII retention window and deletion flow (needs legal review; Phase 8) · device credential (Phase 1).

## Phase 1 — POS, KDS, orders & cash
Status: ◐ **built; local checks green, awaiting the first CI run** (2026-09-27) · Size: 3–4 weeks
**Goal:** every sale captured cleanly, online or offline.
**Evidence so far (local, no Docker — ADR 0011):** typecheck, lint, format, 104 unit tests, 725 DB tests on embedded Postgres (incl. `tests/db/pos-integrity.test.ts`, 31 tests). Still to run in CI: the real-Supabase DB suite, seed + manifest, `tests/e2e/pos.spec.ts`, the regenerated DATA-MODEL.md.
**Build**
- [x] Menu: categories, items, variants, modifiers, branch prices, availability (86), price history — `/[org]/menu`, `/[org]/branch`; price history by trigger; 86 never freezes a price (`has_price_override`)
- [x] POS: dine-in (tables), takeaway, delivery channels (own, foodpanda, Pathao Food, custom) + commission settings — `/[org]/settings` (commissions money-gated, ADR 0007)
- [x] Orders: order status separate from payment status; order_events timeline; price/cost snapshots on order_items — paying never closes a kitchen ticket; serving a paid order completes it
- [x] KDS: realtime, oldest-first, two-tap (preparing → ready), timers, station filter, dark mode — timers run from the latest round's send time; only sent lines show; voided lines are struck through; 30 s poll backs up Realtime
- [x] Payments: cash, card, bKash, Nagad, Rocket, Upay, bank; split payments — cash above the balance is change (`tendered_poisha`), never revenue
- [x] Discounts (reason codes); voids/refunds (reason + manager PIN after KOT); all audited — single-use 2-minute manager approvals ([ADR 0014](decisions/0014-single-use-manager-approvals.md)); order tables writable only through audited RPCs
- [x] Shifts: opening float, close with cash count, expected vs counted, over/short — non-managers need approval to close; closing waits for queued payments to sync
- [x] Receipt + KOT templates (58/80 mm); VAT/service-charge config; invoice numbering; Mushak-6.3-ready fields (TODO verify) — receipt header from `org_receipt_settings`; daily order numbers; offline provisional receipt numbers
- [x] Optional customer phone (+880) / name with consent checkbox — normalised, masked in audit
- [x] Offline: cached menu, IndexedDB outbox, idempotent sync, sync-status UI — `src/modules/pos/outbox.ts`; till snapshot in local storage; `public/sw.js` keeps `/pos` and `/kds` loadable offline. Voids/refunds/discounts/cancels stay online-only (they need a live approval)
- [ ] Optional QR table ordering (Thala patterns) — **deferred**: optional, and the placeholder page says it arrives after Pilot gate A
**Done when**
- [ ] E2E: order → KDS ready → split payment → receipt print preview — written as `tests/e2e/pos.spec.ts`; **passes only once CI runs it**
- [x] Void after KOT impossible without manager PIN; with PIN it's audited — `pos-integrity.test.ts` "manager approvals are single-use PIN proofs"
- [x] Offline test: 20 orders created with network off sync exactly once after reconnect — `src/modules/pos/outbox.test.ts` (queue, lost responses, retries) + `pos-integrity.test.ts` "offline replay is exactly-once" (the real RPCs, replayed twice)
- [x] Shift-close math matches payments; discrepancies flagged — `pos-integrity.test.ts` "payments, change and completion"; the close dialog flags any over/short
- [ ] All POS/KDS strings exist in bn and en; usable on a 10" Android tablet — strings: yes (`messages.test.ts`); **tablet: not yet checked on a real device**

## Phase 2 — Metrics layer, Health Monitor & zero-input leaks
Status: ◐ **built; local checks green, golden checks written for CI** (2026-09-28) · Size: 2–3 weeks
**Goal:** first "wow" — today's profit and leaks found from POS data alone.
**Evidence so far (local):** `tests/db/metrics.test.ts` (25 tests: exact sales/splits on hand-built fixtures, every velocity window at a frozen clock, money gating for manager/cashier, flash P&L arithmetic, detectors firing and staying quiet, idempotent upsert, audited workflow, day close). Decisions in [ADR 0015](decisions/0015-phase-2-metrics-and-detectors.md). **Needs CI:** `pnpm metrics:validate` against the seeded year.
**Build**
- [x] Metric functions: Sales, Item velocity, Channels, POS exceptions, Costs & P&L (METRICS.md) — `private.m_*` + `public.metric_*`, `src/modules/metrics/queries.ts`
- [ ] Summary tables / materialized views + refresh jobs — **deferred on purpose** (ADR 0015 §10): metrics read indexed base tables; the CI p95 check decides when a cache is needed
- [x] Setup screens: fixed costs, salaries (lite), channel commissions — `/[org]/costs`, commissions in `/[org]/settings`
- [x] Health Monitor: today view, flash P&L, break-even remaining, branch RAG — overview page; COGS from `assumed_food_cost_bps`, labelled as an assumption; break-even remaining leads (METRICS.md open question 5)
- [x] Item velocity explorer (last 2h / today / 7d / MTD / custom; branch, channel, daypart) — `/[org]/sales` (custom range is in the SQL; the page offers the named windows)
- [x] Findings engine + detectors: void/discount/refund anomalies, cash-share drift (daypart-normalised), cash over/short, commission drag — price overrides: **not applicable yet** (the till has no manual price override; server-side price mismatches are audited as `order.price_mismatch`)
- [x] "Where am I losing money?" v0: ranked findings with ৳, evidence rows, actions, status workflow — `/[org]/leaks`, `/[org]/leaks/[id]`
**Done when**
- [ ] Golden tests: metrics equal manifest values; every velocity window matches — `scripts/validate-metrics.ts`, **runs in CI**
- [ ] S1, S2 detected with ৳ within tolerance; S3's **commission drag** detected (full negative-margin detection waits for P3 recipe costs); S13 stays quiet — same script, **runs in CI** (by construction S1/S2 impact = the manifest's excess exactly)
- [x] False-positive check on the two confounded detectors: `cash.share` is normalised by daypart; `price.drift` is Phase 5 (no purchases yet)
- [ ] Dashboard p95 load < 2 s on the seeded year for 3 branches — timed in the same CI script
- [x] Every finding links to its evidence — `public.finding_events` + the evidence page

**→ Pilot gate A:** 1–2 friendly restaurants use P1–P2 for two weeks. Fix what they hit before P3.

## Phase 3 — Recipes, costing & Menu Profit Intelligence (+ LLM gateway v0)
Status: ◐ **built; local checks green; AI parts wait for an API key** (2026-09-29) · Size: 2–3 weeks
**Goal:** know what every plate costs and which items make or lose money.
**Evidence so far (local):** `tests/db/costing.test.ts` (13 tests), `tests/db/seed-costing.test.ts` (SQL and seed recipe costs agree exactly for every demo recipe), `src/lib/llm-gateway/core.test.ts` (5), seed unit tests for the new plants. Decisions in [ADR 0016](decisions/0016-phase-3-costing-and-llm-gateway.md). **Needs CI:** the seeded-year checks below.
**Build**
- [ ] **First: Anthropic API key with a spend limit** (blocks the whole phase), and **start the Meta / WhatsApp business verification now** — **needs the founder**; everything else was built behind the gateway's interface and tested with a mock transport
- [x] Ingredients, units & conversions, recipes/sub-recipes, yields; manual unit prices until P5 — `/[org]/recipes`; price history by day; sub-recipes and yields in `private.recipe_unit_cost` (unit conversions table exists; prices are entered per kg / litre / piece)
- [x] LLM gateway v0: server-only, models via env (confirm IDs against `GET /v1/models`), usage/cost logging per org, daily caps, PII masking, prompt versions, prompt caching — `src/lib/llm-gateway`; **model IDs and cache hits (`usage.cache_read_input_tokens`) can only be confirmed once a key exists**
- [x] AI recipe drafting from menu photo/list → draft → chef edits → approve — drafts tab; approval is an owner RPC. **Replaced by [ADR 0037](decisions/0037-dish-ingredients.md):** the page is now *Dish ingredients* (always in the sidebar); "Ask AI to fill this" drafts one dish at a time into the editor, and the owner's or manager's Save is the approval (`save_recipe` with the draft, audited); the menu-photo bulk drafting and the drafts tab are gone (`approve_recipe_draft` stays in SQL)
- [x] **ADR 0037 — Dish ingredients:** owner or manager writes one plate per dish (ingredient · amount · g / kg / ml / litre / piece; deg size optional); stock goes down when an order is **placed**, not when it is paid (`private.m_sold_for_stock`); Stock → **Used** tab and `metric_stock_used` (per ingredient and dish, plus dishes sold with nothing written); the assistant reads dishes (`get_recipe`) and what orders took (`get_stock_used`) — `tests/db/dish-ingredients.test.ts`, `src/modules/recipes/dish.test.ts`
- [x] Recipe-cost snapshots on sale; TFC and TFC%; recipe coverage indicator — `order_item_costs` (money-gated), `metric_food_cost`
- [x] Menu engineering matrix; margin alerts on cost change; price & portion simulator — `/[org]/menu-profit`; `margin.below_target` and `channel.negative_margin` findings
**Done when**
- [ ] S3, S4, S5 detected; matrix classes match manifest — `pnpm manifest:validate` (SEED_PHASE=3) + `pnpm metrics:validate`, **run in CI**
- [x] AI recipe drafts never become active without approval (test) — `costing.test.ts` "AI recipe drafts never become active without the owner's approval"
- [ ] ai_usage shows tokens and cost per org per day; caps enforced — enforced and logged in code and tested (`core.test.ts`, `costing.test.ts`); **no real call made yet (no key)**

## Phase 4 — AI Owner Assistant + WhatsApp rhythm
Status: ◐ **built; local checks green; LLM and WhatsApp parts wait on the key and Meta** (2026-09-30) · Size: 2–3 weeks
**Goal:** the owner asks in Bangla/Banglish/English and gets exact, cited answers; briefs arrive on WhatsApp.
**Evidence so far (local):** assistant unit tests (router, validator, language, gateway tool loop), messaging tests (outbox, backoff, transport, phones), `tests/db/assistant.test.ts`. Decisions in [ADR 0017](decisions/0017-phase-4-assistant-and-whatsapp.md).
**Build**
- [x] Metric tool catalog for the assistant (ARCHITECTURE.md) — `src/modules/assistant/tools.ts`, runs with the caller's permissions
- [x] Web chat UI; conversation storage; language detection — `/[org]/assistant`
- [x] Numeric-consistency validator + deterministic fallback templates — `validator.ts`, `answers.ts`, `router.ts`
- [x] Insight feed: rank, max 3/day, snooze/dismiss with reason — dashboard card, `refresh_insights`, `insight_action`
- [x] Morning brief, evening close, weekly review (deterministic numbers + LLM narrative; batch where possible) — `src/modules/briefs/jobs/briefs.ts`; narrative kept only if it passes the validator (no batching yet)
- [x] org_context: owner-stated goals/rules the assistant respects — assistant page sidebar
- [x] WhatsApp Cloud API behind an interface with a mock transport: opt-in, templates, outbox, webhooks, inbound Q&A — **approvals by reply wait for Phase 7 (nothing to approve yet)**
- [x] AI eval suite: ≥ 40 golden questions — `tests/ai-evals`, generated from the manifest, runs in CI
**Done when**
- [ ] Evals: ≥ 95% exact numeric answers; 0 answers with numbers absent from tool results — **runs in CI** (router path until the key exists)
- [ ] Brief delivered to a test WhatsApp number in bn and en — **needs Meta verification + templates**
- [x] Assistant says so clearly when data is missing — `notPermitted` / `notFound` / `noData` answers; prompt rule
- [ ] Per-org AI cost/day visible and under plan cap — cap enforced and logged; **an owner-facing usage view is not built yet**

**→ Pilot gate B:** pilots use the assistant + briefs. Measure input discipline before building P5–P6.

## Phase 5 — Purchasing, inventory & waste
Status: ◐ **built; local checks green; seed checks written for CI** (2026-10-01) · Size: 3 weeks
**Goal:** the minimum inputs that unlock real food-cost truth.
**Evidence so far (local):** `tests/db/inventory.test.ts` (18 tests: purchases and cost refresh, drafts never move stock, stock/cover/variance exact on hand-worked fixtures, transfers, waste explode and valuation, discipline, guided count), `tests/db/seed-inventory.test.ts` (the seed's stock ledger equals the SQL stock maths exactly for the last four weeks of both demo orgs), `src/modules/purchasing/lines.test.ts`, seed plant tests. Decisions in [ADR 0018](decisions/0018-phase-5-purchasing-inventory-waste.md). **Needs CI:** the full-year checks at `SEED_PHASE=5`.
**Build**
- [x] Suppliers, purchases (form), price history — `/[org]/purchases`; `record_purchase` refreshes the 14-day weighted-average unit cost (ADR 0018 §4)
- [x] Photo of chit/receipt → AI draft lines → confirm; voice note → draft → confirm; low-confidence fields highlighted — voice is browser dictation (ADR 0018 §6); **AI parts wait for the API key**
- [x] Guided weekly count of top 10–15 costly items (mobile-first); optional full count — `/[org]/stock/count/[id]`, blind
- [x] Waste log (KDS button + mobile), reasons, leaderboard — KDS "Waste" button, Stock → Waste
- [x] Transfers (branch↔branch, central kitchen → branch) with send/receive confirmation — a short receipt is "disputed"
- [x] Theoretical stock, days of cover 🟢🟡🔴, stock status page — `/[org]/stock`
- [x] Branch discipline score (daily) + nudges — dashboard "Today's habits", morning WhatsApp brief
**Done when**
- [x] AI purchase drafts can't affect stock until confirmed (test) — `inventory.test.ts` "AI purchase drafts never move stock until a person confirms them"
- [ ] S6 visible as phantom variance / unconfirmed transfer — Dhanmondi chicken +35.8 kg, Mirpur −29.2 kg over four weeks; proven on the last four seeded weeks locally (`seed-inventory.test.ts`), **full seed in CI** (`manifest:validate`, `metrics:validate` at SEED_PHASE=5)
- [ ] Days of cover and discipline scores match manifest — same two checks; **CI**
## Phase 6 — Leak Detector v2 (full "Where am I losing money?")
Status: ◐ **built; local checks green; full-seed checks written for CI** (2026-10-02) · Size: 2 weeks
**Goal:** explain the food-cost gap in BDT, by cause, branch and item.
**Evidence so far (local):** `tests/db/leaks-v2.test.ts` (9 hand-worked tests: bridge identity, unexplained usage vs peers, mirrored transfer, price drift vs market-wide rise, reference prices, unconfirmed transfer, flash P&L on recipes); `tests/db/seed-inventory.test.ts` runs the detectors on the last 8 seeded weeks and recovers S6–S9 within ±10% with the café quiet. Decisions in [ADR 0019](decisions/0019-phase-6-leak-detector-v2.md). **Needs CI:** `metrics:validate` at SEED_PHASE=6.
**Build**
- [x] Actual COGS between counts; ingredient usage variance — `metric_variance_bridge`, `metric_stock_variance`
- [x] Variance bridge: logged waste, price effect, unexplained usage, count-uncertainty band — an exact identity (ADR 0019 §1); Stock → Counts & gaps
- [x] Over-portioning suspects by item × branch; theft-pattern hints cross-checked with POS exceptions — evidence on `usage.unexplained` (dishes, voided-dish usage, POS findings)
- [x] Purchase Price Watch: own history, cross-branch same day, reference_prices CSV import — `price.drift`, Purchases → Suppliers → Market prices
- [x] Findings ranked by ৳ × confidence; "explain this" via assistant; resolution tracking — `explain_finding` tool + deterministic answer; Resolved tab, "came back" badges
**Done when**
- [ ] S7, S8, S9 detected and ranked with ৳ within ±10% — met on the last 8 seeded weeks locally; **full seed in CI**
- [ ] Clean-org false positives within tolerance — café quiet locally; **CI**
- [x] Finding → evidence → action in ≤ 3 clicks — dashboard insight → evidence page → action buttons on the same page

## Phase 7 — Forecasting & Bazar List Assistant
Status: ◐ **built; local checks green; full-seed checks written for CI** (2026-10-03) · Size: 2–3 weeks
**Goal:** cook and buy the right amount for tomorrow.
**Evidence so far (local):** `tests/db/forecast.test.ts` (8 hand-worked tests: weighted weekday forecast, flagged and closed days, WAPE vs naive and the shown flag, prep plan in degs, bazar draft → approve with tuning → send via outbox → reconcile, manager day flags); `tests/db/seed-forecast.test.ts` (opt-in, XEDINE_SLOW=1) on the seeded Ramadan and Eid. Decisions in [ADR 0020](decisions/0020-phase-7-forecast-and-bazar-list.md). **Needs CI:** `metrics:validate` at SEED_PHASE=7.
**Build**
- [x] BD calendar management (Ramadan, Eid, holidays, salary week, weekend; manual flags: rain, hartal, cricket) — `/[org]/calendar` (owner), `flag_day` for managers on `/[org]/plan`; weekends are the weekday pattern itself
- [x] Forecast v1 per item × daypart × branch; WAPE vs naive tracking; hide when not better — `metric_forecast`, `metric_forecast_accuracy`
- [x] Prep plan in cooking units (pots/deg, kg marinated) — `metric_prep_plan`
- [x] Bazar list draft = forecast usage − theoretical stock + safety stock, rounded to purchase units, grouped by supplier — `generate_bazar_list`
- [x] Approve → WhatsApp to purchaser/supplier; learn from edits (safety-stock tuning) — `approve_bazar_list` + `bazar_tuning`, `send_bazar_list` via the outbox; **real sends wait for Meta template approval**
**Done when**
- [ ] S10 patterns reflected; forecast beats naive by ≥ 10% on seeded data or the UI hides it — Eid closures forecast 0, iftar share and Ramadan WAPE checked locally on Jan–Mar; the hide rule is enforced in SQL; **full seed in CI**
- [x] Bazar list approve → send → purchase-entry reconciliation works end to end — `forecast.test.ts`

## Phase 8 — Customers, retention & reviews
Status: ◐ **built; local checks green; full-seed checks written for CI** (2026-10-04) · Size: 3 weeks
**Goal:** win the second visit and turn complaints into fixes.
**Evidence so far (local):** `tests/db/customers.test.ts` (12 hand-worked tests: segments and RFM, consent and opt-out, caps, holdout, lift sample rule, feedback token once-only, themes, reply approval, slow-slot and lapse detectors); `tests/db/seed-inventory.test.ts` finds S11 on the seed; `tests/db/seed-lapse.test.ts` (opt-in, XEDINE_SLOW=1) matches S12 exactly. Decisions in [ADR 0021](decisions/0021-phase-8-customers-retention-reviews.md). **Needs CI:** `metrics:validate` at SEED_PHASE=8.
**Build**
- [x] Customer profiles, consent, visit history, RFM segments, at-risk list — `/[org]/customers`, `metric_customers`, `metric_customer_summary`
- [x] Post-meal feedback link (0–10 + comment) via WhatsApp, linked to order and items — `job_feedback_requests`, `/f/[token]`, `submit_feedback`; **real sends wait for Meta template approval**
- [x] Automations: first-visit thank-you + second-visit nudge (48 h), win-back, frequency caps, opt-out keywords, holdout groups — `run_campaign`, `auto_run`, `record_opt_out`
- [x] Campaign builder (bn/en messages); results with lift vs holdout — `/[org]/campaigns`, `metric_campaign_results`
- [~] Reviews: paste-in for Facebook/foodpanda/Google, themes, AI reply drafts (approve) — `/[org]/reviews`; **Google Business Profile import waits for API access (ADR 0010)**
- [x] Reviews ↔ operations links (ticket times, staffing, items) — `metric_review_context`; service-speed grid on `/[org]/customers`
**Done when**
- [x] Sends respect consent, caps and opt-outs (tests) — `customers.test.ts`
- [ ] S11 and S12 surface as insights with evidence — both found locally on the seed (S11 exact slot, S12 exact impact); **full seed in CI**
- [x] Lift reported only with adequate sample sizes — ≥ 30 per group, enforced in SQL

## Phase 9 — Branch Intelligence & Industry Benchmarking
Status: ◐ **built; local checks green; full-seed check written for CI** (2026-10-05) · Size: 2 weeks
**Goal:** chains see gaps between branches; everyone sees how they compare to peers.
**Evidence so far (local):** `tests/db/branches.test.ts` (11 hand-worked tests); the seeded Kacchi House chain's gap to its best branch is computed and its unexplained-usage part recomputed independently from the variance bridge (`seed-inventory.test.ts`: Mirpur ≈ ৳29,900, Uttara ≈ ৳29,400, Dhanmondi ≈ ৳2,200 over the 4-week count period). Decisions in [ADR 0022](decisions/0022-phase-9-branches-and-benchmarks.md). **Needs CI:** `metrics:validate` at SEED_PHASE=9.
**Build**
- [x] Branch league table, like-for-like comparisons, manager scorecards, "gap to best branch" in ৳ — `/[org]/branches`, `metric_branch_league`, `metric_branch_gaps`, `metric_like_for_like`, `metric_branch_scorecard`
- [x] Transfer audit view — `metric_transfer_audit`
- [x] Benchmarking: opt-in, segments, percentile snapshots (k ≥ 5), labelled "industry reference" seeds, benchmark page + assistant tool — `/[org]/benchmarks`, `job_benchmark_snapshot`, `metric_benchmarks`, `get_benchmarks`
  - **Reality check (decided, ADR 0022 §4):** two dimensions (cuisine × branch band) plus "all"; a cell is published only with ≥ 5 restaurants and a complement of 0 or ≥ 5 in every parent cell
  - Food cost % is pooled only with recipe coverage ≥ 90%
**Done when**
- [x] Tests prove no benchmark output can reveal a single tenant (k ≥ 5 enforced in SQL) — `branches.test.ts`
- [x] Branch gaps for the seeded chain computed in ৳ — locally on the seed; **CI re-checks on the full seed**
- [x] Manager scorecards ship in a money-free variant, or are owner-only (ADR 0007) — money-free, branch-private

## Phase 10 — Compliance, staff-lite, growth, billing & launch hardening
Status: ◐ **built; local checks green; phase-reviewer pass done, findings fixed** (2026-10-08) · Size: 3–4 weeks
**Goal:** ready for paying customers.
**Evidence so far (local):** `tests/db/compliance.test.ts` (8), `tests/db/onboarding.test.ts` (3), `tests/db/billing.test.ts` (3), `tests/db/growth.test.ts` (4) — hand-worked; no test-oracle scenario exists for this phase. Decisions in [ADR 0023](decisions/0023-phase-10-compliance-staff-onboarding-billing.md); the security pass is a living checklist in [SECURITY.md](../docs/SECURITY.md).
**Build**
- [x] Licence tracker + reminders (60/30/7 days); VAT deadline reminders; sales-VAT summary export (TODO verify with an accountant) — `/[org]/compliance`, `metric_compliance`, `job_compliance_reminders`, `/api/export/[vat|orders]`
- [x] Staff-lite: advances ledger, basic attendance, sales per staff — `/[org]/staff/records`
- [x] Growth module (optional): data-grounded content ideas, hooks, shot list, captions bn/en, posting calendar — `/[org]/growth`; no auto-posting (PRODUCT.md M17)
- [x] Onboarding wizard: menu import from photo/CSV, recipe drafts (Phase 3), fixed costs, channels — `/[org]/setup`, `metric_setup_progress` (12 steps, computed from real data); **timed < 2 h test not yet run**
- [x] Plans, usage caps, subscription billing (provider TBD), admin console, data export — `metric_billing`, `org_ai_allowed`/`org_whatsapp_allowed` enforced in the gateways, `/admin` (platform admins only), `/api/export/[kind]`
- [~] Security review (RLS audit, secrets, rate limits, headers), backups, monitoring, performance pass — see [SECURITY.md](../docs/SECURITY.md): RLS/isolation/search_path automated and green; headers added; **rate limiting, backups and monitoring are deliberately deferred to launch prep, not faked**
**Done when**
- [x] Security checklist passes; phase-reviewer reports no Critical issues — automated checks green; phase-reviewer ran, found 0 Critical / 3 Important (all fixed, see ADR 0023 consequences); rate-limit/backup/monitoring gaps remain named, not closed (deliberate, launch-prep decisions)
- [ ] A new restaurant onboards in < 2 h in a timed test — the checklist and menu import exist; the timed test itself has not been run
- [x] Plan limits enforced; reminders fire on schedule — enforced in the LLM gateway and the messaging outbox; reminders computed per threshold and queued once each

## Later (unscheduled)
Per-task agent mode (after trust) · lender-partner report · delivery-platform integrations · EFD/SDC integration · local print bridge · native apps · ML forecasting service.
