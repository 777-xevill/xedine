# ADR 0045 — Table QR: one QR per table, one page for the customer

- Date: 2026-11-11
- Status: accepted (built at the founder's request: "remove this complaint section and add a QR section …
  give a QR code on the customer table … member card, Google reviews … without any app or download";
  one QR per table, no call-waiter button; first version = member + menu + Google review + complaint)

## Context
ADR 0043 put one complaint QR code per branch on the Complaints page. The founder wants the QR on the
table to do more, so the customer feels the restaurant is premium and comes back: join the member card
(ADR 0042), see the menu, review on Google, and still complain privately. No app and no download.
`dining_tables` already had an unused `qr_token` column and `/t/<token>` was a placeholder.

## Decision
1. **Every table has a link** (`dining_tables.qr_token`, 32 hex characters, made by default; old rows
   filled in). The owner or manager gives one table a new link with `reset_table_link` (audited
   `table.link_reset`); the old printed QR stops.
2. **Table QR page** (`/[org]/table-qr`, owner and manager, in the sidebar under Customers, never switched
   off): "How many tables?" makes Table 1…N (only the missing numbers; a removed numbered table comes
   back), the branch's Google review link, and the printable cards (A4, two to a row, dashed cut lines,
   via the print stylesheet). The Complaints page keeps the cases and points here for the QR codes.
   Complaint QR codes printed before still work; the complaint link reset moved here.
3. **The customer's page `/t/<token>`** (public, `noindex`, read through `table_page`, service role only,
   from `src/modules/customers/table-page-view.ts`): restaurant, branch and table; shortcuts; the member
   card; "How was your meal?" with "Review us on Google" and "Tell the manager privately" (the existing
   `/c/` complaint box); the menu with photos **at this branch's prices, without what is 86 or stopped by
   food safety today** (ADR 0043).
4. **Joining from the table** (`join_member_at_table`, service role only, posted to `/api/webhooks/join`):
   phone (required), name (optional), "send me offers" (optional; records WhatsApp and SMS marketing
   consent, source `table_qr`). A **new** number gets a customer, a card (`member_cards.joined_table_id`)
   and goes straight to its card. A number the restaurant **already knows** gets no card and no
   information: "ask at the counter" — anyone at a table can type anyone's number, and the cashier can
   show the card QR from the till (ADR 0042). At most 30 joins an hour per branch; one at a time per
   branch, so a double tap never makes two cards. Only when the member card is on.
5. **The phone remembers its card**: the join response sets an httpOnly cookie per restaurant
   (`xc_<org id>`, path `/t`, one year) holding the card link the customer already has; the next scan of
   any table shows "your card, N points" first. A reset or switched-off card is ignored.
6. **Google review button for everyone.** Google's policy forbids asking only happy customers for
   reviews ("review gating"), so the Google button and the private complaint button are shown side by
   side to every customer. Only Google addresses are accepted for the link (google.com and its
   subdomains, google.com.bd, g.page, goo.gl, maps.app.goo.gl).

## Alternatives considered
- **One QR per branch**: simpler, but the founder chose per table (a table is known for later features).
- **Showing a known number's card after a one-time SMS code**: costs money per SMS; later if needed.
- **Call waiter / ask for bill**: the founder said no.

## Later (asked for, not built)
- **"We miss you" phone alert after 30 days** (Chrome web push, free; on iPhone only after "Add to Home
  Screen"): the owner writes the text, Xedine suggests it.
- **A game while waiting** (spin wheel or quiz) that can win points: the owner switches it on and sets the
  biggest prize, once per visit per customer.
- **AI "What should I eat?"**: the customer taps a few answers and the AI picks dishes from the real menu
  (drafts only, no invented prices).
