# ADR 0038 — Discount codes: a secret code the customer tells the cashier

- Date: 2026-10-24
- Status: accepted (built at the founder's request; the choices in §2 and §3 were confirmed with the founder)

## Context
The till already had *Apply discount*: the cashier types a percent and picks a reason ("Regular customer", "Staff meal"). The founder wanted something a customer can hold: the restaurant gives a customer a secret code (on WhatsApp, on a card), the customer tells it to the cashier, and the bill drops. "It is good for them." Only the owner and a branch manager may make and change codes.

## Decision
1. **A code is a row the owner or a manager makes**, on a new page *Discount codes* (Settings hub, `/discount-codes`, owner and manager only). It has the code, a percent, an optional number of bills, an optional last day, an optional note for the owner, and an on/off switch. Table `discount_codes`, read and written by owner and manager (org-wide: a branch manager's code works in every branch, like reason codes). A cashier cannot list or read the codes.
2. **The owner types the code, or presses "Make one for me"** (six letters and numbers without 0/O/1/I, from the browser's random source). Codes are capital letters and digits, 4 to 20, one per restaurant. What the cashier types is cleaned the same way (case, spaces and dashes do not matter): `eid-10` is `EID10`.
3. **Limits are chosen per code.** Blank "how many bills" = no limit, `1` = only one bill. Blank "last day" = never ends (the last day is inclusive and counted in business days). *Percent only*: no fixed-taka codes.
4. **Using a code** is `apply_discount_code(org, branch, order, code, device, staff)`, a security-definer RPC with the rules of `apply_order_discount` (open order, latest discount wins, never overpay, staff session) plus: the code must exist and be on, not past its last day, not used up. No manager PIN: the owner or manager already decided the discount when making the code. The code row is locked so two tills cannot take the last use. Staff sees three plain answers: not found (unknown, turned off or too short), ended, used up. The discount row stores `discount_code_id`, `percent_bps` and the note `Code EID10` (no reason code, so it never shows in the cashier's reason list); the audit log's `order.discount` entry names the code.
5. **A use is a bill whose current discount is this code** (`private.discount_code_uses`). A cancelled bill, or a bill where the code was replaced by another discount, gives the use back; typing the same code again on the same bill is not a second use. A paid bill cannot take a code.
6. **At the till** the *Apply discount* box has the code field on top ("Customer's secret code" + *Use code*) and the old percent-and-reason form under "or give a discount yourself". It needs the server like every discount (ADR 0014); if the till is offline it says so.
7. **Deleting a code** keeps the bills' discounts (the link is set to null). Turning it off keeps the code and its count.

## Alternatives considered
- **A different random code per customer (a batch of single-use codes):** safer against sharing, more screens (batches, printing). The per-code limit (`1`) plus "Make one for me" covers one-off codes for the owner who wants them.
- **Reuse reason codes (a reason flagged "needs a code"):** reason codes are labels, readable by every role; a secret must not be.
- **Fixed-taka codes:** the founder chose percent only.
- **A counter column on the code:** drifts when bills are cancelled or the discount is replaced; counting bills cannot.

## Consequences
- New: `discount_codes`, `discounts.discount_code_id`, `public.apply_discount_code`, `public.discount_code_uses` (owner/manager list counts), `private.discount_code_uses` (migration `20261025000001_discount_codes.sql`).
- A cashier can try codes until one works; there is no attempt limit yet. A code of 6 characters from 32 symbols is about a billion guesses, and every try needs a signed-in till; add a limit if codes ever carry large discounts. *Gap, not built.*
- The leak detector's discount rate counts code discounts like any other discount: a code is still money given away, and the evidence line reads `Code EID10`.
