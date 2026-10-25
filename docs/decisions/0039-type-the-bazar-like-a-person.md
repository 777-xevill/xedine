# ADR 0039 — Type the bazar like a person says it (Purchases form, new items, "Tell Xedine")

- Date: 2026-10-26
- Status: accepted (built at the founder's request)

## Context
The Purchases form showed six rows, each with a long "Choose ingredient…" dropdown listing every item. The purchaser had to hunt through the list, and a thing not in the list could not be bought at all (it had to be added elsewhere first). The founder wanted: one row, type the name, Xedine finds it in stock by itself, ask "is it a new item?" when it is not, and a pop-up on the page where the purchaser just says the list like a person.

## Decision
1. **One row to start, "Add another item" for more.** Each row is: a typing box for the item, quantity, unit, and what was paid. Typing shows a short list of close items (English name, Bangla name, learnt spelling, bazar word such as *murgi* → chicken, close spelling); tapping one picks it.
2. **Detected by itself.** If what was typed matches an item (`matchIngredient`, the rule the Telegram bot already uses), the row says "In your stock: Chicken" and the unit box offers only the units that fit it. A match that is not an exact name has a "Not this — it is new" link.
3. **Not found → "Is “x” a new item?"** with *Yes, new item* and up to three "Or is it …?" buttons (`suggestIngredients`). The purchaser must answer before Save works; a typo is never silently turned into a new item. A confirmed new item shows a "New item" badge and can be undone.
4. **A new item is added by the same save.** The line goes to `record_purchase_with_new_items` (owner or the branch's purchaser, audited as `ingredient.create_from_purchase`), which finds the item by name, Bangla name or learnt spelling first and only then creates it, kept in the base of the unit it was bought in (kg → grams, l → ml, pcs → pieces). It is one transaction: a refused purchase leaves no stray item. A new item cannot be bought in "Other" (no unit to count one of them in).
5. **"Tell Xedine what you bought" pop-up** on the Purchases page. The purchaser types or speaks the list ("chicken 10 kg 1800, onion 5 kg 300, 3 days"); `sayBazarAction` reads typed lists without AI (`parseBazarText`, ADR 0025) and sends only what it could not read to the AI transcriber (`extractPurchase`), then matches items like the bot does. It **fills the form rows and the "for how many days" box; it saves nothing** (draft → approve, CLAUDE.md #4). Items it could not find are left as "Is it a new item?" for the purchaser to answer. Quantities and prices are what the person said: nothing is multiplied or invented (CLAUDE.md #1).
6. The photo / voice drafts tab and the Telegram bot are unchanged.

## Alternatives considered
- **Replace the global "Ask Xedine" chat on this page:** it answers questions from data; filling a form is a different job and the owner still wants to ask questions here. The new pop-up sits above it.
- **Create the item first with a separate call, then record:** not atomic; a refused purchase would leave an item behind.
- **Treat every unmatched name as new without asking:** the founder asked for the "is it new?" question; it also stops typo duplicates, which ADR 0028 worked to remove.

## Consequences
- New: migration `20261027000001_purchase_new_items.sql` (`public.record_purchase_with_new_items`), `src/components/purchase-entry.tsx`, `sayBazarAction`, test `tests/db/purchase-new-items.test.ts`.
- The old `record_purchase` stays for other callers. The unit box has a `noOther` option.
- *Gap, not built:* per-line days from the pop-up are reduced to one value for the whole purchase (the form has one "for how many days"); lines with different days fall back to "Not said".
