# ADR 0022 — Phase 9 branch intelligence and benchmarking

- Date: 2026-10-05
- Status: accepted (built unattended — **§4, §5 and §6 are choices the founder should confirm**)

## Context
Phase 9 must let chains see the gaps between branches (league table, like-for-like, manager scorecards, "gap to best branch" in ৳, transfer audit) and let every restaurant compare itself with peers without ever exposing a single tenant (k ≥ 5 in SQL). The ROADMAP's reality check warns that five segment dimensions leave every cell empty at 10–30 customers, and that food cost % is not comparable without a recipe-coverage floor.

## Decision
1. **The league is a view over existing metric functions** (`m_sales`, `m_food_cost`, `m_ticket_times`, `m_discipline`, `m_waste_board`, `m_variance_bridge`, `m_daily_overheads`, `m_customer_summary`, feedback and reviews) — no new formulas. Cost columns (food cost %, labour %, waste %, unexplained usage %, the gap) come back empty for roles that may not see money (ADR 0007).
2. **Gap to the best branch, in ৳, is exact.** For waste, labour, discounts, voids after the kitchen ticket and unexplained stock usage (all "lower is better"): gap = this branch's amount − the best branch's rate × this branch's own base (sales, or gross sales for discounts and voids; the variance bridge's sales for unexplained usage). Needs two branches with the figure. Food cost % is left out: it follows the menu mix, not the branch's discipline — the like-for-like view compares the same items instead (units per trading day, average price realised).
3. **Manager scorecards are money-free and branch-private.** Sales per day, orders per day, average order, serving time, rating, first-return rate, discipline score, discount and void rates — each with this branch's rank among all branches. Other branches' values are never returned, only the rank.
4. **Benchmark cells use two dimensions: cuisine and branch band (1 / 2–5 / 6+)**, plus "all restaurants", and their combination. A cell is published only if it has ≥ 5 restaurants **and** every parent cell minus it is either empty or ≥ 5 restaurants, so no two published cells can be differenced down to fewer than five. The `benchmark_snapshots` CHECK (k ≥ 5 unless labelled reference) stays as the last line. *Confirm the two dimensions; revisit city/area and AOV band when there are enough customers.*
5. **Opt-in is "give to get".** Only opted-in orgs are pooled, and only they see peer cells; everyone sees labelled reference ranges. Pooled orgs need ≥ 30 trading days in the 90 days to the month's end; demo orgs are never pooled. Metrics: food cost % (only with recipe coverage ≥ 90%, METRICS.md open question 3), labour % of sales, sales per branch per day, average order, rating (≥ 20 ratings), first-timers back within 30 days (≥ 30 first-timers), delivery share. `waste.pct` and cogs % wait for METRICS.md open question 2 and for counts. *Confirm opt-in semantics.*
6. **Reference ranges live in the seed, not a migration.** They are illustrative, labelled "not survey data", and exist only in demo databases until real Bangladesh ranges are sourced (`TODO(verify)` in `scripts/seed/config.ts`). Production shows "no comparison yet" until five peers or verified references exist. *Confirm, and supply a source for real ranges.*
7. **Monthly job.** `benchmarks` runs at 04:00 Dhaka on the 2nd (`job_benchmark_snapshot`, service role), replacing the previous month's peer rows; `metric_benchmarks` compares the org's last full month with the most specific published cell (cuisine + band → cuisine → band → all), else the reference.
8. **Transfer audit** lists transfers touching the caller's branches for 90 days: lines, short lines (received > 2% below sent), days to receive, open and disputed first; values are money-gated. Unrecorded transfers remain a detector (`transfer.suspected`, ADR 0019).

## Alternatives considered
- **Full five-dimension segmentation** — empty cells for the foreseeable future.
- **k-anonymity only per cell** — overlapping cells could be differenced; the complement rule closes that.
- **Reference ranges in a migration** — would ship unverified numbers to production.

## Consequences
- Tests: `tests/db/branches.test.ts` (hand-worked league, exact ৳ gaps, manager isolation, scorecard ranks, like-for-like, transfer audit; k < 5 publishes nothing, the complement rule withholds a 5-of-6 cell, the table refuses k = 4, opted-in vs outsider views). The seeded chain's unexplained-usage gap is recomputed independently from the variance bridge in `seed-inventory.test.ts` and in CI (`validate-metrics` at SEED_PHASE=9).
- Assistant tools: `compare_branches`, `get_benchmarks`, `get_customers_summary`, `get_reviews_summary`.
