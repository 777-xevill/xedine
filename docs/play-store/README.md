# Launching Xedine on Google Play (ADR 0065)

The app is ready to upload: **`android/release/xedine-1.0.0-1.aab`** (signed with the upload key). The listing
text is in [LISTING.md](LISTING.md), the pictures in [graphics/](graphics/). This page is the order to do things
in Play Console, with every answer written out.

## 0. Before anything: back up the key

Copy the whole folder **`E:\Xedine-Android-Keys`** to a private place (Google Drive, a USB stick). It holds the
upload key and its password. Never put it in git or in a chat. If it is ever lost, Play Console can reset it
(App integrity → "Request upload key reset"), but that takes days.

## 1. Developer account (one time)

1. Open https://play.google.com/console/signup with the Google account that should own Xedine.
2. Pick the account type:
   - **Organisation**: needs a D-U-N-S number for the business. You go straight to production after review.
   - **Personal**: faster to open, but Google requires a **closed test with at least 12 testers for 14 days
     in a row** before you can publish to everyone (step 6).
3. Pay the one-time **US$25** and verify your identity (NID or passport) and phone. Verification can take a few
   days.

## 2. Create the app

Play Console → **Create app**:

| Field | Answer |
| --- | --- |
| App name | `Xedine` |
| Default language | English (United States) – en-US |
| App or game | App |
| Free or paid | Free |
| Declarations | tick both (Developer Program Policies, US export laws) |

## 3. "Set up your app" (Dashboard → App content)

**Privacy policy:** `https://xedine.org/privacy`

**App access:** choose *All or some functionality is restricted* → *Add instructions*:

> Name: Demo restaurant
> Username: `owner@demo-kacchi.xedine.example`
> Password: `demo-password-123`
> Other information: Xedine is for restaurant owners and their staff, so it needs an account. This demo
> restaurant has sample data only. The till: long-press the app icon → Till (or open the menu → Till), pair
> the device to the "Dhanmondi" branch, then use staff PIN 1234.

**Ads:** No, my app does not contain ads.

**Content rating:** start the questionnaire with the email support@xedine.org, category *All other app types*.
Answer **No** to violence, fear, sexuality, language, controlled substances, crude humour, gambling and
digital purchases. For *"Does the app allow users to interact or exchange content?"*, answer **Yes**: the
restaurant's own posters and videos are published to its Facebook, Instagram and TikTok pages. Location
sharing with other users: **No**. Expected result: Everyone / PEGI 3.

**Target audience and content:** age group **18 and over** only. "Could your app unintentionally appeal to
children?" **No**.

**News app:** No. **Government app:** No. **Financial features:** *My app doesn't provide any financial
features* (Xedine records sales; it does not move money). **Health:** *My app does not have any health
features*. **Advertising ID:** No.

**Data safety:** see the table in section 7 below.

**Account deletion:** delete-account URL `https://xedine.org/data-deletion` (inside the app: the menu → the
bottom of the sidebar → "Delete my account").

## 4. Store listing

Grow users → Store presence → **Main store listing**: paste from [LISTING.md](LISTING.md), then upload:

- App icon: `graphics/icon-512.png`
- Feature graphic: `graphics/feature-graphic-en.png`
- Phone screenshots: `graphics/phone-en-1-leaks.png` … `phone-en-7-growth.png` (in that order)
- Tablet screenshots (7-inch and 10-inch): `graphics/tablet-en-*.png`

Then *Manage translations → Add your own translations → Bangla (bn-BD)* and paste the Bangla blocks, with
`feature-graphic-bn.png`, `phone-bn-*.png` and `tablet-bn-*.png`.

Store settings: category **Business**, email **support@xedine.org**, website **https://xedine.org**.

## 5. First upload: internal test, then add Google's key fingerprint

