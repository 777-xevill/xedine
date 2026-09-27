# ADR 0017 — Phase 4 owner assistant, insight feed and the WhatsApp rhythm

- Date: 2026-09-30
- Status: accepted (built unattended — **§2 and §5 are choices the founder should confirm**)

## Context
Phase 4 needs an assistant that answers in Bangla, Banglish or English with exact, cited numbers; a restrained insight feed; and briefs on WhatsApp. Two external blockers apply (ADR 0010): an Anthropic API key, and Meta business verification plus template approval for WhatsApp.

## Decision
1. **Tools over metric functions, with the asker's session.** `src/modules/assistant/tools.ts` wraps the Phase 2–3 metric RPCs; each result carries `metric_id`, filters and `as_of`. They run with the caller's Supabase session, so a manager's money question returns `not_permitted` (ADR 0007).
2. **Numbers only from tools.** The model's answer passes `validateNumbers` (every number must appear in a tool result, in poisha/taka/percent form, or in the question) or is retried once with the offending numbers named; failing that, a deterministic template answers. *Confirm that a retry-then-template policy is acceptable (vs. refusing outright).*
3. **A deterministic router** (`router.ts`) reads the common questions (item counts by window, sales, top items) in all three languages. With no AI key it is the whole assistant; with one it is the fallback. It never produces a number, only picks a tool.
4. **Jobs and webhooks read metrics as the service role**, for one explicit org: `private.metric_scope` / `require_money` allow the service role (JWT role claim), everything else unchanged.
5. **Insight feed**: at most three a day per org, ranked impact × confidence × novelty (novelty = 1 ÷ (1 + times the same type and subject were shown in 28 days)); a finding is never shown twice; dismiss needs a reason and dismisses the finding; snooze needs a date. *Confirm the novelty rule.*
6. **Messaging gateway**: an outbox drained every two minutes with backoff (1, 2, 4… minutes, max 60) and five attempts; WhatsApp Cloud API transport behind an interface; nothing sends until a transport is configured (`WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`, or `MESSAGING_TRANSPORT=mock`). Briefs go only to an owner number with an explicit opt-in timestamp. The webhook checks Meta's signature, logs each event once, updates delivery status, and answers the owner's texts with the assistant.
7. **Evals**: 40 golden questions generated from the seed manifest (5 windows × 2 orgs × en / en variant / Banglish / Bangla), run in CI after the seed through the real assistant path (router without a key, LLM with one). Pass: ≥ 95% exact.

## Alternatives considered
- **Service-role tools for the web chat** — simpler, but the assistant would stop inheriting the caller's permissions.
- **Refuse on a failed numeric check** — strictest, but owners would see "I can't answer" for questions the deterministic path answers exactly.

## Consequences
- The assistant is useful on day one without a key; answers with a key are still checked.
- Approvals by WhatsApp reply (roadmap) wait for something to approve: bazar lists (Phase 7).
- **Revisit** the Graph API version and template names at go-live (TODO verify); the eval set grows with Phase 5+ tools.
