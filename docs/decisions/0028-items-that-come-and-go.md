# ADR 0028 — Items that come and go (bot picker, hiding, Stock Guard)

- Date: 2026-10-02
- Status: accepted (founder's answers on 2026-10-02 — §1, §3, §5 are the founder's choices; §6 is a first version to confirm with real use)

## Context
A restaurant's items change all the time. A purchaser buys something new from the bazar (ADR 0025 amendment already lets the ✅ in Telegram create it), buys something once for a party and never again, or writes the same thing three ways ("murgi", "chicken", "মুরগি"). Three problems follow: duplicates split stock and leak numbers three ways; one-time items clutter the bazar list and count sheets forever; and an item that disappears while some of it is still on the shelf is money nobody can see. The founder: "every item is an asset for the restaurant", and wants an agent that keeps the stock section clean.

## Decision
1. **The purchaser decides, and a new item counts from day one.** An item a purchaser adds from the chat is a full item at once: it is in stock, usage, the Stock page's missing-stock lines and Money leaks like any other. It is marked `added_via = 'chat'` so the owner sees it (§6), but nobody has to approve it first.
2. **"Which item is this?" buttons.** When a line's name does not match one item for sure but close items exist — a bazar synonym with several hits ("murgi" → Chicken, Chicken liver), a name inside another, or a close spelling — the line waits (flag `pick`) and the bot shows up to 3 items as buttons plus "🆕 New: <name>". Only items in the same unit family are offered (kg never offers eggs). Matching is plain code, no AI: same list, same buttons. A line with nothing close becomes 🆕 as before.
3. **The purchaser's tap is enough** (founder's choice). The tap fills the line and the bot redraws the same message; ✅ appears once every line is complete. Nothing is recorded until ✅ (CLAUDE.md #4 unchanged).
4. **The spelling is remembered on ✅.** A picked line teaches the item that spelling (`ingredient_aliases`, one spelling = one item per org, audited as the purchaser). Next time "deshi murgi" matches by itself, so duplicates stop at the source. Cancelling a list teaches nothing.
5. **Hiding never hides money.** An item can be hidden from the bazar list, count sheets and the bot's buttons (`is_active = false`) only through `set_ingredient_hidden`: owner only, audited, refused while the records say any is on a shelf or on the way in any branch. Where the item was bought but never counted, the records cannot say — the owner must state "none left", which is audited as such. A trigger blocks any other way of setting `is_active = false`. Buying a hidden item again (chat, web or any other path) brings it back, audited "bought again". Its history stays in every period metric.
   **When to suggest it** (founder's choice): when nothing was bought, used or wasted for 60 days. The app asks; it never hides by itself.
6. **Stock Guard: rules first, AI later.** `metric_stock_guard` lists what needs a person, worst first: a price that looks like a typo (owner/accountant only), stock below zero, stock sitting unused for 60 days, new items from the chat (14 days, with who added them), and items nobody buys any more (hide / "none left, hide"). Definitions in METRICS.md "Stock Guard". The card is on the Stock page. It changes nothing by itself, has no AI badge (it is not AI), and every figure is a metric field.
   The AI step the founder asked for comes second, on top of these rules: spotting two items that are the same thing in different words, and explaining the list in Bangla. It will only suggest; merges and renames stay the owner's tap.

## Alternatives considered
- **Owner approves every new item** — safer, but the founder chose speed; the Stock Guard's "new item" row gives the owner the same look without blocking the bazar.
- **Hide automatically after 60 days** — rejected by the founder; an item with stock left would vanish with its money.
- **AI matching of names** — costs money per message and can be wrong in ways nobody can reproduce; the deterministic picker plus learnt spellings gets most of the way, and the purchaser's tap settles the rest.
- **Delete unused items** — breaks history (purchases, counts, recipes point at them); hiding keeps it.

## Consequences
- New table `ingredient_aliases` (names only, readable by stock roles, written by the chat on ✅ or by the owner); new column `ingredients.added_via`; RPCs `set_ingredient_hidden`, `chat_update_purchase_draft`, `metric_stock_guard`; `chat_confirm_purchase_draft` replaced (migration `20261015000001`).
- The bot now matches hidden items too, so buying one again finds it instead of making a duplicate.
- **Open:** merging two items that are the same thing (moving purchases, counts, recipes and waste onto one, audited) is not built; Stock Guard cannot offer "merge" until it is. There is no screen to rename an item or edit its spellings yet. The 60-day / 14-day / 2× numbers are fixed in SQL; make them org settings if owners ask.
