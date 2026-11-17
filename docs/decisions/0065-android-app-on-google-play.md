# ADR 0065 — The Android app on Google Play is xedine.org in a Trusted Web Activity

Date: 2026-11-18 · Status: accepted (built while the founder slept; their words below) · Builds on ADR 0044
(hosting) and ADR 0063 (brand)

## Context

The founder: "website is ready but now we need app for playstore, so build it … make sure it's ready to launch
for playstore." Xedine is one Next.js web app (owner pages, till, kitchen screen, customer QR pages) that already
works on phones, offline at the till, in Bangla and English. There is no separate mobile codebase, and a solo
founder cannot keep two in step.

Google Play's rules that shape the choice (checked 2026-11-18):

- New apps must target **Android 16 (API 36)** since 2026-08-31.
- Apps with accounts need **account deletion inside the app and on the web**. A link inside the app to the web
  page is enough if it sits somewhere prominent, such as the account area.
- Digital services bought inside an app go through Google Play Billing, and an app may not **point to another
  payment method**.
- New personal developer accounts must run a **closed test with at least 12 testers for 14 days** before
  production. Organisation accounts are exempt.

## Decision

1. **A Trusted Web Activity (TWA), generated with Google's Bubblewrap 1.27.** The app is Chrome showing
   https://xedine.org full screen, with no browser bar and with Chrome's sign-in cookies, camera, offline service
   worker and push. Every web release reaches the app at once; the Android project changes only for its own
   settings (name, icons, version). A WebView wrapper (Capacitor) was rejected: Google treats bare web wrappers as
   low-quality, and Google sign-in refuses WebViews. A native rewrite was rejected as two codebases for one founder.
2. **Package `org.xedine.app`, name "Xedine"**, version 1.0.0 (code 1), `minSdk 24` (Android 7: the site's CSS
   needs Chrome 111+, and Android 6 cannot get it), `targetSdk 36`, `compileSdk 36`, any orientation (phones
   upright, tablets at the till sideways). Two long-press shortcuts: **Till** (`/pos`) and **Kitchen screen**
   (`/kds`). Notification delegation is on, so web push shows as the app's notifications.
3. **Trust through Digital Asset Links.** `public/.well-known/assetlinks.json` lists the SHA-256 of every key the
   app is signed with. Today that is the **upload key**. After the first upload, Google re-signs with its own
   **app signing key** (Play App Signing), and that fingerprint must be added too (Play Console → Test and
   release → App integrity), or the installed app shows a browser bar. `src/lib/android-app.test.ts` keeps the
   package name, fingerprints, colours and start URL in step across the three files.
4. **The app opens `/?source=app`.** The proxy sends someone signed out to `/sign-in` instead of the 3D café of
   ADR 0064, and a signed-in owner goes on to their restaurant as before. The proxy also sets an `xedine_app`
   cookie for a year. Chrome shares cookies with the app, so the same phone's browser counts as the app too,
   which is harmless.
5. **Nothing in the app names a payment method outside Google Play.** Xedine sells nothing inside the app, and
   restaurants pay by invoice (ADR 0023). The billing page hides its "pay by bank or bKash" line when the
   `xedine_app` cookie is set, and the store listing does not mention payment.
6. **Account deletion.** The sidebar's account area, which every signed-in role sees, now links to
   "Delete my account" (and Privacy). `/data-deletion` names the app, and a button under the introduction opens
   an email to support@xedine.org with the request already written. That page is also the "delete account" URL
   for the Play listing.
7. **A web app manifest** (`public/manifest.webmanifest`): grey theme, the chef tile, maskable and monochrome
   icons made from it by `android/make-icons.py`, the two shortcuts, and `related_applications` pointing to the
   Play listing (`prefer_related_applications` stays false until the app is live). Chrome on Android can now also
   install the site directly.
8. **Signing and build stay on the founder's PC, outside the repo.** The upload key is in
   `E:\Xedine-Android-Keys` (keystore, password file, `keystore.properties`) and never goes in git (`*.jks` is
   ignored). JDK 17, the Android SDK and Gradle's cache are in `E:\android-tools` because C: is full.
   `android/build.ps1` builds the signed `.aab` (for Play) and `.apk` (to install on a phone) into
   `android/release/`.
   - This PC blocks `dl.google.com` in its hosts file, so the SDK came from the `dl-ssl.google.com` mirror.
   - A Gradle init script in `E:\android-tools\gradle-home\init.d` points Google's Maven repository there too.
   - The committed project stays standard and builds anywhere.
9. **The app opens with no internet.** The app starts at `/?source=app`, which is not cached, so a cashier
   opening it offline would have seen Chrome's error page. Now:
   - The service worker keeps a small bilingual `public/offline.html` (with "Open the till" and
     "Try again") and serves it for any page that fails offline.
   - The till's network-first copy still comes first, so a till already opened on the phone still opens
     offline.
   - In the installed app (`display-mode: standalone`, or a launch from `android-app://`), the worker is
     registered on every page (`AppServiceWorker` in the root layout); in a browser tab nothing changes.
   - Checked in Chromium with the network off: the app start and the never-opened kitchen screen show the
     offline page; the till opens from its cache.
10. **The generated project is reproducible.** `android/tools/generate-project.mjs` regenerates `android/` from
   `android/twa-manifest.json` and re-applies Xedine's changes: mavenCentral for jcenter, signing from the
   key folder, the paper-coloured adaptive icon with a themed layer. Change the app through those two files,
   never by hand.

## Consequences

- One codebase. The app is as good as the site on a phone; a web deploy is an app update, with no new upload.
- A new `.aab` upload is needed only for Android-side changes, with a higher `appVersionCode`.
- Google's app signing key fingerprint must be added to `assetlinks.json` after the first upload (one line).
- Phones without Chrome open the app in another browser's custom tab, with a small address bar.
- **Known review risk:** Google's AI-generated-content policy asks chatbot-style apps for an in-app way to report
  an offensive AI answer. The assistant has none yet. Adding one needs a small migration on the shared database
  (`ai_messages.reported_at` / `report_note` through a security-definer RPC) plus a "Report" action on each
  answer. It was not applied unattended. Do it before the production release; the closed test comes first anyway.
- Store listing text, graphics, Data safety answers and the step-by-step launch list are in `docs/play-store/`.
