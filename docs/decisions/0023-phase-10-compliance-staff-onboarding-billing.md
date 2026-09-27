# ADR 0023 — Phase 10 compliance, staff-lite, onboarding, billing and launch hardening

- Date: 2026-10-08
- Status: accepted (built unattended — **§1, §5, §6 and §7 are choices the founder should confirm**)

## Context
Phase 10 is "ready for paying customers": a licence and VAT-return tracker, staff-lite records, an
onboarding wizard targeting under two hours, plans and billing, an admin console, an optional growth
module, and a security review. Nothing here has a planted test-oracle scenario (ROADMAP's scenario table
stops at S13); "done" is evidenced by hand-worked DB tests and the checklist in [SECURITY.md](../SECURITY.md).

## Decision
1. **Licences and VAT dates are configuration, never hardcoded law.** A licence's `kind` is free text (a
   datalist offers common Bangladesh licence names as suggestions only); the VAT return's due day is a
   per-org integer the owner sets, defaulting to 15 (`TODO(verify)` with an accountant). `metric_vat_summary`
   is described everywhere as a *working summary from stored order data*, not a filed Mushak return.
   *Confirm the default due day and that a working summary (not a real filing) is the right MVP scope.*
2. **Reminders are computed, not scheduled by hand.** `metric_compliance` bands every licence and the next
   VAT return by days left (expired / urgent ≤7 / due ≤30 / upcoming ≤60 / ok); `job_compliance_reminders`
   turns that into one row per threshold crossed, keyed so the daily job can fire every day and each
   reminder still reaches the owner's WhatsApp exactly once (the outbox's own idempotency key does the rest).
3. **Staff-lite stays lite.** Advances are a signed ledger (positive = given, negative = repaid), money-gated
   and audited; attendance is four states per staff per day, owned by that branch's manager; sales per staff
   reuses the existing `m_staff_exceptions` metric so it can never disagree with the leak detector's voids
   and discounts. No AI shift scheduling (PRODUCT.md M16: monthly salaries make it low value).
4. **Onboarding's checklist is truth, not a wizard's opinion.** `metric_setup_progress` checks twelve things
   against the data that already exists — a menu item count, a submitted stock count, an active device —
   so it can never claim a step is done that isn't. The menu import is one function (`import_menu`): matches
   categories by name, skips an existing item name case-insensitively, never overwrites, and writes one
   audit row per call. A menu photo is read by AI into an editable CSV draft (CLAUDE.md #4) — a price it
   cannot read is left blank, never guessed.
5. **Plans are enforced in the gateways, not just the UI.** `org_plan` computes the effective plan: a
   subscription row if one exists (with a `trialing` grace of 30 days from `started_at` before it counts as
   `trial_expired`), else a 30-day Growth trial from the org's own creation, else `active` for every demo
   org. `plan_allows` reads `plans.limits->>'ai'` / `'whatsapp'`; the LLM gateway (`UsageStore.planAllowsAi`)
   and `queueMessage` both call it before spending anything, so a lapsed Starter org gets `not_in_plan` from
   the assistant and silently queues no WhatsApp message, not a confusing partial failure. *Confirm the
   30-day trial length and that it defaults to Growth (full features) rather than Starter.*
6. **Billing has no payment provider yet.** `metric_billing` shows the plan, status, next month's amount
   (branches × price × (1 − pilot discount), ADR 0008) and this month's AI/WhatsApp usage; a platform admin
   sets the subscription by hand (`admin_set_subscription`, audited) until a provider (bKash, SSLCommerz,
   Stripe) is chosen. *Confirm invoice-by-hand is acceptable for the pilot cohort.*
7. **The admin console shows operational metadata only.** `platform_admins` is a service-only allowlist
   (added by hand, `Run by hand`); `admin_orgs` returns name, slug, plan, status, branch count and trading
   days in the last 30 — never a tenant's sales, cost or customer data (ARCHITECTURE.md's platform-admin
   principle). *Confirm no tenant data should ever appear here, even for support purposes.*
8. **Growth is optional and grounded in one real number per idea.** `metric_growth_inputs` returns only
   revenue figures (a top-selling item, the weakest and strongest daypart's share of sales) — no cost or
   margin, so it needs no money gate and works for managers too. The AI draft may cite only the number it
   was given (checked the same way as review replies, CLAUDE.md #1); a person approves before a date is set,
   and nothing is ever posted automatically — "mark posted" is a manual confirmation after the owner copies
   the caption themselves (PRODUCT.md M17: "no auto-posting in MVP"). It needs no separate plan flag: drafting
   already requires the `ai` limit through the shared gateway.
9. **Security review is a living document, not a one-time pass.** [SECURITY.md](../SECURITY.md) records what
   the automated suites already prove (RLS isolation per table, SECURITY DEFINER search_path pinning, no
   function left callable by anon), what was checked by hand (secrets, headers, dependency audit), and what
   is explicitly deferred to launch prep (rate limiting, backups, monitoring, load testing) rather than
   faked with something that wouldn't actually protect a serverless deployment.

## Alternatives considered
- **Hardcoding Bangladesh licence types and the VAT due date** — rejected outright by CLAUDE.md's don'ts.
- **An in-memory rate limiter** — gives false confidence on serverless (no shared state across invocations);
  a real one needs a chosen backing store, which is a dependency decision for the founder.
- **Auto-posting growth content** — rejected: PRODUCT.md explicitly scopes this out of MVP, and it would be
  the first autonomous send in the product, breaking CLAUDE.md #4.

## Consequences
- Tests: `tests/db/compliance.test.ts` (7), `tests/db/onboarding.test.ts` (3), `tests/db/billing.test.ts` (3),
  `tests/db/growth.test.ts` (4) — all hand-worked, no test-oracle scenario exists for this phase.
- `scripts/seed/config.ts`'s demo orgs count as `active` Growth regardless of subscriptions, so the demo
  never expires or loses AI/WhatsApp.
- **Run by hand:** insert the founder's own `user_id` into `platform_admins` to use `/admin`; source real
  Bangladesh licence-reminder defaults and a VAT due-day default with an accountant; choose a payment
  provider before Pilot gate A's billing goes live; choose and wire a rate-limiting backing store before
  onboarding paying customers.
