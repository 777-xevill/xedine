# ADR 0026 — The Stock page in plain words

- Date: 2026-10-02
- Status: accepted (built at the founder's request — **§3 and §5 are choices the founder should confirm**)

## Context
The founder tried the Phase 5 Stock page and found it too hard for the people it is for: owners in Bangladesh who have never kept a stock book. Looking at the live page confirmed it. "Counts & gaps" was a ten-column table (Counted before · Bought · Transfers · Counted now · Actually used · Recipes say · Waste logged · Gap · Gap ৳) whose headings ran together and whose money column fell off the right edge; on a phone only the first three columns were visible and the "Transfers" tab was clipped. "Actually used" and "Recipes say" were correct but meant nothing to a non-accountant. The Bangla/English switch sat at the bottom of the sidebar, hidden in a drawer on phones, and in Bangla mode ingredient names and count dates were still English (the demo ingredients had no Bangla name).

## Decision
1. **Three sections, each with its own big icon** (tiles, not small tabs): **In stock** (boxes), **Missing** (box with a magnifier), **Waste** (bin). The **Transfers** tab is removed. Transfers keep their tables, RPCs, seed data and tests (they still feed the leak detectors); only the screen is gone. To bring it back, restore it from commit `e418a2b`, ideally behind Settings → Features (ADR 0024).
2. **In stock** answers "what do I have, and what must I buy?": one banner (running low / all fine / start by counting), a *Count your shelf* card with two buttons (**Quick count** = the old guided count, **Count everything**), then every ingredient as a row under a plain heading — *Running low · Getting low · Enough · Not counted yet* — shortest-lasting first. The headings are the existing METRICS.md cover bands (🔴 / 🟡 / 🟢 / unknown); "days of cover" is now a sentence ("About 3 days left"). The "Last counted" and "On the way" columns are gone (the last count date is in the count card).
3. **Missing** (was *Counts & gaps*) shows only what an owner can act on. The page's words for the two terms the founder flagged: **"Should have used"** = what the recipes say (`usage.theoretical`) and **"Really used"** = what actually left the shelf between the two counts (`usage.actual`), drawn as two bars to scale with the same icons everywhere. A *gap* is called **missing** — more went than the recipes and the logged waste explain (`variance.usage_qty` > 0), with its ৳ for owner and accountant only (ADR 0007). Items inside the healthy band (METRICS.md: under 2%) are folded away; items that used *less* than the recipes say are listed apart ("a recipe may be too generous or a count off"); the full sum behind any item (had + bought − left = really used, minus recipes and waste = missing) is one tap away; the period picker and the food-cost bridge are folded away too. *Confirm the words "missing" / ঘাটতি for an unexplained gap* — it is not an accusation, but "missing" is stronger than "variance".
4. **No new numbers.** Every figure is still `metric_stock_status`, `metric_stock_variance` or the Phase 6 bridge; `src/modules/inventory/simple.ts` only groups, sorts and scales bars (unit-tested). ৳ amounts on this page are rounded to whole taka by the shared formatter; the bridge keeps poisha so its parts still add up.
5. **A Bangla / English switch in the page header** (Stock and the count sheet), not only the sidebar. Dates use the reader's language and digits. The demo ingredients now have Bangla names (seed and dev database), so Bangla mode reads Bangla end to end. *Open:* there is no screen yet for an owner to give their own ingredients a Bangla name, so an owner's own ingredients still show in English until there is one (the Telegram bot already stores a Bangla name when the item is typed in Bangla).
6. A short **"How does stock work?"** card (you buy → you sell → you count) is open on a branch that has never counted, and one line when closed everywhere else.

## Alternatives considered
- **A table with fewer columns** — still a table on a phone, and "Used / Recipes say" would still need explaining.
- **Hiding Transfers behind Settings → Features now** — the right home if multi-branch owners ask for it back; more to build than the founder asked for.
- **Translating ingredient names on the fly** — a hard-coded dictionary guesses wrong on names an owner chose; a name editor is the honest fix.

## Consequences
- The owner reads the page top to bottom in a minute: one banner, what to buy, what is missing, what was thrown away.
- Multi-branch owners can no longer record a transfer from the app until it returns (see §1).
- `stock.*` messages were rewritten; `errors.transferInvalid` and the old column labels are gone. Home's stock watch still uses `stock.days` and `stock.noUsage`.
