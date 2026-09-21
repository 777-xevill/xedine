# ADR 0005 — VAT and price basis

- Date: 2026-09-22
- Status: accepted

## Context
METRICS.md defines `sales.net` as excluding VAT and service charge, but no document said whether a menu price *contains* VAT or has it added at the till. The two conventions both exist in the Dhaka market: most bhaater hotels, cafés and mid-market restaurants print the price the customer pays; fine dining and hotel restaurants print a net price and add "+ VAT". Since Xedine targets every format, both will appear among customers. This decision touches every money column, every receipt and every metric, so it cannot be deferred past the first migration.

## Decision
**Each organization chooses: `org_settings.price_includes_vat` (boolean).** Both conventions are supported from Phase 1.

Regardless of the setting, **orders store the decomposition, never just the total**:

| Column | Meaning |
|---|---|
| `unit_price_poisha` | the price as printed on the menu (what the setting describes) |
| `net_poisha` | VAT-exclusive value — the only input to `sales.*` metrics |
| `vat_poisha` | VAT amount, reported separately |
| `service_charge_poisha` | service charge, reported separately |
| `total_poisha` | what the customer actually pays |

- `price_includes_vat = true` → `net = round(price ÷ (1 + rate))`, `vat = price − net`.
- `price_includes_vat = false` → `net = price`, `vat = round(price × rate)`.
- VAT rate lives in `org_settings` as config, per the "no hardcoded regulatory facts" rule, and stays marked `TODO(verify)` until confirmed with a Bangladeshi accountant. Rate may vary by item category — the schema must allow a category-level override even if the UI only exposes one rate in Phase 1.
- **Rounding is applied once, at the order-line level, in poisha, half-up.** Order totals are the sum of rounded lines, so a receipt always adds up. The rounding helper is a single shared function with unit tests.
- Historic orders keep the decomposition computed at sale time. Changing the rate or the setting never retro-changes a past order.

## Alternatives considered
- **Inclusive only** — simplest POS and receipts, and correct for most of the market. Rejected because the first fine-dining customer would force a schema migration across `orders`, `order_items` and every sales metric.
- **Exclusive only** — cleanest accounting and simplest SQL, but the printed price wouldn't match what customers expect to pay in most of the target market.

## Consequences
- Easier: `sales.net` has exactly one meaning across every org, so metrics and benchmarks stay comparable regardless of which convention a restaurant uses.
- Harder: every price-entry, cart, receipt and KOT path must go through the decomposition helper — never multiply a price by a quantity directly. This needs a lint-level convention and a test that a receipt's lines sum to its total under both settings.
- The setting is effectively **immutable once orders exist** — flipping it would make a branch's own history incomparable. The UI must warn, and ideally lock it after the first order.
- **Revisit** when Mushak 6.3 invoice fields are verified with an accountant (Phase 1 / Phase 10): the statutory invoice may dictate which figures must appear, which could add columns but should not change this decision.
