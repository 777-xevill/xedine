# Xedine — Metric Definitions (single source of truth)

Rules: money in poisha · quantities in base units · periods use `business_date` (Asia/Dhaka, branch cutoff hour, default 04:00) · each metric has one implementation · if code and this file disagree, stop and ask. Thresholds below are defaults stored in config.

## Sales
| ID | Definition |
|---|---|
| sales.gross | Σ `net_before_discount_poisha` of completed orders — the VAT-exclusive value before discounts. (Summing the printed menu price would include VAT for VAT-inclusive restaurants and make orgs incomparable; ADR 0005) |
| sales.discounts | Σ `discount_net_poisha` — order- and item-level discounts on the VAT-exclusive basis, so `gross − discounts = net` holds under both price bases |
| sales.refunds | Σ refunded value, taken at its VAT-exclusive share of the refunded order (ADR 0015 §1) |
| sales.net | gross − discounts − refunds (excludes VAT and service charge). Read from the order line's stored `net_poisha`, which is decomposed at sale time per the org's `price_includes_vat` setting — never re-derived from a menu price ([ADR 0005](decisions/0005-vat-and-price-basis.md)) |
| sales.vat, sales.service_charge | collected amounts, reported separately |
| orders.count | completed orders (voided/cancelled tracked separately) |
| orders.aov | sales.net ÷ orders.count |
| orders.covers | guests (dine-in, when entered) |
| sales.by_channel / by_daypart / by_payment_method | splits of sales.net |

## Item velocity
`items.qty_sold(item, window)` — windows: last_2h (rolling now−2h), today (current business_date), yesterday, last_7d, week_to_date (config week start), month_to_date, last_30d, custom. Filters: branch, channel, daypart. Rankings: top/bottom N by qty and by contribution margin.

## Costing
- `ingredient.unit_cost` — weighted average paid price, last 14 days (config: last price / weighted avg); falls back to manual price.
- `recipe.cost(item)` — Σ(line qty ÷ yield × unit_cost), sub-recipes included; snapshot stored on order_items at sale time.
- `food_cost.theoretical` (TFC) — Σ(qty sold × recipe-cost snapshot).
- `food_cost.theoretical_pct` — TFC ÷ sales.net of items with recipes.
- `recipes.coverage_pct` — sales.net of items with recipes ÷ sales.net.
- `item.contribution_margin` — price − recipe cost; `item.margin_pct` — CM ÷ price.

