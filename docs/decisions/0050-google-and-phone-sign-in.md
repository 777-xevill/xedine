# ADR 0050 — "Continue with Google" and "Continue with phone number", at no cost

- Date: 2026-11-11
- Status: accepted (founder's request: Google, Facebook and phone sign-in, zero budget)

## Context
ADR 0041 added Facebook next to email + password. The founder wants Google and phone-number sign-in
too, with no budget. Google sign-in costs nothing through Supabase Auth. Phone sign-in normally means
SMS codes, and every SMS route costs money: Twilio/Vonage/MessageBird through Supabase, Bangladeshi
SMS gateways (paid per message), Firebase phone auth (Blaze plan only, billed per SMS), and WhatsApp
authentication templates (billed per conversation, Business verification first).

## Decision
1. **Google** goes through Supabase Auth like Facebook: one server action
   (`signInWithProviderAction`) takes `provider=google|facebook`; `/auth/callback?provider=…` words the
   errors per provider. The button shows with `GOOGLE_SIGN_IN=on`. Google always shows the account
   picker (`prompt=select_account`), because a shop phone often has several Google accounts.
2. **The Telegram bot proves the phone, for free.** The sign-in page links to
   `t.me/<bot>?start=signin`; the bot shows a "Share my phone number" button. Telegram fills
   `contact.user_id` only for the sender's own account card, so a forwarded or typed contact is refused.
   A Bangladeshi mobile (`normalizeBdPhone`) gets a 6-digit code, and the person types the phone and
   the code on `/sign-in/phone`. Shows with `PHONE_SIGN_IN=on` and the bot configured.
3. **Code rules** (`private.phone_sign_in_codes`, service role only): stored as an HMAC of phone and
   code keyed with a server secret, never in plain text; 10 minutes; 5 tries, then locked; a new code
   retires the old one; at most 5 codes per phone an hour. The clock is passed in (ADR 0006).
4. **The session.** Supabase Auth makes a session only from an email or a working SMS provider, and
   there is no SMS provider. So a phone account carries a fixed address on our own domain,
   `phone-<digits>@phone.xedine.org`, which never receives mail; `admin.generateLink` returns a
   one-time token without sending anything, and `verifyOtp` turns it into the session cookie.
   `private.phone_accounts` remembers which account a phone opens; the phone goes on the profile.
5. `src/modules/tenancy/phone-sign-in.ts` is the second server-action exception to "service role only
   in jobs and webhooks", like `invite-account.ts` (ADR 0035): the person has no session yet, and the
   live code is the proof. It reads no tenant data.

## Alternatives considered
- **SMS through Supabase (Twilio etc.) or a BD SMS gateway**: the standard way, but paid per message.
  Swapping it in later only replaces the bot step; the code table and the session step stay.
- **Firebase phone auth**: needs the paid Blaze plan, and a second auth system next to Supabase.
- **WhatsApp OTP**: paid authentication conversations, and Meta Business verification first.
- **A Telegram login link with no code typed**: one tap fewer, but whoever holds the link could
  receive the session; typing the code on the device that signs in keeps the session with that device.

## Consequences
- Migration `20261115000001_phone_sign_in.sql`: two private tables and three service-role functions.
- Phone sign-in needs Telegram on the person's phone; without it they use Google, Facebook or email.
- Only Bangladeshi mobile numbers. A phone account and an email account of the same person are two
  accounts (no merging). Invited staff still join by email (ADR 0035).
- Environment: `GOOGLE_SIGN_IN`, `PHONE_SIGN_IN`. Supabase dashboard: Google provider on with a
  Google Cloud OAuth client (free), redirect `https://<project>.supabase.co/auth/v1/callback`.
- **External approvals (ADR 0010):** Google's OAuth consent screen works in "Testing" for up to 100
  listed users; publishing it for everyone needs Google's brand verification (free, takes days).
- **2026-11-12:** published "In production" after adding public `/privacy` and `/terms` pages. With
  only email/profile scopes and no logo, Google asked for no review and set no user cap. `www.` now
  redirects to the main address, because a sign-in started on www lost its cookie on the way back.
