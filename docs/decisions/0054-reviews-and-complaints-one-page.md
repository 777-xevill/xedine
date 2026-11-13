# ADR 0054 — Reviews and complaints are one page: the Google link and the private complaint box

- Date: 2026-11-13
- Status: accepted (the founder's request: the two pages showed the same things; "just add the Google link and the
  complaint box, in private, only managers and owners see it", and delete the unnecessary things)

## Decision
1. **One page, "Reviews & complaints"** (`/complaints`, always in the sidebar, owner and manager only). It shows,
   for the chosen branch: the Google review link (edit it here), the private complaint box link (open it, or make
   a new one), then the complaints customers sent, handled in the same three steps as before (ADR 0043).
2. **The old Reviews page is gone.** `/reviews` redirects to `/complaints`. Removed with it: the form to paste in
   reviews by hand, AI/own reply drafts and their approval, rating boxes, "what was happening that day" boxes, the
   after-meal comments list and the "Reviews" switch in Settings → Features.
3. **Moved, not copied:** the Google link and complaint box left the Table QR page (it still makes the table QR
   codes, games and the member card). The customer side is unchanged: the table page still shows the Google button
   and the complaint box button.
4. **Kept in the database:** the `reviews`, `review_replies` and `feedback` tables and their functions stay, so
   nothing is lost and it can come back; only the screens and actions were removed.

## Consequences
- A low after-meal rating is no longer turned into a case by hand (the "Open case" button lived on the Reviews page).
- The assistant's reviews tool still works but reads only what is already stored; nobody can add reviews now.
