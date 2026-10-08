# ADR 0032 — Sales charts and the page helpers (Sales, Stock)

- Date: 2026-10-09
- Status: accepted

## Context
Owners opened the Sales explorer and saw a table and a "Takeaway" filter they never use. They asked for charts anyone can read at a glance, and for an AI that explains the page when asked.

## Decision
**Channel filter**
- The Channel dropdown lists only channels that have at least one order, and shows only when there are two or more (or one is already selected by link). A dine-in-only restaurant never sees it. No setting.

**Charts** (all from existing metric functions; the page only orders and zero-fills rows for an axis)
- *Busiest hours*: one column per hour in business-day order (a 04:00 cutoff puts 01:00 after 23:00); quiet hours between the first and last sale are zero. The busiest hour gets the one direct label.
- *Sales by day*: for multi-day periods, `sales()` per business date (up to 31 calls). If this gets slow, add a `day` dimension to `metric_sales_split`.
- *Items sold*, *time of day*, *channel*, *payment method* and *branch* as ranked single-hue bars with money and order counts.
- One brand hue (magnitude, not identity), tap/hover tooltip on every column, Bangla clock words ("রাত ৮টা").

**Page helper**
- An "Explain my sales" button docked on the page. **Nothing runs until it is tapped** — the Groq plan allows about one answer a minute, so an automatic summary on every page view would exhaust it.
- The first tap asks the page's summary question (period and branch in words) through the same assistant, tools, numeric validator and permissions as the full chat (`askHereAction`, no redirect). Follow-up chips and a typed question continue the same conversation, which is kept in the chat history and can be opened there.
- The model's answer is shown with ₹ written as ৳ and, for Bangla answers, Bangla digits (`forReader`, after validation; the validator and evals read both digit sets).

- **The same helper sits on the Stock page** (owner, manager, accountant only; the kitchen and purchaser roles never get the assistant). Its summary question follows the tab and branch: *In stock* (what I have, what runs out first, what to buy), *Loss* (which items and why) or *Waste* (biggest reasons, how to cut it), with starter questions per tab. `PageAgent` takes its wording as `labels`, so a page adds a helper with only messages and a question.
- `get_stock_status` lists the 15 most urgent ingredients (red, then yellow, then fewest days) plus a `summary` of counts, instead of 40 in database order. The full list overflowed the model's request limit (Groq 413) on the Stock page's summary question; the shortcut answer shows 10, so it is unaffected.
- Every question now also carries an explicit "answer only in English / only in Bangla" line: the model had answered an English question in Bangla.

## Alternatives considered
- A Settings switch per channel: more work for the owner; the order history already says which channels are used.
- An automatic AI summary on page load: rejected for the rate limit and cost.
- Opening the full chat page instead of a panel: the owner wanted to stay on the page with the charts.

## Consequences
- When the AI is rate-limited, the deterministic router answers what it can (for a summary question: top items), as everywhere else.
- AI money is shown to the poisha the model saw (৳8,990.5) while the page rounds to whole taka (৳8,991).
