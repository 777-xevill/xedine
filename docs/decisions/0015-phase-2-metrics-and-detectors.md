# ADR 0015 — Phase 2 metrics layer and zero-input leak detectors

- Date: 2026-09-28
- Status: accepted (built unattended overnight — **§1, §2 and §5 are definitions the founder should confirm**; each is one line to change)

## Context
Phase 2 needs every METRICS.md figure it uses to have exactly one implementation, access rules that hold in SQL (ADR 0007), and detectors that recover S1, S2 and S3's commission drag from the seed while staying quiet on the clean café (S13). METRICS.md leaves a few definitions open; they had to be settled to write any code.

## Decision
**Metrics and detectors are SQL functions in `20260928000001_metrics_and_leaks.sql`: one `private.m_*` implementation per metric, and thin `public.metric_*` wrappers that only decide who may ask.** Sales figures need branch access (`private.metric_scope`); cost, commission, profit, per-staff exception values and findings need `can_see_money` (`private.require_money`). The clock is a parameter everywhere. `src/modules/metrics/queries.ts` wraps them for pages, tagging each answer with `metric_id`, filters and `as_of`.

Definitions settled here:
1. **Refunds in `sales.net`** — a refund reduces sales.net by its VAT-exclusive share of the refunded order (`amount × order.net ÷ order.total`), on the refund's business date. Subtracting the cash amount would mix a VAT-inclusive figure into a VAT-exclusive one. *Confirm.*
2. **`sales.by_payment_method`** — a split-tender order's net is shared across its methods in proportion to what each paid, rounded per payment. The split can differ from the order's net by a poisha. *Confirm.*
3. **Org-level fixed costs** (no branch) count in the org total only, not in any branch's P&L. Allocating them across branches is a Phase 9 question.
4. **Branch red/amber/green** — today's completed net so far against the average of the same weekday in the last four weeks, up to the same time of day (≥95% green, ≥80% amber, else red). Sales-only, so managers see it too.
5. **Detector baseline** — a staff member is compared with their peers at the same branch over the same period (value per order), which is exactly how the seed manifest defines S1/S2's "excess". METRICS.md says "trailing-28-day baseline"; for a single cashier branch that would be the only option, and it is not built yet. Flags need all of: ≥ 2× peers' value per order, Poisson z ≥ 3 on the count (a floor of half an event when peers had none), ≥ 5 events, ≥ ৳500 excess. Thresholds live in `private.detector_defaults()` with per-org overrides in `org_settings.detector_config`. *Confirm the baseline.*
6. **`cash.share`** is normalised by daypart (METRICS.md open question 7): expected cash orders = Σ over dayparts of the cashier's orders × the branch's cash share in that daypart. `price.drift` waits for purchases (Phase 5).
7. **Commission drag is a structural cost, not an anomaly.** Reported monthly per branch and channel when the platform costs ≥ 15% of its sales; excluded from the clean-org false-positive count, which is about anomalies.
8. **Cadence** — the nightly `close_business_day` job (per org, per its cutoff) completes paid orders still in a kitchen state (otherwise a branch that never taps "served" reports no sales), runs the anomaly detectors on the last day of the org's week and commission drag on the last day of the month. Owners can also scan the last four complete weeks on demand (`scan_findings`). Re-running is an upsert on (org, type, branch, subject, period) that never resets the owner's status or note.
9. **Mid-day flash P&L** (METRICS.md open question 5) — the Health Monitor leads with `breakeven.remaining_today`; estimated profit is secondary and always labelled with the assumed food cost %.
10. **No summary tables yet.** Metrics read `orders`/`order_items` with (org, branch, business_date) indexes. The CI golden check times the Health Monitor on the seeded year and fails above p95 2 s; summary tables come in when that check says so. `refresh_today` therefore has nothing to do yet.

## Alternatives considered
- **Detectors in TypeScript** (ARCHITECTURE.md sketches `detect(orgId, period)` modules) — would need a second data layer for the CI validator (plain `pg`) and the app (Supabase client). SQL gives one implementation both call.
- **Materialized views now** — faster reads, but a second copy of every formula to keep in step, and refresh jobs to monitor, before there is any evidence they are needed.

## Consequences
- The golden script `scripts/validate-metrics.ts` (CI, after the seed) holds the product's own functions to the manifest: sums exact, S1/S2/S3 within ±10%, S13 at most one anomaly finding per branch-week, dashboard p95 < 2 s.
- A finding's `impact_poisha` equals the manifest's excess over the full seeded year; weekly findings in production report that week's excess only.
- **Revisit** §5 when single-cashier branches appear (no peers): add the trailing baseline then.
