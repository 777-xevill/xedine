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
Status: ◐ built and verified locally · **awaiting the first CI run against real Supabase** · Size: 1–2 weeks
**Goal:** secure multi-tenant skeleton, test harness, demo data.
**Evidence so far (2026-09-22):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm unit` (95 tests) pass; `pnpm db:test:embedded` (662 DB tests, every table's RLS isolation) passes on an in-process Postgres — an emulation, see ADR 0011. **Not yet run:** real-Supabase CI (`database` and `e2e` jobs), the full-year seed + manifest validation, and the Playwright journey.
**Build**
Decisions already settled: ADRs 0001–0012. Read them before planning.
- [x] Verify latest stable versions; scaffold Next.js (App Router, TS strict), Tailwind, ESLint/Prettier, Vitest, Playwright, pnpm; ADR 0001-stack (three "latest" releases rejected and why). Component primitives are hand-written on the brand tokens, not the shadcn CLI
- [x] `git init` at repo root + private GitHub remote (`777-xevill/xedine`, ADR 0002); `.gitignore` excludes `files (4)*`
- [ ] Supabase local (CLI + Docker) and a free dev cloud project — **CLI project configured (`supabase/config.toml`); Docker could not be installed on this machine (ADR 0011) and no cloud project has been created yet (needs the founder's Supabase account)**. `.env.example` done; generated types via `pnpm db:types` once a database is reachable
- [x] Auth: email + password; manager invite creates user + membership atomically (ADR 0003); device registration, pairing codes and staff PIN sessions with lockout — **database and RPCs only; the POS PIN screen and the device's own credential are Phase 1** (ADR 0012 §7)
- [x] Tenancy: organizations, branches, memberships, roles, org_settings (incl. `price_includes_vat`, VAT rate, cutoff, dayparts, week start), org_profile; RLS helpers incl. `can_see_money` (ADR 0007); org/branch switcher
- [x] Full core schema migrated per ARCHITECTURE.md's entity list (93 tables), so RLS + isolation tests are written once (ADR 0006)
- [x] Money helper: VAT decomposition + poisha rounding, one shared function (ADR 0005)
- [x] Injected clock module; lint rule banning `new Date()` / `Date.now()` in business logic (ADR 0006) — proven to fire by a deliberate violation
- [x] audit_log + helper; job_runs; `pg_cron` bootstrap + an alert on missing runs (`job_health()`, ADR 0004)
- [x] i18n bn/en; formatters: BDT (poisha), lakh grouping, Bangla digits, Asia/Dhaka, business_date(cutoff)
- [x] App shell with route groups (dashboard, pos, kds, qr, admin) on the BRAND.md colour tokens, dark theme, system font stack (ADR 0009)
- [x] Synthetic data generator + manifest with `anchor_date` and per-scenario `available_from_phase`; one command for db reset + seed (`pnpm db:reset:seed`)
- [ ] CI: typecheck, lint, unit, DB tests — **workflow written, not yet run**: it needs the `workflow` scope on the GitHub token to be pushed
- [x] Fill "Commands" in CLAUDE.md; docs/DATA-MODEL.md is generated from the live schema (`pnpm db:docs`)
**Done when**
- [ ] Owner signs up, creates an org with branches, invites a manager limited to one branch — *Playwright journey written (`tests/e2e/onboarding.spec.ts`); not yet run*
- [ ] RLS suite proves org A users can't read/write any org B row (**every table, with fixture rows inserted as org A**) — *525 isolation tests over 93 tables pass on embedded Postgres; real-Supabase run pending*
- [ ] A branch manager cannot read any cost, margin or profit value, proven at the SQL layer — *`tests/db/money-visibility.test.ts` passes on embedded Postgres; real-Supabase run pending*
- [ ] Seed runs from scratch in one command; **manifest validates for phase-0 scenarios (S1, S2, S3-commission, S13)** — *generator + manifest verified (unit); loader and validator verified on a 10-day slice; the full 105k-order year needs real Postgres (CI)*
- [ ] bn/en switch works; formatters unit-tested (1,23,45,678; business_date around 00:00 and 04:00) — *formatters and message-parity unit-tested ✓; the live switch is covered by the Playwright journey, not yet run*
- [x] VAT decomposition tested both ways: a receipt's lines sum to its total under `price_includes_vat` true and false — `src/lib/money/money.test.ts`
- [ ] CI green

**Open questions from the kit — settled in [ADR 0012](decisions/0012-phase-0-design-decisions.md):** invoice numbering (server-assigned; offline receipts carry a provisional number) · `business_date` (stored, set at insert). **Still open, deliberately:** PII retention window and deletion flow (needs legal review; Phase 8) · device credential (Phase 1).

## Phase 1 — POS, KDS, orders & cash
Status: ☐ · Size: 3–4 weeks
**Goal:** every sale captured cleanly, online or offline.
**Build**
- [ ] Menu: categories, items, variants, modifiers, branch prices, availability (86), price history
- [ ] POS: dine-in (tables), takeaway, delivery channels (own, foodpanda, Pathao Food, custom) + commission settings
- [ ] Orders: order status separate from payment status; order_events timeline; price/cost snapshots on order_items
- [ ] KDS: realtime, oldest-first, two-tap (preparing → ready), timers, station filter, dark mode
- [ ] Payments: cash, card, bKash, Nagad, Rocket, Upay, bank; split payments
- [ ] Discounts (reason codes); voids/refunds (reason + manager PIN after KOT); all audited
- [ ] Shifts: opening float, close with cash count, expected vs counted, over/short
- [ ] Receipt + KOT templates (58/80 mm); VAT/service-charge config; invoice numbering; Mushak-6.3-ready fields (TODO verify)
- [ ] Optional customer phone (+880) / name with consent checkbox
- [ ] Offline: cached menu, IndexedDB outbox, idempotent sync, sync-status UI
- [ ] Optional QR table ordering (Thala patterns)
**Done when**
- [ ] E2E: order → KDS ready → split payment → receipt print preview
- [ ] Void after KOT impossible without manager PIN; with PIN it's audited
- [ ] Offline test: 20 orders created with network off sync exactly once after reconnect
- [ ] Shift-close math matches payments; discrepancies flagged
- [ ] All POS/KDS strings exist in bn and en; usable on a 10" Android tablet

## Phase 2 — Metrics layer, Health Monitor & zero-input leaks
Status: ☐ · Size: 2–3 weeks
**Goal:** first "wow" — today's profit and leaks found from POS data alone.
**Build**
- [ ] Metric functions: Sales, Item velocity, Channels, POS exceptions, Costs & P&L (METRICS.md)
- [ ] Summary tables / materialized views + refresh jobs
- [ ] Setup screens: fixed costs, salaries (lite), channel commissions
- [ ] Health Monitor: today view, flash P&L, break-even remaining, branch RAG. **Until recipes exist (P3), COGS comes from an owner-entered `assumed_food_cost_pct` in org_settings, labelled in the UI as an assumption with its own metric ID — never a silently invented figure** (non-negotiable #1). The label disappears once recipe coverage is sufficient
- [ ] Item velocity explorer (last 2h / today / 7d / MTD / custom; branch, channel, daypart)
- [ ] Findings engine + detectors: void/discount/refund anomalies, price overrides, cash-share drift, cash over/short, commission drag
- [ ] "Where am I losing money?" v0: ranked findings with ৳, evidence rows, actions, status workflow
**Done when**
- [ ] Golden tests: metrics equal manifest values; every velocity window matches
- [ ] S1, S2 detected with ৳ within tolerance; S3's **commission drag** detected (full negative-margin detection waits for P3 recipe costs); S13 stays quiet
- [ ] False-positive check on the two confounded detectors: `cash.share` is normalised by daypart (a late-shift cashier legitimately takes more cash) and `price.drift` accounts for a rising bazar trend — otherwise both fire constantly and blow the ≤1-per-branch-week tolerance
- [ ] Dashboard p95 load < 2 s on the seeded year for 3 branches
- [ ] Every finding links to its evidence

**→ Pilot gate A:** 1–2 friendly restaurants use P1–P2 for two weeks. Fix what they hit before P3.

## Phase 3 — Recipes, costing & Menu Profit Intelligence (+ LLM gateway v0)
Status: ☐ · Size: 2–3 weeks
**Goal:** know what every plate costs and which items make or lose money.
**Build**
- [ ] **First: Anthropic API key with a spend limit** (blocks the whole phase), and **start the Meta / WhatsApp business verification now** — one phase of overlap removes most of the Phase 4 stall risk (ADR 0010)
- [ ] Ingredients, units & conversions, recipes/sub-recipes, yields; manual unit prices until P5
- [ ] LLM gateway v0: server-only, models via env (confirm IDs against `GET /v1/models`), usage/cost logging per org, daily caps, PII masking, prompt versions, prompt caching — verify caching works via `usage.cache_read_input_tokens`, not by assumption
- [ ] AI recipe drafting from menu photo/list → draft → chef edits → approve
- [ ] Recipe-cost snapshots on sale; TFC and TFC%; recipe coverage indicator
- [ ] Menu engineering matrix; margin alerts on cost change; price & portion simulator
**Done when**
- [ ] S3, S4, S5 detected; matrix classes match manifest
- [ ] AI recipe drafts never become active without approval (test)
- [ ] ai_usage shows tokens and cost per org per day; caps enforced

## Phase 4 — AI Owner Assistant + WhatsApp rhythm
Status: ☐ · Size: 2–3 weeks
**Goal:** the owner asks in Bangla/Banglish/English and gets exact, cited answers; briefs arrive on WhatsApp.
**Build**
- [ ] Metric tool catalog for the assistant (ARCHITECTURE.md)
- [ ] Web chat UI; conversation storage; language detection
- [ ] Numeric-consistency validator + deterministic fallback templates
- [ ] Insight feed: rank, max 3/day, snooze/dismiss with reason — challenges the owner with evidence
- [ ] Morning brief, evening close, weekly review (deterministic numbers + LLM narrative; batch where possible)
- [ ] org_context: owner-stated goals/rules the assistant respects
- [ ] WhatsApp Cloud API: opt-in, templates, outbox, webhooks, inbound Q&A, approvals by reply. **Build behind an interface with a mock transport** so briefs, outbox, retries and delivery status are all testable and demoable before Meta approves anything — only the final hop waits on verification (ADR 0010)
- [ ] AI eval suite: ≥ 40 golden questions incl. "how many kebabs sold in the last 2 hours / today / last week / this month"
**Done when**
- [ ] Evals: ≥ 95% exact numeric answers; 0 answers with numbers absent from tool results
- [ ] Brief delivered to a test WhatsApp number in bn and en
- [ ] Assistant says so clearly when data is missing
- [ ] Per-org AI cost/day visible and under plan cap

**→ Pilot gate B:** pilots use the assistant + briefs. Measure input discipline before building P5–P6.

## Phase 5 — Purchasing, inventory & waste
Status: ☐ · Size: 3 weeks
**Goal:** the minimum inputs that unlock real food-cost truth.
**Build**
- [ ] Suppliers, purchases (form), price history
- [ ] Photo of chit/receipt → AI draft lines → confirm; voice note → draft → confirm; low-confidence fields highlighted
- [ ] Guided weekly count of top 10–15 costly items (mobile-first); optional full count
- [ ] Waste log (KDS button + mobile), reasons, leaderboard
- [ ] Transfers (branch↔branch, central kitchen → branch) with send/receive confirmation
- [ ] Theoretical stock, days of cover 🟢🟡🔴, stock status page
- [ ] Branch discipline score (daily) + nudges
**Done when**
- [ ] AI purchase drafts can't affect stock until confirmed (test)
- [ ] S6 visible as phantom variance / unconfirmed transfer
- [ ] Days of cover and discipline scores match manifest

## Phase 6 — Leak Detector v2 (full "Where am I losing money?")
Status: ☐ · Size: 2 weeks
**Goal:** explain the food-cost gap in taka, by cause, branch and item.
**Build**
- [ ] Actual COGS between counts; ingredient usage variance
- [ ] Variance bridge: logged waste, price effect, unexplained usage, count-uncertainty band
- [ ] Over-portioning suspects by item × branch; theft-pattern hints cross-checked with POS exceptions
- [ ] Purchase Price Watch: own history, cross-branch same day, reference_prices CSV import
- [ ] Findings ranked by ৳ × confidence; "explain this" via assistant; resolution tracking
**Done when**
- [ ] S7, S8, S9 detected and ranked with ৳ within ±10%
- [ ] Clean-org false positives within tolerance
- [ ] Finding → evidence → action in ≤ 3 clicks

## Phase 7 — Forecasting & Bazar List Assistant
Status: ☐ · Size: 2–3 weeks
**Goal:** cook and buy the right amount for tomorrow.
**Build**
- [ ] BD calendar management (Ramadan, Eid, holidays, salary week, weekend; manual flags: rain, hartal, cricket)
- [ ] Forecast v1 per item × daypart × branch; WAPE vs naive tracking; hide when not better
- [ ] Prep plan in cooking units (pots/deg, kg marinated)
- [ ] Bazar list draft = forecast usage − theoretical stock + safety stock, rounded to purchase units, grouped by supplier
- [ ] Approve → WhatsApp to purchaser/supplier; learn from edits (safety-stock tuning)
**Done when**
- [ ] S10 patterns reflected; forecast beats naive by ≥ 10% on seeded data or the UI hides it
- [ ] Bazar list approve → send → purchase-entry reconciliation works end to end

## Phase 8 — Customers, retention & reviews
Status: ☐ · Size: 3 weeks
**Goal:** win the second visit and turn complaints into fixes.
**Build**
- [ ] Customer profiles, consent, visit history, RFM segments, at-risk list
- [ ] Post-meal feedback link (0–10 + comment) via WhatsApp/SMS, linked to order and items
- [ ] Automations: first-visit thank-you + second-visit nudge (48 h), win-back, frequency caps, opt-out keywords, holdout groups
- [ ] Campaign builder (bn/en templates); results with lift vs holdout
- [ ] Reviews: Google Business Profile import (once access is approved), paste-in for Facebook/foodpanda, themes, AI reply drafts (approve)
- [ ] Reviews ↔ operations links (ticket times, staffing, items)
**Done when**
- [ ] Sends respect consent, caps and opt-outs (tests)
- [ ] S11 and S12 surface as insights with evidence
- [ ] Lift reported only with adequate sample sizes

## Phase 9 — Branch Intelligence & Industry Benchmarking
Status: ☐ · Size: 2 weeks
**Goal:** chains see gaps between branches; everyone sees how they compare to peers.
**Build**
- [ ] Branch league table, like-for-like comparisons, manager scorecards, "gap to best branch" in ৳
- [ ] Transfer audit view
- [ ] Benchmarking: opt-in, segments, percentile snapshots (k ≥ 5), labelled "industry reference" seeds, benchmark page + assistant tool
  - **Reality check before building:** the specified segmentation (cuisine × format × branch band × city/area × AOV band) with k ≥ 5 will leave essentially every cell empty at 10–30 customers, so only the seeded reference ranges would ever show. Either collapse to 2 dimensions (cuisine × branch band) or defer peer benchmarking and ship reference ranges only. Decide with the real customer count in hand
  - Comparing `food_cost.theoretical_pct` across orgs needs a **recipe-coverage floor** (e.g. ≥ 90%) or the metric isn't comparable
**Done when**
- [ ] Tests prove no benchmark output can reveal a single tenant (k ≥ 5 enforced in SQL)
- [ ] Branch gaps for the seeded chain computed in ৳
- [ ] Manager scorecards ship in a money-free variant, or are owner-only (ADR 0007)

## Phase 10 — Compliance, staff-lite, growth, billing & launch hardening
Status: ☐ · Size: 3–4 weeks
**Goal:** ready for paying customers.
**Build**
- [ ] Licence tracker + reminders (60/30/7 days); VAT deadline reminders; sales-VAT summary export (TODO verify with an accountant)
- [ ] Staff-lite: advances ledger, basic attendance, sales per staff
- [ ] Growth module (optional): data-grounded content ideas, hooks, shot list, captions bn/en, posting calendar
- [ ] Onboarding wizard: menu import from photo/CSV, recipe drafts, fixed costs, channels — target < 2 h
- [ ] Plans, usage caps, subscription billing (provider TBD), admin console, data export
- [ ] Security review (RLS audit, secrets, rate limits, headers), backups, monitoring, performance pass
**Done when**
- [ ] Security checklist passes; phase-reviewer reports no Critical issues
- [ ] A new restaurant onboards in < 2 h in a timed test
- [ ] Plan limits enforced; reminders fire on schedule

## Later (unscheduled)
Per-task agent mode (after trust) · lender-partner report · delivery-platform integrations · EFD/SDC integration · local print bridge · native apps · ML forecasting service.
