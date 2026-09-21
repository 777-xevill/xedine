# ADR 0012 — Phase 0 design decisions

- Date: 2026-09-22
- Status: accepted

## Context
Phase 0 left three questions open in ROADMAP.md (invoice numbering vs offline POS, `business_date` storage, PII retention) and needed several small design calls that the later phases will build on. This records them so they are not rediscovered.

## Decisions

### 1. `business_date` is a stored column, set once at insert
`orders.business_date` is written by a `BEFORE INSERT` trigger from `placed_at` and the branch cutoff (`branches.cutoff_minutes`, else `org_settings.default_cutoff_minutes`, else 04:00). It is never rewritten: a later cutoff change does not move history, and `placed_at` is immutable. The SQL function `private.business_date()` and the TypeScript `businessDate()` are asserted against one shared fixture (`tests/fixtures/business-date-cases.json`).
*Why stored:* every dashboard filter and index is `(org_id, branch_id, business_date)`; computing it per query on a year of orders is slower and re-derives history from whatever the cutoff is today.

### 2. Invoice numbers are server-assigned; offline receipts carry a provisional number
A gapless VAT invoice number cannot be minted on a disconnected tablet. `invoice_sequences` is service-only. The offline POS prints a **provisional receipt number** (`orders.provisional_receipt_no`, client-generated, clearly marked) and the server assigns `orders.invoice_no` on sync. The Mushak 6.3 requirements are `TODO(verify)` with an accountant before this is presented as compliant. The assigning RPC arrives in Phase 1.

### 3. Money visibility is enforced at the row level by splitting cost data into its own tables
Postgres RLS is row-level, so a "hide the cost column" rule cannot be expressed on a shared table. Cost-bearing data therefore lives in separate money-gated tables (`order_item_costs`, `ingredient_costs`, `channel_commissions`, `org_cost_settings`), not as columns on rows managers can read. Order rows carry selling prices only. This is what makes ADR 0007 provable in SQL.

### 4. Tenant references are composite foreign keys
Every reference between tenant tables is `(org_id, id)`, so a row can never point at another organization's data (this also removes the "does this UUID exist?" oracle). A structural test fails if any tenant-to-tenant FK omits `org_id`.

### 5. Order rows snapshot their tax settings; the price basis is frozen after the first order
`orders` copies `price_includes_vat`, `vat_rate_bps` and `service_charge_bps` at sale time, and `org_settings.price_includes_vat` cannot change once an order exists (ADR 0005). METRICS.md `sales.gross` / `sales.discounts` are defined on the VAT-exclusive `net_before_discount_poisha` / `discount_net_poisha` columns so figures stay comparable across VAT-inclusive and VAT-exclusive restaurants.

### 6. Job authentication and the AI tenant boundary
Job routes authenticate with a shared secret (`JOB_SECRET`, constant-time compare) and are claimed through `job_run_begin()`, which is idempotent per `(job, org, period)`. The service-role client is importable only from job/webhook code (ESLint), and never from a component.

### 7. Not decided here (deferred deliberately)
- **PII retention window and customer-deletion flow** — needs a legal review; the schema carries consent and masking hooks, and Phase 8 (customers) is where it becomes real.
- **Device authentication** (how a shared tablet holds a Supabase session) — Phase 0 ships device registration, pairing codes and PIN sessions; the credential a device signs in with is a Phase 1 decision because it depends on the POS shell.
- **`commission.value` rounding** — sums are exact per period; the manifest defines it as `mulBps(period net, bps)` rounded once per period. If the metric ever aggregates per order, the definitions will differ by up to one poisha per order; settle in Phase 2.

## Consequences
- Easier: later phases inherit a schema whose security properties are already tested per table, and a manifest whose numbers are defined once.
- Harder: cost figures need a second table read, and metric functions must join the money tables deliberately.
- **Revisit** items in §7 at the start of the phase that needs them.
