# Xedine — Architecture

## System view
```
 Cashier POS (PWA, offline) ─┐
 Kitchen Display (realtime) ─┤
 QR menu (optional) ─────────┼──► Next.js app (server actions + route handlers)
 Owner web dashboard ────────┤        │
 WhatsApp (owner/staff) ─────┘        ├──► Supabase Postgres (RLS) · Auth · Storage · Realtime
                                      ├──► Metrics layer (SQL functions/views) ◄─ single source of numbers
                                      ├──► Jobs (scheduled): refresh, leaks, forecasts, briefs, benchmarks
                                      ├──► LLM gateway → Anthropic API (tools = metric functions)
                                      └──► Messaging gateway → WhatsApp Cloud API / SMS (outbox + retries)
```

## Tenancy & security
- `organizations` → `branches`. `memberships(user_id, org_id, role, branch scope: all | list)`. One role per membership; a person holding two roles across orgs or branches holds two memberships.
- **Auth: email + password; managers join by invite** — the invite link creates the user and the `memberships` row together, so a manager can never exist without a branch scope ([ADR 0003](decisions/0003-auth-and-identity.md)).
- SQL helpers (security definer, fixed `search_path`, `stable`): `is_org_member(org)`, `has_role(org, roles[])`, `can_access_branch(org, branch)`, `can_access_branch_role(org, branch, roles[])`, `can_see_money(org)` — all in the non-exposed `private` schema, and every table is registered with a policy engine (`private.apply_policies` / `register_table`) that a test checks. Policies call helpers; wrap `auth.uid()` as `(select auth.uid())`; index every `org_id` / `branch_id`.
- **Money visibility:** cost, margin, profit and finding ৳ impacts are owner/accountant only, enforced at the metric-function layer via `can_see_money(org)` ([ADR 0007](decisions/0007-money-visibility-by-role.md)). The assistant inherits the caller's permissions.
- Shared POS devices: device registered to a branch; staff switch with a 4–6 digit PIN (hashed); every action records `staff_id` + `device_id`.
- Service role only in server jobs/webhooks, always with explicit `org_id` filters and tests.
- `audit_log` is append-only. Rate limits on auth, webhooks, AI endpoints.
- Platform admins have no tenant data access by default; support access is time-boxed and audited.

## Core entities (first pass — the real list lives in DATA-MODEL.md)
- **Tenancy:** organizations, branches, memberships, devices, staff, staff_pins, org_settings (VAT, service charge, cutoff hour, dayparts, week start, display), org_profile (cuisine, format, price band), org_context (owner-stated goals/rules), audit_log.
- **Menu & POS:** menu_categories, menu_items, item_variants, modifiers, branch_item_prices, price_history, tables, channels (commission %, fees), orders, order_items (price + recipe-cost snapshots), order_events (status timeline), payments, discounts, refunds, shifts, cash_counts, invoice_sequences.
- **Customers:** customers, consents, feedback, campaigns, campaign_sends, holdouts (visits derived from orders).
- **Costing & stock:** ingredients, units, unit_conversions, recipes, recipe_lines, suppliers, purchases, purchase_lines, purchase_drafts, reference_prices, stock_counts, stock_count_lines, waste_logs, transfers, transfer_lines.
- **Planning:** calendar_events, forecasts, forecast_accuracy, bazar_lists, bazar_list_lines.
- **Intelligence:** findings, finding_evidence, insight_feed, benchmark_snapshots.
- **Ops:** fixed_costs, salary_entries, advances, attendance, licences, reviews, review_replies.
- **AI & messaging:** ai_conversations, ai_messages, ai_tool_calls, ai_usage, prompt_versions, message_outbox, message_templates, webhook_events, chat_links, job_runs.
- **Billing:** plans, subscriptions, usage_counters, feature_flags.

## Metrics layer (semantic layer)
- Every metric in METRICS.md has an ID (e.g., `sales.net`, `items.qty_sold`, `food_cost.theoretical_pct`) and exactly one implementation: a SQL function/view in migrations, wrapped by a typed TS function in `src/modules/metrics`.
- Heavy aggregates: summary tables / materialized views per branch × business_date × item, refreshed by jobs (5–15 min for today, nightly for history).
- Dashboard, findings, briefs, benchmarks and AI tools all call the same functions. No duplicate formulas.
- Each metric returns `{ value, unit, as_of, filters, metric_id }` so AI answers can cite it.

## Analytics engines (deterministic)
- **Leak rules:** each rule is a module `detect(orgId, period) → Finding[]` with thresholds in config and tests on synthetic data.
- **Forecasting v1:** weekday seasonality × recent trend × calendar multipliers learned from history; WAPE vs naive (same weekday last week). Move to an ML service (Python) only if it clearly beats v1.
- Menu engineering, variance bridge, price watch, RFM, benchmarks: SQL + TS as defined in METRICS.md.

