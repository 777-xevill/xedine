# ADR 0030 — What is left, without counting first

- Date: 2026-10-02
- Status: accepted (the founder chose "show ≈ 800 g left" for an item nobody has counted)

## Context
ADR 0018 made stock count-based: `stock.theoretical` starts from the last shelf count, and an item never counted is **unknown** — the Stock page said "Count it to see how much is left". The founder wants the owner never to weigh or work anything out: buy 2 kg chicken, sell burgers and rice whose recipes say how much chicken each takes, and Xedine should show what was used, what is left, the daily average and how many days remain. Two gaps stood in the way: an uncounted item had no number at all, and the daily average was always spread over 14 days, so a new item's first 4 days of use looked like a quarter of what it really was.

## Decision
1. **`stock.estimate`** (METRICS.md). For an item never counted at a branch, what is left = what came in (purchases + transfers in − transfers out) − what went out (usage.theoretical + waste.logged), from the first day it was bought or arrived there — as if the shelf was empty before. `metric_stock_status` returns it as `stock_qty` with `estimated = true`; days of cover and the band are worked out from it like any stock. The Stock page shows it as "≈ 800 g" with "estimate: not counted yet", and one line explaining ≈. The first count replaces it.
2. **Used and per day, from the same days.** `metric_stock_status` also returns `since_on`, `used_since_qty` and `avg_daily_qty`, all over the same last D days (§3): used = what the recipes of the dishes sold took in those days, a day = used ÷ D. The Stock page row reads "Used 1.2 kg in 4 days · about 300 g a day", above "About 2.6 days left" (= what is left ÷ a day), so the numbers on one row always add up. (First built with "used" since the last count, waste included; the founder's demo row then read "5.5 kg in 12 days · about 1.5 kg a day", which does not add up — migration `20261018000001`.)
3. **The average** behind days of cover is usage.theoretical over the last **D** days ÷ D, where D = 14, or the days since the item was first bought, counted or received at the branch (today included) when that is fewer. For anything older than two weeks nothing changes.
4. **The count-based maths is unchanged.** `private.m_stock` still says "unknown" for a never-counted item, so the Stock Guard (below-zero), hiding an item ("none left" is still asked) and the bazar list ("never counted = no stock") behave as before, and the golden checks (which read `m_stock`) are untouched. The assistant's stock tool passes `estimated` on, so an estimate is never presented as a counted figure.

## Alternatives considered
- **Keep "count it first"** — exact, but leaves a new restaurant's Stock page empty until someone weighs everything; the founder rejected it.
- **Use the estimate everywhere (Stock Guard, hiding, bazar list)** — consistent, but it would let an item be hidden, or a bazar line shrink, on a guess. Revisit once owners trust the estimate.
- **Average over the days since the last purchase** — jumps with every bazar; days since the item was first seen is steadier and equals 14 days for anything established.

## Consequences
- An owner who already had stock before using Xedine sees too little (possibly below zero, which the row already asks them to count). The ≈ and "not counted yet" say so.
- The Stock page and the bazar list can disagree for never-counted items (≈ 800 g left vs "never counted"). Revisit together with the alternative above.
- Losses still need a real count: recipes say what *should* have been used, so only a look at the shelf shows chicken that left without a sale.
