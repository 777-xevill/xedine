# 0036 — A new branch needs the platform operator's approval

## Context
Owners could add a branch from Settings with one click. Billing is per branch (ADR 0008), so that
silently raised the owner's monthly bill and the operator never knew. The control was also hard to
find (deep on the General settings page).

## Decision
- The owner **asks** on Branch setup: name and area (`request_branch`). The row lives in
  `branch_requests` (owner can read their own; every write is a function).
- A platform admin **approves or declines** in the admin console (`admin_decide_branch_request`). The
  inbox shows the org, its plan and branch count, and what one more branch adds per month.
  Approving creates the branch and a default Kitchen station; both decisions are audited.
- Direct inserts into `public.branches` are closed (the `branches_insert` policy is gone). Only
  `create_organization()` (the first branch(es) at sign-up) and an approval create branches.
- The owner can cancel an open request. A second request for the same name is refused while one is open.
- Cooking sections (stations) and per-branch menu prices and sold-out switches have no screen any more
  (the paper menu cannot follow them; kitchens start with one Kitchen station). Their tables stay.

## Consequences
Until a platform admin account exists (`public.platform_admins`, added by hand) no request can be
approved: it fails closed. Nothing notifies the operator yet; they see requests when they open the
admin console.