## AI layer
- `src/lib/llm-gateway` (server-only): the only place that calls models. Handles retries, timeouts, token/cost logging per org (`ai_usage`), per-plan daily caps, PII masking, prompt versioning.
- **Provider (ADR 0024):** `AI_PROVIDER=openai|anthropic`, default OpenAI when `OPENAI_API_KEY` is set. OpenAI goes through Chat Completions over `fetch`; `src/lib/llm-gateway/openai.ts` maps the gateway's message/tool shapes both ways, so every guard below applies to either provider. OpenAI defaults: `gpt-5-mini` (assistant) / `gpt-5-nano` (fast), `AI_REASONING_EFFORT=low`, extra prices via `AI_MODEL_RATES` — TODO(verify) ids and prices when the key is added.
- Models from env, never hardcoded (Anthropic defaults shown): `AI_MODEL_ASSISTANT=claude-sonnet-5` (assistant, explanations, vision for menu photos/chits), `AI_MODEL_FAST=claude-haiku-4-5` (extraction, classification, translation). Use the undated ID form — do not append date suffixes. Confirm both IDs against the Models API (`GET /v1/models`) at the start of Phase 3 and record them in the stack ADR.
- Rates verified 2026-09-22: Sonnet 5 $2/MTok in, $10/MTok out · Haiku 4.5 $1/$5 · cached prefix reads ~10% of the input rate · Message Batches 50% off. Cost model per org is in [ADR 0008](decisions/0008-provisional-pricing.md); re-check before launch.
- Cost control: prompt caching for the static system prompt + tool definitions (keep volatile content — timestamps, the user's question — *after* the last cache breakpoint, and verify with `usage.cache_read_input_tokens`); Message Batches API for nightly narratives and bulk extraction; precomputed metrics keep prompts small.
- **Assistant = tool use over the metric catalog.** Tools (first set): `get_sales`, `get_item_sales(item, window)`, `compare_periods`, `compare_branches`, `get_top_bottom_items`, `get_flash_pnl`, `get_findings`, `explain_finding`, `get_menu_matrix`, `get_stock_status`, `get_forecast`, `get_bazar_list_draft`, `get_customers_summary`, `get_reviews_summary`, `get_benchmarks`. Each returns data + `metric_id` + filters + `as_of`.
- **Guardrails:** numbers only from tool results (validator rejects, retries once, then falls back to a deterministic template); "I don't have that data yet" when tools return nothing; write actions only create drafts; never cross tenants; reply in the user's language (bn / Banglish / en); owner-stated `org_context` is respected.
- **Evals:** `tests/ai-evals` — golden questions with exact expected numbers from the synthetic dataset. Run before merging AI changes.

## Jobs (Asia/Dhaka, per-org configurable)
- Every 5–15 min: refresh today's aggregates; real-time alerts (e.g., void spike).
- After business-day cutoff (≈04:30): close the day, compute metrics, run leak rules, update forecasts, draft tomorrow's bazar list, queue briefs.
- 09:00 morning brief · 23:00 evening close (optional) · weekly review after the weekend · monthly benchmarks.
- Implementation: **Supabase `pg_cron` → authenticated job routes** ([ADR 0004](decisions/0004-scheduled-jobs.md)); long work chunked via a dispatcher that enqueues per-org work; every run logged in `job_runs`; idempotent per (job, org, period). Cron schedules are UTC; per-org Asia/Dhaka timing resolves inside the job from `org_settings`. `pg_cron` calls are fire-and-forget, so **`job_runs` plus an alert on missing runs is the only failure signal** and ships in Phase 0.

## Offline POS
PWA with cached menu/prices; orders get client UUIDs and go to an IndexedDB outbox; background sync with idempotency keys; server stores price snapshots and flags mismatches; visible sync status; printing works offline; alert when a device stays offline > N hours.

## Printing
Phase 1: browser print with 58/80 mm CSS templates (receipt, KOT). Later: optional local print bridge for silent KOT printing.

## Messaging
WhatsApp Cloud API: per-recipient opt-in, approved templates for briefs/alerts/campaigns, webhooks for inbound replies (Q&A, approvals), 24-hour service-window rules, outbox with retries and delivery status. SMS (Bangladeshi provider TBD) behind the same interface. Check Meta's current Bangladesh pricing before setting plan limits.

**Bazar by chat (ADR 0025):** a Telegram bot (WhatsApp later, same core) takes the purchaser's list as text, a voice note or a chit photo and answers with the lines and a ✅ button; only the tap records the purchase. The webhook runs as the service role but every write goes through a `chat_*` function that acts as the one person the chat is linked to (`chat_links`), so role checks and the audit trail are the web's. Typed lists are parsed without AI; voice goes through the gateway's `transcribe` (capped and costed).

## Integrations (later phases)
Google Business Profile (reviews) · weather API (forecasting) · reference prices via CSV import (e.g., TCB market prices) · delivery platforms via manual tagging/CSV · subscription payments (provider TBD) · CSV/Excel exports for accountants · lender-partner report (later).

## Observability & quality
Sentry for errors · structured logs · `job_runs` · `ai_usage` dashboard · CI (typecheck, lint, format, unit; a `database` job on real Supabase — DB tests incl. per-table RLS isolation, seed + manifest validation, generated data-model doc; an `e2e` job — Playwright; AI evals on AI changes). Without Docker, `pnpm db:test:embedded` runs the same DB suite on an in-process Postgres (ADR 0011) · backups (Supabase point-in-time recovery on a paid plan) · demo orgs from the seed for sales demos.
