# ADR 0048 — Offer notifications on the customer's own phone

- Date: 2026-11-13
- Status: accepted (built at the founder's request: allow Chrome browser notifications and WhatsApp offers, so
  that when a customer ticks the box they get the offer as a notification on their phone; the box reads "Get
  notified when you get a personal offer")
- Extends ADR 0045 (the "Send me offers on WhatsApp or SMS" tick on the table page)

## Context
The join form on the table page had one tick, "Send me offers on WhatsApp or SMS". WhatsApp needs a Meta
account that is not live yet, and an SMS costs money. A browser notification is free, arrives on the phone's
lock screen and needs no app.

## Decision
1. **One tick, two things.** The box is now "Get notified when you get a personal offer". Ticking it still
   records the WhatsApp and SMS marketing consent (`consents`, source `table_qr`), exactly as before, and also
   asks the browser to allow notifications. The tick is the tap the browser needs before it will show its
   "Allow notifications?" question. If the customer says no, or the browser cannot do notifications (an
   iPhone's Safari outside the home screen), the consent stays and the page says they will still get WhatsApp
   or SMS offers.
2. **The phone's subscription** (`push_subscriptions`: endpoint, key, secret) travels in a hidden field and is
   saved right after the join by `save_push_subscription`, which keeps it only for a member who has marketing
   consent. At most five phones per customer; the same phone is saved once. **Service role only**: the
   endpoint is a capability to ring that phone, so no client policy exists (`register_table` kind
   `service_only`). Deleting a customer deletes their phones.
3. **Sending.** When an owner or manager runs an approved campaign, `run_campaign` decides who (consent,
   holdout, frequency cap) as before; then `pushCampaign` sends the campaign text to the phones of the
   customers it queued, titled with the restaurant's name, and tapping it opens the customer's member card.
   The auto-run job does the same. Draft → approve is unchanged: nothing is sent that a person did not approve.
   A phone the browser reports as gone (404/410) is switched off.
4. **No library, no secret to set.** The sender is about 150 lines of WebCrypto (`src/lib/messaging/web-push.ts`):
   VAPID (RFC 8292) and aes128gcm encryption (RFC 8291). It runs the same on the Cloudflare Worker and in tests,
   which decrypt a message the way a phone does. The server's own key pair is made the first time a table page
   needs it and kept in `private.web_push_keys` (one row; readable only through two service-role functions), so
   there is nothing to configure on Cloudflare. The VAPID subject is the site URL, not a person's email.
5. **The service worker** (`public/sw.js`, already used by the till) gets `push` and `notificationclick`. It
   opens only links on this site.

## Not done / limits
- **A run notifies at most 30 phones** (`PUSH_PER_RUN`): a Worker may make only so many outgoing requests per
  call. A restaurant with more members needs the next run (or a queue); the count of who was reached is not yet
  shown on the Campaigns page.
- Members who joined before this change (or at the till) have no phone saved; there is no "turn on
  notifications" button on the member card page yet.
- iPhone: web push works only after "Add to Home Screen". Not handled.
- The encryption is tested against a decryption written from the RFC, not against a real phone; the first real
  campaign to a real Chrome is the proof.

## Risks accepted
Anyone with a table link can join with any number (ADR 0045) and so can register an endpoint for their own
phone only; the subscription is useless for anyone else's phone. A campaign is the only thing that sends.
