# ADR 0041 — "Continue with Facebook" sign-in, and TikTok for the social autopilot

- Date: 2026-10-29
- Status: accepted (built at the founder's request; the choices below were the founder's answers)

## Context
The founder wants owners to "just log in with Facebook and that's it", and the autopilot (ADR 0040) to
post to every platform the restaurant has, TikTok included. ADR 0003 made sign-in email + password only.

## Decision
1. **Facebook sign-in sits next to email + password** (founder's choice over Facebook-only). Email stays
   for managers' invites (ADR 0035) and for Facebook accounts with no email address, which are common in
   Bangladesh: Supabase refuses those, and the sign-in page says so in plain words (`facebookNoEmail`).
   Supabase Auth runs the sign-in with the **same Meta app** as the autopilot; `/auth/callback` turns the
   code into the session cookie, and a new account lands on `/onboarding` as with email. The button shows
   only with `FACEBOOK_SIGN_IN=on`, because the app cannot see the Supabase dashboard switch.
   Signing in asks only for `email,public_profile`; connecting the Page stays one click on Settings →
   Social, so Meta's App Review sees two plain requests instead of one big one.
2. **TikTok is a third account** in `social_accounts`, connected with TikTok Login Kit (signed 30-minute
   state, keyed apart from Facebook's). TikTok tokens live 24 hours: the job refreshes them with the
   refresh token (`social_tokens.refresh_token`, `expires_at`) and stores the new pair.
3. **TikTok gets the video, always.** TikTok's API takes photo posts only from a domain verified with
   TikTok, and our media sit on Supabase's storage domain; video is uploaded by Xedine (`FILE_UPLOAD`, one
   piece). So when TikTok is connected, a poster day renders the reel too; Facebook and Instagram still
   get the poster, Growth still shows the poster.
4. **The owner chooses how TikTok posts** (founder's choice: both): `tiktok_mode = 'draft'` (default)
   sends the video to the owner's TikTok inbox, posted with one tap — what TikTok's content-sharing rules
   expect from an audited app; `'direct'` posts with no tap, public if TikTok allows it, and privately
   (`SELF_ONLY`) while TikTok has not audited Xedine (the app retries once as private on TikTok's
   `unaudited_client…` error). Facebook and Instagram stay fully automatic.
5. Publishing keeps ADR 0040's rule: each platform's id is written as it succeeds (`tiktok_publish_id`
   while TikTok processes, `tiktok_id` when done — `inbox:<id>` for a draft), so a retry never posts twice.

## Alternatives considered
- **Facebook-only sign-in**: simplest for owners, but strands phone-only Facebook accounts and invited
  staff; rejected by the founder.
- **Ask for Page permissions at sign-in and connect the Page automatically**: one click fewer, but every
  sign-in would ask for publishing rights, and Supabase's provider token is short-lived. Possible later.
- **TikTok photo posts through a proxy on our own domain**: needs a custom domain verified with TikTok;
  revisit when Xedine has one.
- **TikTok direct posting only**: TikTok's guidelines expect the user to see and confirm each post, so an
  audit would likely fail; kept as an option, not the default.

## Consequences
- Migration `20261029000001_social_tiktok.sql`: `social_accounts` platform `tiktok` (non-numeric id
  allowed for TikTok only), `social_tokens.refresh_token` / `expires_at`, `social_settings.tiktok_mode`,
  `social_posts.tiktok_publish_id` / `tiktok_id`.
- Reconnecting or disconnecting Facebook no longer removes TikTok, and the other way round.
- Environment: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `FACEBOOK_SIGN_IN`. Supabase dashboard:
  Facebook provider on (Meta app id/secret), `https://<app>/auth/callback` in the redirect URLs; Meta app:
  `https://<project>.supabase.co/auth/v1/callback` as a valid OAuth redirect URI.
- **External approvals (ADR 0010), open:** Meta Business Verification + App Review (ADR 0040), and the
  TikTok app review + Content Posting audit. Until TikTok's audit, direct posts are private only; drafts
  work for any account that connects. Until Meta's review, Facebook sign-in works only for people with a
  role on the Meta app.
- Gaps, not built: telling the owner when a TikTok token stops working (it shows on Growth as a failed
  post); TikTok photo posts; TikTok post insights.
