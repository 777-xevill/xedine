# ADR 0043 — Food safety, daily checks and complaints

- Date: 2026-11-09
- Status: accepted (built at the founder's request — **§2, §3, §5 and §8 are choices the founder should confirm**)

## Context
The founder asked for three things inventory did not do: stop expired or unsafe ingredients being used, show missing inspection records, paperwork and hygiene tasks, and help a restaurant resolve complaints and record corrective actions. Standing rules shaped all three: nobody checks a shelf or weighs anything (ADR 0029, 0030), a sale the till took offline is never lost (CLAUDE.md #7), and Bangladesh regulatory facts are never written as truth.

## Decision
1. **A date comes by itself.** `ingredients.shelf_life_days` (already in the schema, unused) is set once per item, by the owner or a manager. Every lot's safe date is then arrival + that many days. Purchasers are asked nothing. A lot may carry its own date (`purchase_lines.expires_on`, `transfer_lines.expires_on`), written only through `set_lot_expiry`, because a purchaser can otherwise edit their own purchase lines (a trigger stops a direct change). An item with no days set is never blocked by date.
2. **What "blocked" means (`food_safety.blocked`).** An ingredient is blocked at a branch when someone put it on hold, or when the **newest lot that reached the branch** is past its date. The newest lot is used, not the estimated shelf quantity, because the check runs on every order and must be fast and cannot be wrong through a missing recipe: if the newest lot is out of date there is either nothing to cook with, expired stock, or a purchase nobody recorded. Older out-of-date lots under a fresh one do not block; they are listed with what is probably left and a *Thrown away* button. *Confirm:* a restaurant that stops recording purchases will see dishes come off the till until someone records the bazar or confirms the date.
3. **The block is real at the till.** A blocked dish leaves the till's menu (checked every minute while online) and `submit_order` / `add_order_items` refuse it with `food_safety_blocked`. *Confirm:* the owner can choose "only warn" for expired dates (`org_settings.food_safety_block_expired`, default block). A hold by staff always blocks.
4. **An offline sale is never refused.** `submit_order` treats an order rung up more than two minutes ago as having waited offline: it is accepted and audited as `food_safety.sold_while_blocked`, and the Food safety page lists it for 7 days. `add_order_items` never goes through the offline queue, so it always refuses.
5. **Who can do what.** Anyone in the kitchen can stop an item, or bring a date forward. Only the owner or a manager can lift a hold or move a date later, with a written reason. *Confirm:* a manager, not only the owner, may release.
6. **Daily checks are the restaurant's own list.** `compliance_checks` holds hygiene tasks, inspection records and paperwork, daily, weekly (on the restaurant's week) or monthly. `compliance_check_logs` has one record per branch, check and period; recording again corrects it (audited). A period with no record is *due* while running and *missing* once over; nothing before a check's first day counts. A gap up to 7 days back can be filled in, marked late. A starter list of ten is one button away: **suggestions, not a statement of the law** (`TODO(verify)` with a food-safety adviser). Licences and the VAT return appear beside them from `metric_compliance`, not as a second definition.
7. **A problem becomes a case.** Recording a check as a problem opens a hygiene incident, once. A bad review or after-meal comment becomes a complaint with one tap, once.
8. **A case closes only with its story complete:** why it happened, what the customer got, and at least one corrective action, all done. A closed case is locked until reopened with a reason. *Confirm:* this is strict for small complaints; a low-severity exemption would be one condition.
9. **PII (CLAUDE.md #8).** A customer's name and phone are optional, live on `incidents`, and are readable by the owner and that branch's manager only. All writes go through functions, so the audit row never contains them. `get_safety_status` gives the assistant counts only.
10. *(Replaced by the amendment below.)* Both pages were feature switches at first.
11. **Numbers.** Everything shown comes from a metric function (METRICS.md "Food safety", "Daily checks", "Complaints"). No AI decides what is safe.

## Amendment (2026-11-09): easier for every user
After seeing the live pages at phone width the founder asked to make them easier. This replaces §10.
- **Always in the sidebar**, for the owner, manager and kitchen (Complaints: owner and manager), like Dish ingredients (ADR 0037). The till blocks whether or not the page is visible, so hiding the page that explains why a dish vanished made no sense. The two feature switches are gone.
- **Common days are filled in for the owner to check** (`suggestShelfLife`, a fixed word list in English, Banglish and Bangla, marked "suggested"). Nothing is saved until a person presses Save, and an item it does not know stays empty. Cautious rules of thumb for chilled or shelf storage, `TODO(verify)` with a food-safety adviser. *Confirm the table.*
- **One sentence on top, only what needs doing below**, and the rest behind a tap, on all three pages. বাংলা | English on each, dates and digits in Bangla.
- **Daily checks:** an empty restaurant sees one button. *Done* is one tap (a reading box only where the check needs one), and *Something is wrong* opens on demand. There is deliberately no "mark all done": a record nobody checked is worse than a missing one.
- **Complaints:** one line and how serious, then Save; everything else is optional behind *Add more*. An open case is three numbered steps: what will you change, why did it happen, what did the customer get. The rule in §8 is unchanged.

## Amendment (2026-11-09): an old purchase record is not expired food
The founder saved the suggested days on the demo restaurant and saw 33 red "Stopped" items. 32 of them were false: the newest recorded purchase was weeks old, because the demo's records stop in October. This changes §2.
- **A date stops a dish only for 7 days after it passes.** Past that, the item has been used up or the bazar is not being recorded, and stopping the dish protects nobody. It moves to one calm list, "No recent purchase recorded". A hold by staff always blocks, however old. *Trade-off:* out-of-date food really left on a shelf for over a week is no longer stopped by date alone; the Stock page and staff holds are what catch it.
- **Red only for what someone reported as unsafe.** A date is a warning. One row per ingredient across branches, with the dishes and actions behind a tap.

## Alternatives considered
- **Block on the estimated quantity left of an expired lot:** precise-sounding, but wrong whenever a dish has no recipe or usage is off, and too slow to run on every order.
- **Ask the purchaser for a date on every line:** rejected by ADR 0029.
- **Refuse offline orders at sync:** the food has already gone out; refusing loses the sale and the record of it. Flagging it tells the owner something they can act on.
- **Photo proof on checks:** needs a storage bucket and policies; left as a next step.

## Consequences
- New tables `ingredient_holds`, `compliance_checks`, `compliance_check_logs`, `incidents`, `incident_actions`; migrations `20261030000001`–`3`. `submit_order` and `add_order_items` each gain one guard call.
- The morning message to the owner gains one line when anything is stopped, missed or overdue. Like every scheduled job, it needs cron to be running in that environment.
- Tests: `tests/db/food-safety.test.ts`, `src/modules/pos/food-safety.test.ts`.
- Gaps, not built: modifiers have no recipes, so an add-on is not stopped; the kitchen screen shows no banner (the kitchen has the Food safety page); no photos on checks; complaints cannot yet be written from the till; a till offline for a long time keeps its last list.
