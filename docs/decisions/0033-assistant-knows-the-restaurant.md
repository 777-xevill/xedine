# ADR 0033 — The assistant that knows the whole restaurant

- Date: 2026-10-10
- Status: accepted

## Context
The assistant answered questions through 18 tools but started every conversation knowing nothing: not the restaurant's shape, not the app, not what the person was looking at, and it only lived on the Sales and Stock pages. The owner asked for an agent that "knows the restaurant from A to Z", the way a coding agent knows a codebase, on Groq now and on OpenAI later.

## Decision
**It is on every page.** `GlobalAgent` sits in the org layout (owner, manager, accountant: whoever has the chat), so an open conversation follows the person between pages. Sales and Stock keep their own richer helper (ADR 0032); the global one steps aside there and on the chat page. Each question carries the page (`page`, `pageNote`), so "explain this" works anywhere. The first tap asks what matters on that page; the chips cover the whole restaurant (today, losses, sales, stock, a tour).

**It starts knowing the restaurant.** The *Restaurant card* (`card.ts`) is put in front of every question: name, branches, who is asking and their role, which sections are switched on or off, menu / recipe / ingredient / supplier / staff counts, VAT, service charge, day cutoff and loss line, and the page open now. Names, counts and settings only; no sales or money, which still come from metric tools. It is read with the asker's own session. It is also a source for the numeric validator, so a count quoted from it is not rejected.

**It knows the app.** `find_page` (`app-guide.ts`) maps a topic (English, Banglish or Bangla) to the page, its path, what it does, and whether this person can open it, with the reason and the fix when not ("switched off: Settings → Features", "not for your role"). Who may open what comes from `buildNavigation`, not from the guide. Under an answer the panel offers "Open Stock" buttons (`links.ts`): the page each tool belongs to, only pages the person can open, never the one they are on, at most three.

**It knows what to do.** `get_today_brief` is the place to start for "what should I do": today's sales and pace against a normal day, the biggest open leaks, what runs out, the loss between the last two counts, licences and tax due within 14 days, and the setup steps left with the page each is done on. Anything the person may not see is left out by the underlying metric. New read tools: `get_menu` (items, price, recipe or not, food cost %), `get_compliance`, `get_staff_exceptions` (discounts, voids, refunds per person: "things to check, never accusations").

**Read-only.** The assistant advises and says which page to use. It changes nothing (CLAUDE.md #4: AI that changes data or reaches people is a draft a human approves, and none of these tools write).

**Prompt v5** rewrites the role ("the restaurant's AI manager"), says how to work (brief first for broad questions, dig into the biggest cause, end with one to three next steps with pages, missing data is an answer) and keeps the number, loss and language rules.

**Provider.** Unchanged and already switchable: `AI_PROVIDER=groq|openai|anthropic` plus the key (ADR 0024). Moving from Groq to ChatGPT is `AI_PROVIDER=openai` and `OPENAI_API_KEY`, and `AI_TOOLS=all` once the plan can carry every tool.

**Tools are chosen per question (`tool-select.ts`).** Every tool definition goes with every model call: all 23 are about 3,000 tokens, and Groq's free plan allows 8,000 tokens a minute, so one question overran it. A question gets the brief and the app guide, plus the groups its words (English, Banglish, Bangla) and its page point at. `AI_TOOLS=all` turns this off. Tool descriptions were also shortened.

## Alternatives considered
- Putting the whole app guide in the prompt: ~1,000 tokens on every call for something needed in a minority of questions; a tool costs tokens only when used.
- A model call to choose tools: an extra round trip and tokens to save tokens; keywords plus the page are enough, and the brief covers broad questions.
- Letting the agent act (add a supplier, switch a feature on): a different, larger decision; drafts and approvals first.
- Remembering conversations across sessions: the chat history and owner rules already exist; revisit with real usage.

## Consequences
- A broad question is answered from the brief in one tool call; a drill-down in the next question reaches the right tools through its words or page.
- A question phrased without any topic word on a page with no group (for example a vague one on Home) sees only the brief and the guide; the assistant then says what it can show and the chips guide the next step.
- The card adds about 400 tokens to each call.
- Groq's plan is still the ceiling: roughly one full answer a minute. OpenAI removes it.
