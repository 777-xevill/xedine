# ADR 0060 — Costs in two sections: Rent & bills, and Salaries with who has been paid

Date: 2026-11-16 · Status: accepted · Amends: 0007, 0015

## Context
The Costs page held rent/bills and a flat list of salaries. Owners kept who had been paid on paper. Pay and
rent are the most sensitive numbers in the app.

## Decision
1. Two sections on Costs (owner only): **Rent & bills** and **Salaries** (`?tab=`).
2. **Rent & bills:** add, change and end each cost. A changed amount ends the old row yesterday and starts a
   new one today (`update_fixed_cost`), so earlier days' profit never moves; a row created today, or a
   words-only edit, changes in place.
3. **Salaries**, one month at a time: pay and extra pay per person, a private note, "copy last month's pay"
   (nothing marked paid), and **paid** marks: all, part or none, with the day and the way (cash, bKash,
   Nagad, bank, other); "mark all paid" for everyone still owed; undo for one person.
   `salary_entries.paid_poisha/paid_on/paid_method`. Paid is a record, never a cost: profit still uses
   salary + extra pay for the month.
4. **Security:** every write goes through owner-only functions (`save_salary`, `mark_salary_paid`,
   `mark_salaries_paid`, `copy_salaries_from_previous_month`, `update_fixed_cost`); the tables stay
   readable by owner and accountant only (ADR 0007, RLS). Row triggers audit every insert, update and
   delete of `salary_entries` and `fixed_costs` (`salary.*`, `fixed_cost.*`), whichever way it is written.
   A part payment cannot pass the pay, and the pay cannot be lowered under what was paid.
5. Tested: `tests/db/salary-payments.test.ts` (owner only; manager, accountant and another owner refused;
   limits; versioning; audit).

## Consequences
- The owner needs no paper for who was paid and how.
- The accountant can read pay and payment marks but not change them.
