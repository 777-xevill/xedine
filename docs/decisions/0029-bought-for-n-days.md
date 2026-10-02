# ADR 0029 — Bought for N days

- Date: 2026-10-02
- Status: accepted, amended the same day (see Amendment: no "how much is left?" questions)

## Context
Ingredient use is uneven: chicken can be 1.2 kg on a quiet Monday and 2.8 kg on a busy Friday, or jump for one reason on one day. Xedine already compares what was really used with what the dishes sold needed, so busy days are not losses. The founder asked for a simple way in: when the purchaser buys something, they say **how many days it is for**, and the owner sees it counted down. Separately, staff food should show as its own line, not inside the red loss.

## Decision
1. **Days per purchase line.** `purchase_lines.for_days` (1–30, nullable). In the Telegram bot: written on a line ("murgi 10 kg 3200 3 din", "৩ দিন", "7 days"), or for the whole list on a line of its own ("3 din er bazar"), else the days the item was last bought for at that branch (`chat_usual_days`), else the purchaser taps 1 / 2 / 3 / 7 days under the list; ✅ appears only when every line has days. A tap sets every line that has no days written on it. The web purchase form has one optional "For how many days?" for the whole purchase. Drafts read by AI from a photo or voice note get the remembered days and the buttons.
2. **The countdown (`stock.lot`, METRICS.md).** The latest day an item was bought is its lot; the Stock page shows "Bought Sat for 3 days · day 2 of 3" (not "days left", which would be confused with how long the shelf lasts), then "days are up" for a week. If the last lot did not last its days, the row says so ("last time it lasted 2 days, not 3"). `metric_stock_lots` — quantities only, stock roles.
3. **Staff food** is a waste reason (`staff_food`, "Staff food" / "স্টাফের খাবার"), added to every organisation. It is taken out of over-usage (`usage.over_qty` = really used − recipes − staff food) and shown on its own: a line on the item ("Staff food: 600 g (৳192). Shown on its own, not part of the loss."), a ledger line, and a period total under the loss banner. It still reduces stock and is still waste in `waste.logged`, so the leak detectors and the Waste tab are unchanged.
4. The days never change a number by themselves: every figure is still a count, a purchase, a sale or a logged waste, through the existing metric functions (CLAUDE.md #1).

## Amendment (2026-10-02): no "how much is left?" questions
The first version also had the bot ask the buyer, the morning after a lot's days ended (07:00 job) or right after ✅ when an item was bought again early, how much was left, and recorded the answer as a one-item count (`stock_checks`, `job_stock_checks`, `chat_*_stock_check*`, migration `20261016000001`). The founder removed it: checking the shelf **is not the purchaser's job**, and the owner should not have to weigh or work anything out. Migration `20261017000001` drops the table, the job, its schedule and the chat functions; the countdown and staff food stay. In its place, ADR 0030 shows what is left automatically, even before anyone has counted. Counting the shelf stays possible on the Stock page and is still what finds losses (usage.actual needs two counts).

## Alternatives considered
- **Per-line day buttons** — exact, but a long list becomes a wall of buttons; one row for the whole list plus "3 din" on a line covers the real cases (staples last longer and are remembered).
- **Days required on the web form** — would block the existing form for owners who do not think in days; optional there.
- **Staff food inside the loss (labelled)** — the founder chose its own line: the red number should only show money nobody planned to spend.

## Consequences
- New: `purchase_lines.for_days`, `metric_stock_lots`, `chat_usual_days`; `metric_stock_variance` gains `staff_food_qty` / `staff_food_poisha` and its over_* columns exclude staff food.
- Purchasers get one more tap the first time they buy an item; after that the days are remembered.
- **Revisit** with pilot data: the 1 / 2 / 3 / 7 buttons, and whether "days are up" should prompt the owner to count.
