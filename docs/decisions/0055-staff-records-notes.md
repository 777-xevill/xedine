# ADR 0055 — Staff records keeps attendance and private notes; Advances and Sales by staff are removed

- Date: 2026-11-14
- Status: accepted (the founder's request: delete "Sales by staff" and "Advances", and make a notes section for
  staff records or anything they want to note about the restaurant)

## Decision
1. The Staff records page has two parts: **Attendance** (one tap per person, or "mark everyone as came") and
   **Notes**. The Advances and Sales by staff tabs are gone, with their form and screens.
2. **Notes** are short text notes, each about one staff member or about the restaurant, for one branch. Newest
   first; a note can be deleted after a warning. They are in the new `notes` table (migration 20261119000001).
3. **Private:** only the owner and the branch's manager can read or write notes (RLS), because a note can be
   about a person. Cashiers, accountants and other restaurants see nothing. The Notes tab is hidden for others.
4. A deleted staff member leaves their notes behind as notes about the restaurant.

## Consequences
- The `advances` table, `metric_advance_balances` and `metric_staff_sales` stay in the database (nothing is
  lost; the assistant's staff-exceptions tool still reads sales data), but no screen records or shows advances now.
- Nothing logs who wrote a note beyond `created_by`; deleting a note is not audited.
- Tested in tests/db/staff-notes.test.ts.
