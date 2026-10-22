# ADR 0013 — POS device authentication

- Date: 2026-09-22
- Status: accepted

## Context
ADR 0012 §7 deferred one question to Phase 1: a shared POS device has no account of its own (ADR 0003 — "POS staff do not have accounts"), but every write to `orders`, `payments`, `discounts`, `voids` etc. is guarded by RLS policies that require an `authenticated` Supabase session with a qualifying role for the branch. Something has to hold that session on the device.

## Decision
**The device's browser holds a real Supabase Auth session belonging to a manager or the owner — signed in once, persisted long-lived — and staff PIN sessions (ADR 0003, already built in Phase 0) sit on top of it purely for attribution, never as an RLS credential.**

Concretely:
- A manager or owner signs into the POS PWA once on the device with their own email/password. That establishes the cookie session the Supabase client uses for every request from that device.
- They then run `register_device` / `claim_device` (Phase 0 RPCs) to bind the device to the branch.
- From then on, staff switch with `start_staff_session` (hashed PIN, lockout). This does **not** change the Supabase Auth session — it only proves who is standing at the till right now.
- Every order-mutating RPC takes `p_staff_id` and `p_device_id` and calls a new helper, `private.verify_staff_session(org, device, staff)`, which requires an **open, non-expired** `staff_sessions` row for that exact pair before it does anything. Without one, the RPC refuses — a browser authenticated as the manager cannot silently act "as" a cashier who never PIN'd in.
- RLS itself is satisfied by the manager/owner's role, which is already in the write-role list for every POS table (`private.apply_policies` in Phase 0). No new RLS policies are needed.
- `orders.staff_id`, `payments.staff_id`, `audit_log.actor_staff_id` etc. are always the PIN-verified staff, not the Supabase Auth user — so a manager's own login never masks who actually rang up a sale.

## Alternatives considered
- **A Supabase Auth account per cashier** — cleanest RLS story, but ADR 0003 rejected this on cost and friction: cashiers don't have emails, and creating one per shift worker defeats the point of a shared-device PIN system.
- **A synthetic Auth account per device** (created at pairing, role `cashier`) — avoids needing a manager's own login on the till, but invents a fake "user" that doesn't correspond to a person, complicates session refresh on a device nobody is actively "logged in" to renew, and still needs the PIN layer for real attribution — so it adds a second auth mechanism for no attribution benefit over the chosen design.
- **PINs as a real RLS credential** (custom JWT minted per PIN session) — technically possible with Supabase's custom-claims support, but a 4–6 digit PIN is far too weak to be a direct database credential; ADR 0003 already ruled this out ("PINs are never an auth factor for anything outside the POS/KDS surfaces").

## Consequences
- Easier: no new auth infrastructure. Phase 0's RLS, roles and PIN system compose directly.
- Harder: the device's Supabase session must survive long unattended periods (a restaurant runs the till for a full shift, sometimes 12+ hours) without forcing a re-login mid-service — Supabase's refresh-token rotation handles this as long as the PWA stays open or the refresh token is persisted; if a manager's password changes or their session is revoked, **every device they signed into needs re-pairing**, which is a real operational cost worth surfacing at go-live.
- **Every order-mutating RPC must call `verify_staff_session` before writing** — an RPC that skips this check would let anyone with till access act as any staff member on that branch, defeating the audit trail's purpose. A test enforces that a stale or wrong-device session is refused.
- **Revisit** if a chain wants dedicated device logins independent of any one manager's account (e.g. a branch-level shared login) — that would need its own account per branch rather than per manager, a small extension of this same pattern.


## Amendment (2026-10-21): any till or kitchen staff may pair a screen
A cashier who opened POS in the browser was stopped at "ask the owner". `register_device` now allows owner, manager, cashier and kitchen for a branch they have access to (migration `20261021000001`). Pairing only registers an audited screen; working it still needs a staff PIN. Accountants and purchasers still cannot pair.
