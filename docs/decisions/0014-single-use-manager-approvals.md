# ADR 0014 — Single-use manager approvals and RPC-only order writes

- Date: 2026-09-27
- Status: accepted

## Context
Phase 1 (1/N) let a void after the KOT go through when the RPC was handed a manager's staff id that had an **open staff session on the same device**. Reviewing it before finishing Phase 1 found three problems:

1. A manager's staff session lasts up to 12 hours. Once a manager PIN'd in once on a till — to approve one void — any later void, discount or shift close on that till could quote their id without them being there.
2. The approver role was checked against the **browser login** (always a manager or owner under ADR 0013), not the PIN'd person, so the check almost always passed.
3. RLS still granted `authenticated` managers direct INSERT/UPDATE on `orders`, `order_items`, `payments`, `voids`, `discounts`, etc. A manager's browser could write those rows without any RPC, which skipped the audit trail, the totals rebuild and the staff-session check.

A branch manager could also create a staff row with role `manager` and give it a PIN, then approve their own voids from a second "person".

## Decision
**Sensitive POS actions consume a single-use approval minted by a manager's PIN, and order tables are writable only through the audited `security definer` RPCs.**

- `approve_action(device, approver_staff, pin, action)` checks the PIN (same lockout as `start_staff_session`), requires the approver's **staff role** to be `manager` or `owner`, and inserts a `staff_approvals` row scoped to one org, branch, device and action (`void_after_kot`, `refund`, `discount`, `close_shift`, `cancel_order`). It expires after **2 minutes**. The grant is audited (`approval.grant`).
- The order RPCs (`void_order_item`, `cancel_order`, `apply_order_discount` when the reason requires it, `refund_order`, `close_shift` for non-managers) take `p_approval uuid` and call `private.consume_approval`, which locks the row, checks scope, expiry and `used_at`, marks it used and returns the approver for the audit row. A second use fails with `42501`.
- A manager can approve their own action by typing their own PIN again: that is a deliberate, physical act at the till, not a stale session.
- `staff_approvals` is service-only: no client can read or write it.
- `INSERT/UPDATE/DELETE` on every order table is revoked from `authenticated`; SELECT still follows the Phase 0 policies. Every write goes through an RPC that verifies the staff session (ADR 0013), writes `order_events`, rebuilds totals with `private.recompute_order_totals` and writes `audit_log`.
- `private.guard_staff_change()` (trigger) and `set_staff_pin` refuse to let anyone but the owner create, promote or set the PIN of manager-level staff.

## Alternatives considered
- **Keep sessions, shorten them** — a 5-minute manager session still leaves a window where a different action can reuse it, and it logs the manager out of their own till work.
- **Approval scoped to one order/line id** — tighter, but the till would need to know the target before asking for the PIN, and most restaurants approve at the moment of the action anyway. Two minutes plus one action type plus one device is tight enough; revisit if pilots show misuse.
- **Keep direct table writes and add triggers** — triggers could audit, but can't check the PIN'd staff session or rebuild totals without duplicating RPC logic; one write path is simpler to test.

## Consequences
- Easier: every void, refund, discount, cancel and shift close has exactly one named approver in `audit_log`, and the S1/S2 detectors in Phase 2 can trust who approved what.
- Harder: the till UI needs a two-step dialog (reason → manager PIN) and must retry with an approval when an RPC answers `42501`. `PosApp.tsx` does this through `ManagerApprovalStep`.
- Any future order-mutating feature must be an RPC; direct `.from('orders').insert()` from the client will fail. `tests/db/pos-integrity.test.ts` asserts the revoke for both managers and cashiers.
- The offline outbox (Phase 1) can queue orders and payments, but **not** approvals: they expire in two minutes and need the server to check the PIN. Voids, refunds and cancels after KOT stay online-only.
