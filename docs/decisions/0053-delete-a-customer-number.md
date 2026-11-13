# ADR 0053 — The owner or a manager can delete a customer's number

- Date: 2026-11-13
- Status: accepted (the founder's request: "add a delete option for the number, and a warning when they want to delete")

## Decision
1. Each row of the Customers list has a bin button. It asks first (a warning that names the number and says what
   goes and what stays) and deletes only if the person confirms.
2. `delete_customer(org, customer)` runs in the database. Only the owner or a manager may call it; a cashier or
   accountant is refused. It writes `customer.delete` to the audit log with the phone masked, the visit count and
   the points the customer had.
3. What goes with the customer: number, name, consent history, notification subscriptions, member card and
   points, campaign rows. What stays: the bills and feedback; they lose the link to the customer
   (`customer_id` becomes null), so sales and money figures do not change.
4. It cannot be undone. If the same person comes back, the cashier adds the number again and they start as a new customer.

## Consequences
- The segment counts and first-return rates change after a delete (the customer is no longer counted).
- Tested in tests/db/customers.test.ts.
