# ADR 0024 — Light workspace redesign, feature switches, OpenAI provider

- Date: 2026-09-29
- Status: accepted (founder request)
- Supersedes: ADR 0009 "dark is the only theme"; ADR 0015's glass-on-dark styling. ADR 0009's other rules stand.

## Context
After using the built app, the founder said the UI was too dark and showed too many options at once
(~20 top-level links by Phase 10). They asked for a clean, light, friendly, premium SaaS look with **no
black background**. After sign-in it should work like a chat app: a simple sidebar and one workspace,
with chat history in the sidebar. The references were a chat-composer video (a composer that grows
from a pill into a card, with a soft gradient glow) and a request to hide advanced features in Settings
until needed. The home screen should answer "How is my restaurant doing?" and "What needs attention?",
with stock and restaurant health first. The assistant should use the **OpenAI API**.

## Decisions

### 1. Light theme built from the guideline palette
- The guideline's colours stay verbatim as raw tokens (`--palette-*`, the four accents, the status
  colours). The light theme maps onto them: page = guideline mist `#F7F8FC`, text = guideline navy
  `#0D1120`, secondary/muted text = guideline slates. Neutrals in between (borders, hover fills) are
  `color-mix` blends of those, not new hues.
- Bright accent and status colours fail AA as text on white, so the Tailwind colour utilities
  (`text-success`, `text-danger`, …) resolve to **ink** variants: each brand colour mixed with the
  guideline navy (all ≥ 4.5:1 on white). The brights remain for dots, bars and fills (`*-bright`).
- Primary action: purple → deepened blue gradient with white text (5.6:1 and 6.4:1). The four-colour
  gradient is reserved for the logo, the composer halo and decorative glow — never behind a figure.
- `logo.png` is dark-background only, so it always appears inside its own rounded app-icon tile.
- POS and KDS inherit the light theme with solid (unblurred) surfaces, which also suits bright dining
  rooms better than the old neon-on-black.
- `prefers-contrast: more` strengthens borders; `prefers-reduced-transparency` removes blur and glow.

### 2. Sidebar + workspace shell
- Sidebar: restaurant/branch switcher, **New chat**, core sections, full-screen screens (POS, Kitchen),
  **Recent chats** (the person's own `ai_conversations`, most recently active first), and at the
  bottom Settings, the account and the language switch. On phones and tablets it is a drawer.
- Core sections: Home · Stock · Sales · Money leaks · Menu (each still role-filtered).
- Setup screens (Team, Staff, Branch setup, Costs, Billing, Setup checklist, Assistant rules) moved out
  of the navigation into Settings, which has one tab bar across them.
- The model lives in `src/modules/tenancy/navigation.ts` (pure, unit-tested).

### 3. Optional modules are switched on in Settings → Features
- Recipes & food cost, Purchases, Forecast & bazar list, Customers & marketing, Reviews, Branch
  comparison, Licences & VAT, Staff records start **hidden**. The owner switches them on.
- Stored as `org_settings.enabled_features text[]` (migration `20261011000001_ui_features.sql`): it
  inherits org_settings' RLS (members read, owner writes) and audit trigger. Keys are validated in the
  app, so a new module needs no migration.
- **Presentation only.** Hiding a link never changes access: pages and RLS still decide. A module that
  is a role's whole job stays visible to that role regardless (a purchaser always sees Purchases; the
  kitchen always sees Recipes and the Plan).

### 4. Chat-first assistant
- `/[org]/assistant` is a full-height chat. With no conversation it shows the reference video's
  centred greeting and glowing composer, plus starter questions. The starter questions are tested to
  route to the deterministic router in both languages, so they work with AI off.
- Home has the same composer: asking there starts a conversation and opens it.
- Enter sends, Shift+Enter adds a line; the question shows at once with a thinking indicator.
- Continuing a conversation bumps `ai_conversations.updated_at` (injected clock) so the sidebar
  orders chats by last activity.
- The owner's goals/rules moved to Settings → Assistant, with an AI on/off status.
- Prompt v3 asks for plain text (no Markdown), because answers render in a chat bubble.

### 5. OpenAI as the default AI provider
- `AI_PROVIDER=openai|anthropic`; default OpenAI when `OPENAI_API_KEY` is set, else Anthropic when
  `ANTHROPIC_API_KEY` is set, else AI is off and the router answers.
- OpenAI is called through **Chat Completions over `fetch`** (no new dependency). A pure mapping layer
  (`src/lib/llm-gateway/openai.ts`, unit-tested) translates the gateway's message/tool shapes to
  OpenAI's and back. So the **existing gateway guards all still apply**: daily cap, plan check, PII
  masking, schema validation, refusal/truncation handling, per-call cost logging, and the assistant's
  numeric-consistency validator with retry and deterministic fallback (CLAUDE.md #1).
- Defaults `gpt-5-mini` (assistant) and `gpt-5-nano` (fast), overridable with `AI_MODEL_ASSISTANT` /
  `AI_MODEL_FAST`; prices for other models via `AI_MODEL_RATES`. Reasoning models get
  `reasoning_effort` (`AI_REASONING_EFFORT`, default `low`) and 4,000 tokens of thinking headroom.
  **TODO(verify)** model ids and prices against OpenAI's pricing page when the key is added.
- Network errors, timeouts and non-2xx responses become `AiError`, so the assistant falls back to
  the router instead of failing.

## Consequences
- Easier: far fewer visible choices; one consistent light style; the assistant is the front door.
- Harder: the dark-only accessibility numbers in BRAND.md were recomputed for light (ink variants).
- `pnpm db:docs` must be regenerated for the new column (done without Docker, see WORKLOG method).
- The e2e tests' selectors (`org-name`, `role`, `branches`, the language buttons, `/settings` h1) are
  preserved in the sidebar and Settings.

## Amendment (2026-10-02): Groq as a third provider
The founder asked to use Groq for now. Groq's API has the OpenAI wire format, so `AI_PROVIDER=groq` reuses the OpenAI mapping in `openai.ts` with its own address (`GROQ_BASE_URL`, default `https://api.groq.com/openai/v1`), key (`GROQ_API_KEY`) and models (default `qwen/qwen3.8-27b` for both roles: tools, JSON-schema output and photos, checked against the founder's account — the `openai/gpt-oss-*` models there are text-only); `openai/gpt-oss-*` get the reasoning headroom like OpenAI's reasoning models. Voice notes use Groq's `whisper-large-v3` when Groq answers text or is the only key. Order when `AI_PROVIDER` is unset: OpenAI key, Groq key, Anthropic key. On a Bangla chit image Qwen read names and numbers with a few slips (`পেঁয়াজ`→`পাঁয়াজ`, ৫→৪), which is why every drafted list is reviewed by a person. **TODO(verify)** Qwen's price and Bangla speech accuracy.
Checked against the founder's Groq account on 2026-10-02: the Llama models first named are not on it (only `openai/gpt-oss-120b`, `gpt-oss-20b`, `qwen/qwen3.8-27b`, two Whisper models); the limit is **8,000 tokens a minute per model**, and one assistant question is two calls of about 2,800 tokens, so a second question inside a minute got a 429 and fell back to the router. A 429 on a text request is now retried once on `GROQ_FALLBACK_MODEL` (default `openai/gpt-oss-120b`, its own allowance; photos stay on Qwen). Live checks: the assistant answered from stock data with the numeric check passing, and Bangla spoken-number text ("আঠারোশো টাকা") was extracted correctly. Voice (Whisper) is not yet tried with a real voice note. A paid Groq tier or a shorter tool list would remove the limit.
