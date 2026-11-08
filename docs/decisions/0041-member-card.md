# ADR 0041 — Member card: points, a member discount and the customer's own card page

- Date: 2026-11-09
- Status: accepted (built at the founder's request: "always use points", "the owner can edit the points",
  "the discount is not only 10%: the owner decides")

## Context
Revisit (revisit.cards, Dhaka) sells a stamp/points card kept in the customer's phone wallet, scanned at
the counter, with win-back messages. It has no link to a POS, so it never knows what a customer ate or
spent. Xedine already knows every customer the cashier adds by phone (M11, ADR 0021) and every line of
their bills. The founder wants customers to scan a QR and see their membership card, past bills, points
and the menu from home, read-only; the owner controls everything, including a member discount they can
switch on or off; and the cashier can scan the customer's QR at the till.

## Decision
1. **Rules per restaurant (`loyalty_settings`, owner only):** card on/off; "N points for every ৳X on the
   bill" (default 1 per ৳100 of the bill total); "1 point = ৳Y" when used (default ৳1); the fewest points
   that can be used at once (default 50); a member discount of any percent, on or off (default 10%, off).
   Settings → Member card.
2. **Points are a ledger (`loyalty_points`):** one row per change: `earn` (a trigger on `orders` when a
   bill with a customer becomes completed, or a customer is added to a completed bill; once per bill),
   `redeem` (the cashier uses points on an open bill; at most one row per bill, replaced each time) and
   `adjust` (the owner adds or takes away points with a required reason, audited as `customer.points`,
   never below zero). The balance is the sum; a redemption on a cancelled bill does not count, so the
   points come back. Earning uses the bill total the customer paid, in whole steps (৳267.75 at 1 per ৳100
   = 2 points). Refunds do not take points back (gap, below).
3. **Using points is money off the bill, on top of a percent discount.** `recompute_order_totals` now adds
   the redeemed value to the latest percent discount, capped at the bill; `redeem_points` refuses more
   points than the customer has (`points_not_enough`), fewer than the minimum (`points_too_few`) or more
   than the bill has left after its percent discount (`points_more_than_bill`). Unpaid bills only. The
   value is fixed when the points are used, so the owner changing "1 point = ৳Y" later never changes an
   old bill. Points show in the bill's `discount_poisha` (they are a discount the restaurant gives); they
   do not create a `discounts` row, so the discounts-by-reason view does not list them.
4. **Member discount goes on by itself** when the cashier adds a member (by phone or by scanning) to an
   unpaid bill that has no order-level discount yet. A bill that already has a code or a manager's
   discount keeps it, and the cashier can still change it in Apply discount. Audited as `order.discount`
   with `member: true`.
5. **The card link (`member_cards`)** is 18 random bytes (24 URL-safe characters) per customer, made the
   first time the till or the owner asks for it. The owner or a manager can replace it (the old link
   stops). Anyone with the link sees that card, so it is treated like the customer's phone number.
6. **The customer's page `/m/<token>`** is public (no account), `noindex`, and only reads: restaurant name,
   the customer's name and masked phone, points and their worth, the member discount, the rules, the last
   20 paid bills with their dishes and points, the last 20 point changes, the menu (base prices, photos)
   and branch addresses. `member_card_view` is executable by the service role only (the structure test
   forbids anon functions), and `src/modules/customers/member-card-view.ts` is the one file allowed the
   service role for it. Nothing about costs, other customers or staff.
7. **At the till:** "Scan card" opens the camera (`Permissions-Policy: camera=(self)`, was `camera=()`) and
   reads the QR with the browser's built-in BarcodeDetector (Chrome on Android) or the `barcode-detector`
   ponyfill (ZXing WebAssembly, fetched from jsDelivr on first use) where there is none (Chrome on
   Windows). A member box shows name, points, the discount and points used; "Use points" and "Card QR" (a
   big QR the customer scans with their phone). The paid receipt prints the card QR. All numbers come from
   `member_for_till` (balance, usable points and their worth); the till does no point arithmetic.
8. **QR codes are drawn by `uqr`** (zero dependencies) as one SVG path, black on white in both themes.

## Alternatives considered
- **Apple/Google Wallet pass** (Revisit's approach): free lock-screen messages and no app; needs an Apple
  Developer account (USD 99/year) and pass signing. Google Wallet's API is free. Later, on top of the same
  card link; the web card works on every phone now.
- **Stamps ("buy 10, get 1")**: founder chose points.
- **Sign-in with a one-time SMS code** for the card page: costs money per SMS and adds a step; the link
  from the till/receipt is enough for read-only data, and it can be replaced if shared.
- **Points as a fake percent discount**: would change with every added dish; rejected for the fixed
  money-off value above.

## Consequences
- New: `loyalty_settings`, `member_cards`, `loyalty_points`, enum `loyalty_kind`; RPCs `attach_member_card`,
  `member_for_till`, `redeem_points`, `adjust_points`, `member_points`, `member_card_link`,
  `reset_member_card`, `member_card_view` (service role); trigger `orders_award_points`; `attach_customer`
  and `recompute_order_totals` replaced (migration `20261028000001_member_card.sql`).
- New dependencies: `uqr` 0.1.3 (QR drawing), `barcode-detector` 3.2.3 (QR reading where the browser has
  no reader).
- Tests: `tests/db/member-card.test.ts` (discount, earning, using, giving back, limits, adjust, roles, the
  card page); `src/modules/customers/member-card.test.ts`.
- Gaps, not built: points are not taken back on a refund; no expiry of points; the card page shows base
  menu prices, not branch prices; no Wallet pass; customer alerts and campaigns from the card (next step,
  founder asked for browser notifications).