## Inventory
- `usage.theoretical(ing, period)` = Σ(qty sold × recipe qty)
- `stock.theoretical` = last count + purchases + transfers_in − transfers_out − usage.theoretical − waste.logged
- `usage.actual(period between counts)` = opening count + purchases + transfers_in − transfers_out − closing count
- `cogs.actual` = usage.actual × period weighted unit_cost
- `variance.usage_qty` = usage.actual − usage.theoretical − waste.logged; `variance.value` = qty × unit_cost
- `variance.pct_of_sales` = Σ variance.value ÷ sales.net. Bands: < 2% healthy · 2–5% watch · > 5% problem (the whole restaurant; never applied per ingredient)
- `usage.staff_food` = waste.logged with the reason **Staff food** (`reason_codes.code = 'staff_food'`; a dish through its recipe), per ingredient between two counts — shown on its own line, valued like variance.value, **never part of over-usage or the loss** (ADR 0029)
- `usage.over_qty` = usage.actual − usage.theoretical − usage.staff_food (= other waste.logged + variance.usage_qty), per ingredient between two counts. > 0 is **over-usage, a loss**; < 0 is **under-usage** (never a gain); exactly 0 is **on recipe** (ADR 0027, 0029)
- `usage.over_pct` = usage.over_qty ÷ usage.theoretical; `usage.over_value` = usage.over_qty × unit_cost (closing-day cost, like variance.value)
- **Loss line** (`org_settings.loss_line_bps`, owner setting, default 1%): usage.over_pct ≥ the line — or over-usage of an ingredient no sold recipe needs — is a **loss** to act on; over-usage below the line is a **small loss** (still counted in ৳). The `usage.unexplained` detector uses the same line as its minimum rate
- `stock.loss_value` = Σ usage.over_value over ingredients with usage.over_qty > 0. Under-usage is never subtracted (netting would hide a loss)
- **Variance bridge:** total gap (cogs.actual − TFC) = logged-waste value + price effect (paid − standard cost × qty) + unexplained-usage value + count-uncertainty band
- `stock.days_of_cover` = stock.theoretical ÷ average daily usage.theoretical: 🟢 ≥ 7 · 🟡 3–6.99 · 🔴 < 3 (per-ingredient override). The average is usage.theoretical over the last **D** days ÷ D, D = 14, or the days since the item was first bought, counted or received at the branch (today included) when fewer (ADR 0030); the count-based ledger `private.m_stock` (Stock Guard, hiding, bazar list, golden checks) keeps D = 14
- `stock.estimate` (ADR 0030), for an item never counted at a branch: purchases + transfers in − transfers out − usage.theoretical − waste.logged from the first day it was bought or arrived there (as if the shelf was empty before). Shown as stock with `estimated = true` (≈) until the first count; the count-based `stock.theoretical` (Stock Guard, hiding, bazar list, golden checks) still says unknown
- `stock.used` = usage.theoretical over the same last D days the average is taken over (from `since_on`, the first of them), so "used ÷ days = a day" always holds on the Stock page
- `stock.lot` (ADR 0029), per branch and active ingredient: the **lot** = every confirmed purchase line of the latest business day it was bought; its days = `for_days` of that day's latest line that says them (no days said → no lot). `ends_on` = bought_on + days − 1; `days_left` = max(ends_on − today + 1, 0), today included. State: **running** (today ≤ ends_on) · **ended** (listed for 7 days after ends_on). `prev_lasted_days` = this lot's day − the previous lot's day, shown when below the previous lot's days
- `waste.pct` = waste.logged value ÷ purchases value

## Purchasing
- `price.reference(ing, branch)` = median paid unit price, trailing 28 days
- `price.drift` = (paid − reference) × qty; flag when > 8% above reference
- `price.cross_branch_gap` = same ingredient, same business_date, branch price vs group median
- `price.external_gap` = vs `reference_prices` (CSV import), when available

## Costs & P&L
- `labour.daily` = Σ(monthly salaries + allowances) ÷ days in month (per branch); `labour.pct` = labour ÷ sales.net; `sales.per_staff`
- `fixed.daily` = Σ monthly fixed costs (rent, utilities, gas, generator/fuel, internet, other) ÷ days in month
- `commission.value` = Σ(channel sales.net × commission % + fixed fees) + restaurant-funded platform discounts. **Rounding:** `mulBps(period net, bps)` rounded half-up **once per (branch, channel, period)**, not per order; a per-order sum differs by up to one poisha per order. The seed manifest defines it this way (ADR 0012 §7)
- `pnl.flash.estimated_profit` = sales.net − COGS (actual for the period if counts exist, else TFC) − commission − labour.daily − fixed.daily
- `gp.pct` = (sales.net − COGS) ÷ sales.net · `prime_cost.pct` = (COGS + labour) ÷ sales.net
- `breakeven.sales_today` = (labour.daily + fixed.daily) ÷ (1 − variable ratio); variable ratio = (COGS + commission) ÷ sales.net, trailing 28 days
- `breakeven.remaining_today` = max(0, breakeven.sales_today − sales.net so far today)

## POS exceptions (zero-input leaks)
Per cashier / shift / branch vs trailing-28-day baseline (z-score AND absolute floor):
- `void.rate` = voided value ÷ (net + voided); `void.after_kot.count`; `void.after_payment.count`
- `discount.rate` by staff; repeated identical discounts; discounts without reason
- `refund.without_original.count`; `refund.rate`
- `price_override.count` / value
- `cash.share` by cashier vs branch baseline
- `cash.over_short` per shift
Finding impact = excess over baseline in ৳ for the period.

## Channels
`channel.net_margin` = channel sales.net − commission − restaurant-funded platform discounts − packaging − TFC.

## Menu engineering (Kasavana–Smith)
Per period and branch: popularity = item qty ÷ total qty; "high" if ≥ 0.7 × (1 ÷ number of items). Margin "high" if item CM ≥ sales-weighted average CM.
Star = high popularity, high margin · Plowhorse = high, low · Puzzle = low, high · Dog = low, low.

