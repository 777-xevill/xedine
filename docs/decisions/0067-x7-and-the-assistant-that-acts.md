# ADR 0067 — X7, an assistant that knows the world, and changes it makes with one tap

- Date: 2026-11-19
- Status: accepted (the founder: "treat this like our own AI… it should know everything like ChatGPT and
  Claude Code… add the model X7 by plan… normal model is Groq, powerful model is OpenAI, for the test use
  Gemini… it can control the whole restaurant in one prompt, like Claude Code in VS Code")

## Context
The assistant (ADR 0017, 0024, 0033) read the restaurant well but stopped there: it would not answer a
general question (a recipe, a food-safety rule, a marketing idea) and it could not change anything, only
point to a page. The founder wants it to be Xedine's own AI: as knowledgeable as ChatGPT, with a stronger
model on the bigger plans, and able to run the restaurant from one message the way Claude Code edits a
project. The home page's prices already promised "the strongest AI" (`deepAi`) — Starter 3, Pro 20, Partner
50 a week — marked "coming soon".

Two non-negotiables frame it: numbers about the restaurant come only from the metric tools (CLAUDE.md #1),
and anything AI-made that changes data waits for a person's approval (#4).

## Decision

### 1. Two models, X7 by plan
- **Xedine** (everyday): the provider of ADR 0024 (Groq's gpt-oss-120b today), no weekly limit beyond the
  daily allowance.
- **X7** (strongest): its own provider and model (`X7_PROVIDER`, `X7_MODEL`; OpenAI when `OPENAI_API_KEY`
  is set, else Gemini when `GEMINI_API_KEY` is set). It gets every metric tool (the everyday model gets the
  groups its words point at), every change tool, 16 tool steps instead of 8, and thinks harder
  (`X7_REASONING=medium`).
- **For the test, Gemini.** The founder's free key (a new Google project "Xedine", key "Xedine X7") on
  2026-11-19: Pro models have no free quota, and 3.5/3.7/3.8 Flash took ~60 s even to say "hi". X7 therefore
  runs on **Gemini 3.5 Flash-Lite** (~5 s a step with 45 tools), falling back to 3.1 Flash-Lite when Google
  says busy (429/503) or does not answer in 45 s; once a model answered, the rest of the question stays on it
  (Gemini 3 signs each tool call with a "thought signature" that must come back on the next turn, and only
  to the model that wrote it — kept on the tool-use block, `extra_content`). Moving X7 to 3.5 Flash or to
  OpenAI is one setting.
- **Counted per question, per business week** (Monday start, the restaurant's business date): `plans.limits.
  x7_per_week` — Starter 3, Growth and Chain 20 (Pro on the home page). `use_x7` counts a question only when
  X7 itself answered; `x7_allowance` feeds the composer's switch ("X7 · 17 left this week") and Settings →
  Usage. Used up or busy: the everyday model answers and the reply says so. Owner, manager and accountant
  (the roles that chat).
- The pricing row is no longer "coming soon". Partner (50 a week) waits for that plan to exist in `plans`;
  Starter has `ai: false` in this database (ADR 0008's plans), so it has no X7 until the plans are reconciled
  with the home page's.

### 1b. X7 on Groq (the founder, later the same day)
The founder moved X7 to Groq (`X7_PROVIDER=groq` in wrangler.jsonc; the Gemini key stays set). Groq's account
has three text models — gpt-oss-120b (the strongest, also the everyday model), Qwen 3.8 27B, gpt-oss-20b — each
allowing **8,000 tokens a minute for the whole platform** (Qwen 7,000 input). One X7 step resends the
conversation (~4,500–5,000 tokens) and X7 with every tool would be ~9,000, so on Groq:
- X7 is gpt-oss-120b thinking harder (`X7_REASONING=medium`) with up to 16 steps, and **picks the tools the
  question needs** like the everyday model (`x7AllTools()`; `X7_TOOLS=all` on a paid Groq plan).
- A refused (429) call goes to each other text model in turn, each with its own allowance (every Groq call,
  not only X7's); when all are used up, X7 **waits** for the soonest reset Groq gives, up to 45 s, three times,
  instead of failing (the everyday assistant waits once, up to 15 s).
- The prompt (v9) asks for every tool the model already knows it needs in one turn: fewer turns, fewer tokens.
- Measured 2026-11-19: the multi-part request (dish, price, party order, borhani) ~30 s with three changes
  prepared; a Bangla sales question ~14 s; a food-safety question ~2 s.

### 2. It knows the world
- The prompt (v8) tells it to answer general questions fully, as ChatGPT does: cooking and recipes, food
  safety, nutrition, hospitality, marketing, business, Bangladesh and the world, writing.
- **Web tools** for what changes or is unsure, free and open: `web_search` reads Wikipedia's API (English,
  and Bangla for a Bangla question; DuckDuckGo refuses servers, Groq's search models are not on the account);
  `read_web_page` reads a public page (http/https on 80/443, no IP or local host, 12 s, 6,000 characters).
  Google Search through Gemini is built and switched off (`X7_GOOGLE_SEARCH=on`): Google gives it no free
  quota; it goes through the gateway's plan, allowance and cost record like every call. Web text is data,
  never instructions; a change is never prepared because a page says so.
- "From the web:" under an answer lists a page the person linked, and a search result only when the answer
  talks about it.

### 3. Numbers: the records stay strict
`judgeNumbers` (validator.ts):
- An answer that read the restaurant's records, or a question the router knows is about them, is checked as
  before: **every** figure must come from a tool, the card or the question.
- An answer from general knowledge alone (no records read) may keep its own figures — 75 °C, 2 cups, 1600 —
  and is labelled **"General knowledge"**, never "Numbers checked" (`numeric_check = 'general'`).
- **Money amounts and percentages always need a source**, in any answer, both ends of a range ("৳300–400",
  "30–35%"), in any currency sign or word.
- When one answer has both, the general part comes last after a line "General knowledge:" ("সাধারণ জ্ঞান:");
  figures above the line follow the records' rule. The model is told so and is sent back once when it does
  not; then the deterministic answer replaces it, as before.

### 4. Changes with one tap
- Twelve kinds the model may prepare (`propose_<kind>`): add a menu group, add a dish, change a price, take a
  dish off or put it back, tell Xedine about a special day (with how busy), a party order, record the bazar
  (new items added with it), write down waste, add a supplier, a monthly cost, the usual food cost, a rule to
  remember. Each prepared change is checked when the model proposes it (`prepareAction`: names to ids, every
  amount, dates, branch, who may do it) and the model is told exactly what is wrong when it is not, so it can
  fix it or ask (e.g. "which branch: Dhanmondi, Mirpur, Uttara").
- **Nothing changes then.** The prepared changes are saved in `ai_actions` (private to the person who asked,
  inserted only as `proposed`) and shown under the answer with a tick each, "Do these changes" and "Not now".
  Making them runs the same table write or RPC the page uses, **with that person's own session**, in the
  order prepared (a new group before the dish in it), each one on its own. A change is claimed first
  (proposed → running, so a double tap cannot make it twice), then done or failed with the refusal's words;
  good for 24 hours; audited (`ai.action`, with what was sent) on top of the RPC's own audit.
- Who: the roles the page and its SQL allow (`ACTION_ROLES`; menu, purchases, costs and rules are the owner's;
  managers may plan the day and write waste). The SQL still decides.
- The web chat and the page helper offer it; Telegram and WhatsApp do not (no list to tap).

## Consequences
- The owner can say "add Chicken Tehari at 220 in Rice, raise kacchi to 360, plan 30 kacchi for Friday and
  tell me how to make borhani" and get the recipe plus a list of changes to tap.
- CLAUDE.md #1 now reads, in practice: figures about the restaurant only from tools; general knowledge may
  carry its own figures, labelled, never money or percentages without a source.
- Free tiers are the limit for the test: Groq allows 8,000 tokens a minute per model for all restaurants
  together, so X7 picks its tools and waits for the allowance; a big X7 request takes ~30 s, longer when other
  restaurants are asking at the same time. Groq's Dev tier (paid) lifts this and lets X7 carry every tool.
- Open for the founder: the X7 provider for real customers (a paid Groq tier, OpenAI, or Gemini with billing for
  3.5 Flash and Google Search); Partner's 50 a week and Starter's 3 once the plans table matches the home page.
