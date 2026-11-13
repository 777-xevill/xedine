# ADR 0052 — Customers hear from Xedine only by browser notification

- Date: 2026-11-13
- Status: accepted (the founder's choice: "we don't want to send messages on WhatsApp; we want to send them as
  Chrome notifications. Customers allow our notifications through the QR code, the mobile number is stored, and
  the manager identifies them by mobile number at the bill desk. Delete service speed.")
- Changes ADR 0021 (campaigns and post-meal feedback queued WhatsApp messages) and ADR 0048 (push was an
  extra to WhatsApp; now it is the only channel)

## Decision
1. **No WhatsApp or SMS to customers.** `run_campaign` no longer writes to `message_outbox`. A customer is
   queued only if they consented **and** have an active `push_subscriptions` row (they ticked "Get notified"
   on the table QR page in a browser that allowed notifications). A consented customer without one is
   suppressed with reason `no_push` and counted in the run's result next to `holdout`, `no_consent` and
   `capped`. The holdout split, consent check, 7-day cap and draft → approve are unchanged.
2. **Post-meal feedback** (`job_feedback_requests`) is made only for customers with notifications on, and the
   link arrives as a notification ("How was your meal at …? Tap to tell us.") instead of a WhatsApp message.
3. **One sender.** `pushToCustomers` (src/modules/customers/jobs/push.ts) sends any customer notice; campaigns
   and feedback both use it. Same 30-phones-per-run limit as ADR 0048.
4. **The mobile number stays the customer's key.** Joining from the table QR stores it with the phone's
   subscription; at the till the cashier or manager types the mobile number in "Add customer"
   (`attach_customer`), which finds the same customer, so their visits, points and offers line up. Nothing new
   was needed for this.
5. **Service speed removed** from the Customers page (the "Service speed" tab). The kitchen-ticket data and
   `metric_service_slots` remain; only the page is gone.

## Consequences
- Customers who joined at the till only, or whose browser blocked notifications, receive no offers. The
  Campaigns page says so ("customers who did not allow notifications are skipped").
- iPhone Safari outside "Add to Home Screen" cannot get notifications (ADR 0048), so those customers are
  `no_push`.
- Owner-facing WhatsApp (briefs, alerts, the bazar list) is not affected: this ADR is about customers only.
- The consent rows written by the table page still say channel `whatsapp`/`sms` (ADR 0045); they are read as
  "agreed to marketing" and gate notifications. Not renamed, to avoid touching consent history.
