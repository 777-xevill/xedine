# ADR 0003 — Authentication and identity

- Date: 2026-09-22
- Status: accepted

## Context
Phase 0 must ship auth for owners and managers plus device/PIN switching for shared POS tablets. The docs specify the POS side (device registered to a branch, staff switch with a hashed 4–6 digit PIN) but never say how owners and managers actually sign in. Bangladeshi restaurant owners live on WhatsApp and phone numbers, which makes phone OTP tempting.

## Decision
- **Owners and managers: email + password** via Supabase Auth.
- **Managers join by invite.** The owner invites an email address with a role and a branch scope; the invite link creates the user and the `memberships` row together, so a manager can never exist without a scope.
- **POS staff do not have accounts.** A device is registered to a branch; staff switch with a hashed PIN. Every POS action records `staff_id` + `device_id`. PINs are never an auth factor for anything outside the POS/KDS surfaces.
- Google OAuth may be added later as an additional provider without schema change.

## Alternatives considered
- **Phone OTP (+880)** — matches how owners think about identity and reuses the number they already give us for WhatsApp. Rejected for Phase 0 because it forces the Phase 8 SMS-gateway decision forward, adds a per-message cost to every login and every failed login, and makes local development depend on a paid third party.
- **Email magic link** — no passwords to reset, but depends on email delivery to Bangladeshi inboxes and on owners checking email, which PRODUCT.md says they don't.
- **Google OAuth + password fallback** — convenient for Gmail users, but two auth paths to test through the invite/membership flow in the phase where tenancy correctness matters most.

## Consequences
- Easier: works offline in local dev with no external dependency; Phase 0 has no third-party blockers; password reset is Supabase's problem.
- Harder: owners must remember a password, and support will involve password resets. The owner's phone number is still collected separately for WhatsApp (P4) and is **not** an identity credential — two identifiers to keep in sync.
- **Revisit at Pilot gate A:** if real pilot owners struggle with email/password, phone OTP becomes the migration target. Keep `auth.users.phone` populated from the org profile so that migration stays cheap.
