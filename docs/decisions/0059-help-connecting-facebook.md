# ADR 0059 — Help connecting Facebook until Meta approves Xedine

Date: 2026-11-16 · Status: accepted · Amends: 0040

## Context
The Meta app is Live, but its permissions are standard access: only people with a role on the app (Testers)
can connect a Page. Advanced Access needs App Review, which needs Business verification (documents the
founder does not have yet). The Tester route asked owners to visit Meta's developer site — too hard.

## Decision
1. Settings → Social offers two ways before Facebook is connected:
   - **Page access (easiest):** the owner gives Xedine's Facebook account access to their Page in the
     Facebook app. A platform admin then connects that Page from the admin console.
   - **Tester:** the owner sends their own profile link; the admin adds them as a Tester and marks it
     invited; the owner then sees an "Open the invite" button and "Connect".
2. `social_connect_requests` (one per restaurant; owner reads, writes only through `request_social_connect`,
   `cancel_social_connect`, `admin_mark_social_connect`; audited). The admin inbox is on /admin.
3. The admin connect reuses the OAuth callback; the signed state carries an `a` marker and the callback
   re-checks `am_platform_admin()`. An admin always picks the Page by hand (their account manages many).
4. A Telegram ping tells the operator (`ADMIN_TELEGRAM_CHAT_ID`); `META_HELPER_NAME` / `META_HELPER_URL`
   name the account owners give access to. Unset → that way is hidden.

## Consequences
- Every restaurant's posting token comes from one Facebook account until verification; if it is blocked,
  those restaurants must reconnect. Remove this path after App Review.
