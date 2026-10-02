# ADR 0027 — Every gram over the recipe is a loss

- Date: 2026-10-02
- Status: accepted (the founder confirmed all three choices below)

## Context
ADR 0026's Stock page called an item "OK — close to the recipes" when it used less than 2% over its recipe, and grouped items with METRICS.md's 2% / 5% bands. The founder rejected that: Xedine's job is to find the loss, so the exact difference must always show, and anything 1% or more over the recipe is a loss. Checking the rule against the code found two real problems: the 2% / 5% bands were defined for the **whole restaurant as a share of sales** (`variance.pct_of_sales`) but were being applied **per ingredient as a share of the recipe amount**; and the page's headline total netted under-usage against over-usage, so an under-count on one item could hide a real loss on another. Industry guides put normal food-cost variance at 1–2% and act above 2–5% (Restaurant365, MarketMan, Apicbase, Jelly) — a 1% line is stricter than that, on purpose.

## Decision
1. **Over-usage is the whole difference**: `usage.over_qty` = really used − what the recipes of the dishes sold needed, logged waste included. It is shown exactly (to the gram) and in ৳ for owner and accountant (ADR 0007), split into "written down as waste" and "not explained", since only the second needs investigating. `metric_stock_variance` returns `over_qty`, `over_bps`, `over_poisha` (migration `20261014000001`).
2. **The loss line** is an owner setting, `org_settings.loss_line_bps`, default 1% (0.1–20%), changed on the Stock page's Loss tab. At or over the line an ingredient is a **loss** (red); under it a **small loss** (amber, still counted in ৳); exactly the recipe amount is **on recipe**; using less is **under-usage** (blue), shown apart and never counted as profit.
3. **No netting**: the loss total (`stock.loss_value`) adds up over-usage only.
4. **Money leaks uses the same line**: `private.detector_config` sets `usage_min_rate_bps` from the loss line (it wins over older per-org overrides), so the Stock page and Money leaks never disagree. On the seeded data this keeps the planted leaks (S6 +1%, S7 +6.4%, S9 +0.6% from their planted values — within the oracle's 10%) and surfaces three real background over-uses (Mirpur rice 3.1%, Mirpur beef 3.0%, Dhanmondi mutton 1.4%); the clean café still has none. The golden check now allows such findings only at or over the line and smaller than the smallest planted leak.
5. The Stock page's "Missing" tab becomes **Loss / লোকসান**; the 2% / 5% per-item bands and the "close to the recipes" wording are removed.

## Alternatives considered
- **Keep 2% / 5% per item** — matches common practice, but hides small, steady losses the founder wants to see, and misreads METRICS.md's whole-restaurant bands.
- **Flag only the unexplained part** — then logged waste would never count as a loss; it does cost money.
- **A ৳ floor for flags** — fewer red rows; not wanted now. Sorting by ৳ (biggest first) keeps the list usable instead.

## Consequences
- More items show red: on the demo data 18 of 19 items are at or over 1% (the seed plants ~1% normal loss). The list is sorted by ৳ so the big ones come first.
- Real counting error (about 1% on small items) will show as small losses; the per-item sum ("how we worked this out") lets an owner check a count.
- **Revisit** the default line with pilot data, and whether some categories (produce) need their own line.