## Customers
- `customers.identified_share` = orders with a customer ÷ orders
- `visits.first_return_rate(30d/60d)` = first-timers who return within the window ÷ first-timers
- RFM quintiles; segments: new, returning, regular, at-risk (days since last visit > 2 × personal median interval AND > 30), lost (> 90)
- `campaign.lift` = return rate (treated) − return rate (holdout); report n per group; no claim if n < 30 per group

## Reviews & service
- `rating.avg` by source / branch / period; `feedback.score` avg (0–10) and share(9–10) − share(0–6)
- `service.ticket_time` = ready_at − sent_to_kitchen_at (median, p90) by daypart / branch

## Forecasting
- `forecast.wape` = Σ|actual − forecast| ÷ Σ actual (per item group / branch, last 28 days)
- `forecast.naive` = same weekday last week. Show the model forecast only if WAPE improves ≥ 10% vs naive.

## Compliance (ADR 0023)
- `compliance.status` per licence and the next VAT return: `expired` (days left < 0) · `urgent` (≤ 7) · `due` (≤ 30) · `upcoming` (≤ 60) · `ok`. The VAT due day is per-org config (`org_settings.vat_return_due_day`, default 15), never a hardcoded legal date — `TODO(verify)` with an accountant.
- `vat.summary` = orders grouped by `(branch, vat_rate_bps, price_includes_vat)`, summing the stored `net/vat/service_charge/total` (ADR 0005) — a working summary from POS data, not a filed Mushak return.

## Staff-lite (ADR 0023)
- `advances.balance` = Σ `advances.amount_poisha` per staff (positive = given, negative = repaid). Money-gated.
- `attendance` counts per staff over a period: present / half_day / leave / absent / unmarked (days with no row, counted separately, never as absent).
- `sales.per_staff` = `m_staff_exceptions` per staff: completed net sales, orders, and the same void/discount/refund counts the leak detector uses — never a second definition.

## Growth (ADR 0023, optional)
- `growth.top_item` = a menu-matrix `star` if one exists (needs recipe costs), else the top seller by units, over the last 28 days.
- `growth.daypart_share` = each configured daypart's share of the last 28 days' net sales; the weakest and strongest are surfaced. Revenue only — no cost or margin, so no money gate.

## Stock Guard (ADR 0028)
`metric_stock_guard(org, branch, now)`: fixed rules over the stock records, one row per thing a person should look at. No AI, no thresholds per org yet. "Today" is the org's business date at the injected now; scope is the caller's stock branches.
- `guard.price_typo` — the latest confirmed purchase line's unit price (`line_total ÷ qty_base`) is ≥ 2× or ≤ ½ the median unit price of the 5 lines before it (≥ 3 needed). Returns the paid total and `usual_total = round(median × qty_base)`. **Owner and accountant only** (`can_see_money`).
- `guard.below_zero` — `stock.theoretical` < 0 at a branch (a purchase not recorded, or a bad count).
- `guard.idle_stock` — bought at some time, but no purchase, recipe usage or waste in the last 60 days, and `stock.theoretical` > 0 somewhere (or some on the way): money sitting on the shelf.
- `guard.unused` — the same 60 quiet days, and every branch that bought it has counted it and shows ≤ 0: the owner may hide it.
- `guard.unused_unknown` — the same 60 quiet days, but a branch that bought it never counted it: the owner must say whether any is left before hiding.
- `guard.new_item` — an item purchasers added from the chat (`added_via = 'chat'`) in the last 14 business days, with who added it (from the audit log).

Hiding (`set_ingredient_hidden`) is refused while `stock.theoretical` > 0 or anything is in transit in any branch, and needs the owner's "none left" where the item was bought but never counted. A hidden item drops out of `stock.theoretical`'s list, count sheets and the bazar list (it has no stock by then), keeps all its history in every period metric, and comes back on its next purchase.

## Discipline score (per branch per day, 0–100)
Bazar entries recorded (25) · waste log touched (15) · cash close done (20) · scheduled count done (25) · recipe coverage ≥ 90% (15).

