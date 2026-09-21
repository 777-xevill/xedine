# ADR 0007 — Money visibility by role

- Date: 2026-09-22
- Status: accepted

## Context
PRODUCT.md lists seven roles (owner, branch manager, cashier, kitchen, purchaser, accountant, platform admin) and ARCHITECTURE.md gives `memberships` a role and a branch scope — but nothing stated **who may see cost, margin and profit figures**. Phase 0 writes the RLS policies, so this had to be settled first.

## Decision
**Cost, margin, profit and leak-value data is visible to the owner and the accountant only.**

| Role | Sees |
|---|---|
| Owner | Everything, all branches |
| Accountant | Everything, read-only, all branches |
| Branch manager | Their branch(es): sales, orders, items, covers, ticket times, stock quantities, waste quantities, discipline score. **Not** recipe costs, food-cost %, margins, P&L, or finding ৳ impacts |
| Purchaser | Purchase entry, supplier list, bazar list, and prices they themselves pay |
| Cashier | Their own shift and till: sales, payments, own cash over/short |
| Kitchen | KDS queue and waste button only |
| Platform admin | No tenant data by default; support access is time-boxed and audited |

Implementation notes:
- Enforced in **SQL, not the UI** — a `can_see_money(org)` helper alongside `is_org_member` / `has_role` / `can_access_branch`, applied to cost-bearing columns, metric functions and finding rows.
- Metric functions are the enforcement point. A manager calling `get_flash_pnl` gets a permission error, not a zero.
- The **AI assistant inherits the caller's permissions**. Tool results are filtered by the same helpers, so the assistant physically cannot narrate a margin to a manager. This needs an eval case.
- A purchaser sees the prices they pay — that is their job — but not what those prices do to margin.

## Alternatives considered
- **Owner + accountant + branch managers (branch-scoped P&L)** — what M13 manager scorecards and "gap to best branch in ৳" assume, and it lets the person who can fix a leak see its size. Rejected on the founder's call: recipe costs and margins are the most commercially sensitive data in a restaurant, and managers turn over.
- **Owner only** — tightest, but the accountant would need exports for routine work, adding manual steps to every month-end.

## Consequences
- Easier: the blast radius of a compromised or departing manager account is small; the sensitive-data story is simple to explain to a prospect.
- Harder — and this needs revisiting:
  - **M13 manager scorecards and "gap to best branch in ৳" become owner-only views.** A manager cannot see their own scorecard if it contains money. Either the scorecard gets a money-free variant (quantities, ticket times, discipline score, variance in *units* not taka) or it stays an owner tool.
  - **Findings lose their action loop for managers.** The person who can fix over-portioning at Mirpur can't see the ৳18,400. Phase 6 needs a decision on how a finding is *delegated* — probably an owner-authored task carrying the evidence but not the impact figure.
  - Every metric function needs a permission test, roughly doubling the metric test matrix.
- **Revisit at Pilot gate A**, with a specific question for pilot owners: do you want your branch managers to see their own branch's food-cost % and leak values? If yes, this ADR is superseded by a per-org `managers_see_money` setting rather than a code change.
