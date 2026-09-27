# ADR 0021 — Phase 8 customers, retention and reviews

- Date: 2026-10-04
- Status: accepted (built unattended — **§3, §4 and §6 are choices the founder should confirm**)

## Context
Phase 8 must win the second visit and turn complaints into fixes: customer profiles with consent and RFM segments, a post-meal feedback link, automations and campaigns with frequency caps, opt-outs and holdout groups, reviews with themes and approved AI replies, and links from reviews to what the kitchen was doing. Two planted scenarios must surface: S11 (Dhanmondi Friday 20:00–22:00 ticket times double, with "slow" complaints) and S12 (Uttara regulars lapse after a price increase).

## Decision
1. **Segments in SQL, from completed orders with a customer.** `m_customers`: visits and spend in the last 90 days, last visit, usual gap. In order: *lost* = nothing for 90 days; *at risk* = a repeat customer whose days since the last visit exceed 2 × their median gap (at least 30); *regular* = 4+ visits in 90 days; *new* = one visit so far; otherwise *returning*. RFM scores 1–5 by quintile (recency only within a year). The list with phone numbers is owner/manager only (PII); the accountant sees the summary.
2. **Consent is the latest record.** `marketing_ok` = the newest WhatsApp-marketing consent row for the customer is "granted"; no row means no. STOP / unsubscribe / বন্ধ / বাতিল from the WhatsApp webhook records a refusal for every customer with that number (`record_opt_out`, service role).
3. **Caps.** At most one campaign message per customer in 7 days and three in 30 (holdout rows do not count). The same campaign never reaches a customer twice within 30 days; thank-you and second-visit never twice. *Confirm the caps.*
4. **Automations are approved campaigns with `auto_run`.** Kinds: thank-you (first visit yesterday), second-visit nudge (first visit two days ago, not back — the "48 h" rule), win-back (at risk now), custom (segment and branch). Nothing sends until an owner or manager approves the campaign (CLAUDE.md #4); `auto_run` is off by default and, when switched on, the morning job runs it for new matching customers. *Confirm that an approved campaign may run by itself each morning.*
5. **Holdout and lift.** Membership is a stable hash of (campaign, customer) below `holdout_pct`; holdout customers are recorded but not messaged. `metric_campaign_results` compares return rates (a completed order within 30 days of the send) and reports lift only when both groups have ≥ 30 customers.
6. **Feedback link.** Orders completed in the last three hours whose customer consented get one link per customer per week; the token is random, only its SHA-256 is stored, it works once and for 14 days. The public page `/f/[token]` reads nothing; `/api/webhooks/feedback` submits with the service role. *Confirm that the feedback link counts as marketing consent (it is sent only to customers who agreed to WhatsApp messages).*
7. **Themes are keyword rules, not an LLM** (`text_themes`, Bangla and Banglish included): slow service, cold food, taste, salty, portion, price, staff, cleanliness, wrong order, praise — tagged by trigger on reviews and feedback. Deterministic and testable; revisit with pilot data.
8. **Review replies.** AI drafts go through the gateway (review text only, no phone numbers) and are refused if they contain a number the review did not; a person may also write one; `approve_review_reply` is the only way to approve, and it is audited. Posting stays manual until the Google Business Profile API is approved (ADR 0010).
9. **Two detectors join the scan.** `service.slow_slot`: a weekday × two-hour slot with ≥ 12 orders whose median ticket time is ≥ 1.5 × the branch median; impact = sales in the slot; confidence high when ≥ 3 complaints match. `customers.lapse`: regulars of the 90 days before the period (home branch = most visits) who did not return; flagged when ≥ 20 regulars, ≥ 30% lapsed and ≥ 2 × the other branches' rate; impact = their 90-day spend scaled to the period; recent price rises at that branch are attached as evidence.
10. **Reviews ↔ operations.** `metric_review_context` shows that business day's median ticket time against the branch's usual, who was on shift and which menu items the review names.

## Alternatives considered
- **LLM theme tagging** — richer, but cost per review and non-deterministic; keywords first.
- **Lift without a holdout** (before/after) — confounded by seasonality; rejected.

## Consequences
- Seed: customer pools per branch with consent history, 35% of non-platform orders identified, feedback on 25% of identified dine-in orders; S11 and S12 planted with facts; CI checks them at SEED_PHASE=8.
- Local run on the seed: S11 detected with the exact slot and order count; S12 impact matches the manifest exactly (Uttara: 50 of 74 regulars lapsed).
- **Run by hand:** create the `campaign` and `feedback_request` WhatsApp templates in Meta.