## Branches (ADR 0022)
- `branch.gap_to_best` (per component) = amount − best branch's rate × this branch's base, floored at 0. Components (lower is better): unexplained usage (÷ variance-bridge sales), logged waste value (÷ sales.net), labour (÷ sales.net), discounts (÷ gross), voids after KOT (÷ gross). Needs ≥ 2 branches with the figure. Food cost % is excluded (menu mix); compare items like-for-like instead.
- `branch.like_for_like` = for items sold in ≥ 2 branches: units ÷ trading days, and net ÷ units.
- Manager scorecard: money-free measures with the branch's rank among all branches; other branches' values are never returned.

## Benchmarks
Segments (ADR 0022 §4): all restaurants, cuisine, branch band (1 / 2–5 / 6+), and cuisine × branch band. City/area, format and AOV band wait until there are enough restaurants. A cell is published only with k ≥ 5 **and** a complement of 0 or ≥ 5 restaurants in each parent cell.
Metrics (built): food_cost.theoretical_pct (only with recipe coverage ≥ 90%), labour.pct, sales.net per branch per day, orders.aov, rating.avg (≥ 20 ratings), visits.first_return_rate (≥ 30 first-timers), delivery share. Deferred: cogs pct (when counts exist), gp.pct, waste.pct (open question 2).
Output p25 / p50 / p75 only · k ≥ 5 orgs per cell (enforced in SQL) · exclude orgs with < 30 days of data or low data quality · monthly snapshots · seeded "industry reference" ranges labelled as such.

## Findings (all detectors)
`{ id, org_id, branch_id, type, period, impact_poisha, confidence: low|medium|high, evidence[], suggested_actions[], status: new|acknowledged|snoozed|resolved|dismissed, reason }`
Rank = impact × confidence weight × novelty. Max 3 proactive insights per owner per day.
`impact_poisha` is money, so it is owner/accountant-only ([ADR 0007](decisions/0007-money-visibility-by-role.md)).

---

## Open definition questions — settle before implementing the affected metric

These are ambiguities found while reviewing this file, not decisions. **Stop and ask** rather than picking one.

1. **"Variance" means two things.** `variance.usage_qty` already subtracts `waste.logged`, so `variance.value` is really *unexplained* usage value — but the variance bridge lists logged waste as a separate component alongside it. Rename one of them (suggestion: `variance.unexplained_value`) or the P6 bridge will not reconcile, and the `< 2% healthy` bands will be read against the wrong quantity.
2. **`waste.pct` denominator.** `waste.logged value ÷ purchases value` is noisy and sometimes divides by zero — bazar purchases are lumpy and absent on many days. Industry norm is ÷ COGS or ÷ sales.net. Affects the benchmark of the same name.
3. **`food_cost.theoretical_pct` is not comparable across orgs** as defined (TFC ÷ sales.net *of items with recipes*). Benchmarking it needs a `recipes.coverage_pct` floor, otherwise a 40%-coverage org is compared against a 95%-coverage one.
4. **Menu engineering `n`.** "High popularity if ≥ 0.7 × (1 ÷ number of items)" needs `n` pinned: items *available* in that period and branch, excluding 86'd ones — plus a minimum-volume floor, or adding a menu item silently reclassifies every other item.
5. *(Settled in ADR 0015 §9: the Health Monitor leads with break-even remaining.)* **`pnl.flash.estimated_profit` mid-day.** It subtracts a full day's `labour.daily + fixed.daily`, so at 11:00 it reads deeply negative by construction. Correct for a closed day; needs deliberate UI treatment for a live one (show `breakeven.remaining_today` as the primary figure instead).
6. **`orders.covers` is optional input**, so every covers-derived metric is sparse. Define the null-handling rule once: suppress the metric, or report it with an explicit coverage caveat.
7. *(`cash.share` settled in ADR 0015 §6 — daypart-normalised; `price.drift` waits for Phase 5.)* **Two detectors are confounded** and will generate false positives against the ≤1-per-branch-week tolerance: `cash.share` by cashier ignores daypart (a late-shift cashier legitimately takes more cash), and `price.drift > 8% above a 28-day median` fires constantly when the bazar trend itself is rising — which is most of the time, and S8 is planted at only 9–12%.