1. Test and release → Testing → **Internal testing** → Create new release.
2. Play App Signing: keep **"Use Google-generated key"** (recommended).
3. Upload `android/release/xedine-1.0.0-1.aab`. Release name `1.0.0`. Release notes: `First release.`
4. **Important, right after the upload:** Test and release → Setup → **App integrity** → *App signing* tab →
   copy the **SHA-256 certificate fingerprint** of the *App signing key certificate*. Give it to Claude ("add
   this Play fingerprint to assetlinks"), or add it yourself as a second entry in
   `public/.well-known/assetlinks.json` and in `fingerprints` in `android/twa-manifest.json`, then push.
   **Without it, the app from Play opens with a browser address bar on top.**
5. Testers tab: add your own Gmail, open the opt-in link on your phone and install. Check:
   - no address bar at the top;
   - email and Google sign-in both work;
   - the till opens from a long press on the icon;
   - "Delete my account" is at the bottom of the menu.

## 6. Closed test (personal accounts only): 12 testers, 14 days

Testing → **Closed testing** → create a track, upload the same `.aab` (Play keeps it), and add at least **12
testers** by Gmail address or a Google Group. Owners you know, staff, friends. Each must accept the invite and
keep the app installed. After 14 days, Play Console shows **Apply for production**. Answer its short
questions honestly: who tested, what you fixed.

Before applying for production, add the AI "Report this answer" button (section 8).

## 7. Data safety answers

Overview questions:

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Account creation methods | Username and password · OAuth (Google, Facebook) · Other: phone number with a one-time code from our Telegram bot |
| Do you provide a way for users to request that their data is deleted? | Yes – `https://xedine.org/data-deletion` |
| Data shared with third parties? | **No** for every type. Hosting (Supabase, Cloudflare), the AI providers and Telegram process data for Xedine as service providers. Posting to the restaurant's own Facebook/Instagram/TikTok happens because the owner connected those pages and switched it on. Google's form counts neither as "sharing". |

Data types **collected** (none sold, none used for ads, none processed only ephemerally):

| Category → type | Required or optional | Purposes |
| --- | --- | --- |
| Personal info → Name | Required | App functionality, Account management |
| Personal info → Email address | Optional (phone sign-in has none) | App functionality, Account management, Developer communications |
| Personal info → Phone number | Optional | App functionality, Account management |
| Personal info → User IDs | Required | App functionality, Account management |
| Financial info → Other financial info (the restaurant's sales, costs, purchases and salaries) | Required | App functionality |
| Location → Precise location (only when the owner taps "use my location" for a branch) | Optional | App functionality |
| Photos and videos → Photos (dish photos, logo, bill and bazar photos) | Optional | App functionality |
| App activity → App interactions (who voided, refunded or changed what: the audit log) | Required | App functionality, Fraud prevention / security / compliance |
| App activity → Other user-generated content (questions to the assistant, notes, complaints, checklists) | Optional | App functionality |
| Device or other IDs (the paired till's device ID) | Optional | App functionality, Fraud prevention / security / compliance |

## 8. Known review risk: AI answers need a "Report" button

Google's AI-generated content policy asks apps with a chatbot to let people **report an offensive AI answer
inside the app**. Xedine's assistant has no such button yet. It needs a small database change
(`ai_messages.reported_at` and `report_note`, set through a security-definer function by the message's own
user) plus a "Report" action under each answer. It was left for you to approve because it changes the live
database. Ask Claude: "add the report button for AI answers (ADR 0065 §8)".

## Later releases

- **Website changes reach the app by themselves.** Deploy the site as usual; no new upload.
- **Only Android-side changes need a new upload** (name, icons, shortcuts, colours, a new Bubblewrap):
  1. Raise `appVersionCode` (and `appVersion`) in `android/twa-manifest.json`.
  2. Run `node android/tools/generate-project.mjs`.
  3. Run `powershell -ExecutionPolicy Bypass -File android\build.ps1`.
  4. Upload the new `.aab` from `android/release/`.
- Once the app is public, `prefer_related_applications` in `public/manifest.webmanifest` can be set to
  `true`, so Chrome on Android offers the Play app instead of installing the site.
