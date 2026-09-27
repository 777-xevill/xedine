# ADR 0016 — Phase 3 recipe costing, menu engineering and the LLM gateway v0

- Date: 2026-09-29
- Status: accepted (built unattended — **§3 and §5's default cap are choices the founder should confirm**)

## Context
Phase 3 turns recipes into a cost for every plate, classifies the menu, and introduces the first model call (recipe drafts). It had to respect ADR 0007 (cost is owner/accountant-only, in SQL), ADR 0012 §3 (cost never on a row managers read), CLAUDE.md #1 (models never produce figures) and #4 (drafts need approval), and it had to recover S3 in full, S4 and S5 from the seed.

## Decision
1. **Price history, not a single price.** `ingredient_price_history` (money-gated) holds what an ingredient cost from a business day on; a manual price change writes today's row by trigger. `private.ingredient_unit_cost(org, ingredient, date)` reads it. Purchases (Phase 5) will write the same table.
2. **Snapshots beside the line.** The Phase 0 `order_item_costs` table (money-gated) gets branch, order, item, business date and total cost columns; a trigger on `order_items` writes the snapshot at sale from the active recipe and that day's prices. Bulk loads set `xedine.bulk_load` and call `private.backfill_item_costs` once; saving or approving a recipe backfills the last 90 days' uncosted lines. A snapshot is never rewritten.
3. **Menu engineering `n`** (METRICS.md open question 4) = items sold in the period and branch scope. Popularity is high when an item's unit share ≥ 0.7 ÷ n; margin is high when its contribution per unit ≥ the unit-weighted average over costed items. An item whose sold lines are not all costed is `unknown`, never guessed. No minimum-volume floor yet. *Confirm.*
4. **Margins are structural findings**, reported monthly: `margin.below_target` (item food cost % above `org_cost_settings.target_food_cost_bps`, impact = cost above target) and `channel.negative_margin` (an item that loses money on a platform after its commission — S3 in full). Both carry evidence rows by day.
5. **LLM gateway v0** (`src/lib/llm-gateway`): the official `@anthropic-ai/sdk`; models from `AI_MODEL_ASSISTANT` / `AI_MODEL_FAST` (defaults `claude-sonnet-5` / `claude-haiku-4-5`, ARCHITECTURE.md); a code-versioned system prompt sent as a cached block; structured output (`messages.parse` + Zod) re-validated after parsing; refusals, truncations and malformed answers are recorded (they cost tokens) and rejected; PII (Bangladeshi phones, e-mails) masked before sending; per-org daily cap (`AI_DAILY_CAP_USD_MICROS`, **default $1/day**) checked before every call; usage and cost written to `ai_usage` through a service-role-only RPC. The gateway is the one non-job module allowed the service-role client (lint rule updated), always with an explicit org. *Confirm the cap.*
6. **Recipe drafts** live in `recipe_drafts` (the chef — kitchen role — can write and edit them); only `approve_recipe_draft` (owner) turns one into an active recipe, creating unpriced ingredients by name. An unpriced ingredient makes the recipe's cost "incomplete", shown as such, never estimated.

## Alternatives considered
- **A cost column on `order_items`** — simplest, but managers read `order_items`; ADR 0012 §3 rules it out.
- **Recomputing cost from current prices at report time** — makes history move when a price changes; METRICS.md asks for snapshots.
- **Raw `fetch` to the Messages API** — no dependency, but the project guidance is the official SDK, which also gives structured-output parsing and typed errors.

## Consequences
- The seed plants S4 (beef +44% for four weeks from week 20), S5 (Kala Bhuna a Puzzle, Shahi Tukra a Dog) and S3's negative combo margin on foodpanda; `pnpm manifest:validate` (SEED_PHASE=3) recomputes them with independent SQL and `pnpm metrics:validate` holds the detectors and matrix to them.
- Nothing AI works until `ANTHROPIC_API_KEY` is set on the server; the UI says so and recipes can be written by hand meanwhile.
- **Revisit** §3's floor once pilots show how often a new item flips others' classes; prompt versions move to `prompt_versions` when there is more than one prompt to manage.
