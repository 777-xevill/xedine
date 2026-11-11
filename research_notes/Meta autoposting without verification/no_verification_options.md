# Getting daily posts onto Facebook and Instagram without a Meta-verified app or a third-party posting API

All sources were accessed 2026-11-04. Each citation gives the source's own date, or "undated" if the page shows none. Most pages were read through a summarising fetch tool, so check legal wording on the live page before relying on it. "Vendor" means the source sells something related, and "anecdotal" means an unverified individual report. Third-party posting APIs such as Ayrshare are out of scope.

Some sources were seen only through a search-result summary, not opened directly. This applies mainly to the vendor blogs, forum threads, plugin READMEs and cross-posting guides. For those, the match between a claim and its specific link is my best reading, so open the link before quoting it. Official pages cited with a quotation were fetched directly unless noted.

## Overall: how does each alternative score?

### Takeaway
The only route that is safe, free and works today for Facebook and Instagram is the hand-off: Xedine prepares the post and the owner taps to publish it. It takes about 6 to 10 taps a day and gives up "posts by itself". Browser automation and instagrapi work technically, but they breach Meta's terms and put the owner's account at risk. Zapier and Make can publish through their own Meta apps, but the model that fits a SaaS (Zapier White Label) is gated. YouTube Shorts just became much easier: private-only for unverified projects ended on 2 Nov 2026.

### Cited Findings
The scorecard below combines cited facts from the later sections with my own judgement. The ban-risk and owner-work columns are judgement calls, not measurements.

| Alternative | Works? | Cost | Ban risk | Owner work | Verdict |
|---|---|---|---|---|---|
| Browser automation with owner's password or cookies | Technically yes, but fragile | Server plus probably proxies (price not researched) | **High and severe:** the owner's personal account and Page are exposed | Hands over login, repeats after every checkpoint | Reject |
| instagrapi or other private API | Technically yes, but "fragile in production" per its own README | Free library; proxies extra | **High**; not quantifiable | Hands over login, handles challenges | Reject |
| Zapier, separate account per owner | Yes | Free tier to $19.99/mo per owner | Low (official OAuth) | High: English signup and setup per owner | Poor fit |
| Zapier, one account run by Xedine | Doubtful: no sourced way for an owner to connect remotely | From $19.99/mo per 750 tasks | Low on Meta's side; Zapier's terms not checked | Low if it can be made to work | Unproven |
| Zapier White Label | Yes as described by Zapier | Unknown, usage-based | Low | Low: one OAuth inside Xedine | **Worth one email** (gated) |
| Make | Yes for a single account; no multi-customer route found | Not retrieved | Low (official OAuth) | High, same as Zapier | Poor fit |
| n8n self-hosted | Needs your own Meta app, so it solves nothing | Hosting (not checked) | n/a | n/a | Reject |
| Pipedream Connect | Unconfirmed for publishing; own Meta app probably needed | Conflicting reports | n/a | Low if it worked | Unlikely |
| IFTTT | Instagram: no. It has zero actions | n/a | n/a | n/a | Reject for Instagram |
| Meta Business Suite by hand | Yes for scheduling; batch route unclear | Free | None | High per batch, likely needs a computer | Fallback only |
| Hand-off via Telegram and a share page | Yes on Android; iPhone Feed has a reported failure | About free | None | **6 to 10 taps a day** (my estimate) | **Best default** |
| YouTube Shorts via API | Yes; public uploads now allowed | Free | Low | One Google consent | **Add** |
| Google Business Profile posts | Yes for photos, once approved | Free | Low | One Google consent | **Add, poster only** |
| TikTok API | Private-only until audited | Free, but needs audit | Low | One consent | Later |
| Telegram channel | Yes | Free | None | Admin setup | Cheap add, reach unknown |

### Inferences
- A hand-off does not meet ADR 0040's promise of posting by itself. It does match the draft-then-approve rule in Xedine's CLAUDE.md. Choosing it means amending ADR 0040, and the founder should treat that as a product decision.
- The realistic risk with a hand-off is that owners stop tapping. No retention data was found, so the drop-off rate should be measured in a pilot.

### Gaps
- No source gives a measured ban rate for any route.
- Hand-off completion rates among non-technical restaurant owners were not found.

## Browser automation and unofficial libraries: terms, ban risk, and storing passwords or cookies

### Takeaway
Storing an owner's Facebook password or session cookie breaches Facebook's rule against giving others account access, and it is not acceptable for a SaaS. No reliable figure for ban rates exists, but the downside is losing the owner's personal account and Page, and one bad event could hit every customer at once.

### Cited Findings
- Facebook terms require users to "Not share your password, give access to your Facebook account to others" — [Facebook Terms, effective 1 Jan 2025; page also notes an update effective 20 Jan 2027, which I did not read](https://www.facebook.com/legal/terms)
- The same terms say "You may not access or collect data from our Products using automated means (without our prior permission)", and that Meta may "suspend or permanently disable" access for serious or repeated breaches — [Facebook Terms, effective 1 Jan 2025](https://www.facebook.com/legal/terms)
- Apps under Meta's platform terms "must not separately request or collect a Meta user's login credentials", and must not share or solicit access tokens except with a service provider — [Meta Platform Terms, updated 3 Feb 2026](https://developers.facebook.com/terms/)
- Instagram's terms say "You can't attempt to create accounts or access or collect information in unauthorized ways" — [Instagram Terms of Use, seen via search index; live page would not load in my fetch tool](https://help.instagram.com/581066165581870)
- An older copy adds that this includes "collecting information in an automated way without our express permission" — [Instagram terms, copy filed in a US court case, undated in my reading](https://www.lb7.uscourts.gov/documents/19-1861URL1Termsofuse.pdf)
- instagrapi's README says "Private API automation is fragile in production", that official APIs should be preferred for "account-owned business workflows", and that the project "is best suited for testing, research, and controlled internal automation" — [instagrapi README, undated](https://github.com/subzeroid/instagrapi)
- The same README says its "@instagrapi" Telegram group was restricted by Meta and is no longer maintained — [instagrapi README, undated](https://github.com/subzeroid/instagrapi)
- instagrapi versions before 2.6.9 had a security flaw in handling server-supplied challenge paths — [OSV advisory GHSA-ggxf-37hm-9wqf, May 2026](https://osv.dev/vulnerability/GHSA-ggxf-37hm-9wqf)
- Proxy sellers describe `challenge_required` as a security gate and `feedback_required` as a possible step toward a permanent ban. They profit from this fear, so treat it as vendor framing — [Proxidize, undated](https://proxidize.com/blog/instagram-feedback-required); [Swiftproxy, undated](https://www.swiftproxy.net/blog/understanding-the-instagram-challenge-required-error)
- Anecdotal: one developer reports a permanent ban after connecting a Claude Code agent to a Meta Ads account, and recommends logging in manually once and reusing cookies — [dev.to, undated in my reading](https://dev.to/whoffagents/claude-code-got-someones-meta-ads-account-banned-heres-how-to-automate-without-getting-flagged-513h)
- Vendor: a 2026 tutorial claims cookie reuse does not trigger bot detection the way automated login does, with no evidence offered — [Chat4Data, 2 Apr 2026](https://chat4data.ai/blog/facebook-scraper-python)
- Vendor: an ad-automation blog warns anti-automation triggers can poison the Page admin's personal account — [AdMake AI, undated](https://admakeai.com/blog/automate-facebook-without-getting-banned)
- Anecdotal: a Reddit r/automation thread reports corrupted profiles, unreliable cookies and detection across Selenium, Puppeteer and Playwright — [Reddit snapshot, 2 Mar 2026](https://reddit.sentinel-team.org/posts/1ri5hva/snapshots/2026-03-02T18%3A53%3A12.935826Z)
- Anecdotal: a freelancer proposal concedes that a Facebook auto-poster risks policy breaches and restricted accounts, and another freelancer's "bans dropped by 78%" claim has no data behind it — [Freelancer listing, undated](https://www.freelancer.de/projects/api/automated-facebook-group-poster)

### Inferences
- **The password clause is the clear breach.** The automation clause is worded around accessing or collecting data, so its application to posting alone is arguable. A bot logged in with an owner's credentials still falls under the password and account-access clause either way.
- **A session cookie is no better than a password.** It grants the same access and can sidestep two-factor login, so it needs the same treatment. Meta's platform terms don't bind Xedine directly if it has no Meta app, but the intent is the same, and getting an app later would bring them into play.
- **Blast radius is the real problem.** A Facebook Page is run from a personal profile, so a checkpoint can lock the owner out of both. A Xedine database breach would expose every owner's Facebook account. Running logins from one server location also makes all accounts look alike, which would plausibly tie them together for enforcement.
- **It also fails on effort.** Checkpoints require the owner to respond, for example with a code or ID check, so "automatic" would regularly turn into support tickets for a solo founder.
- Do not build this, including the instagrapi variant.

### Gaps
- I found no first-hand, dated ban statistics from Reddit or GitHub for Page posting by Playwright or Puppeteer, nor any 2026 figure for instagrapi. The search results were dominated by vendors, so the true rate is unknown.
- I could not confirm a live copy of Instagram's automation sentence, because the official page would not render in my tool.
- Legal exposure for Xedine under Bangladeshi law, or from Meta acting against the company, was not researched.

## Zapier, Make, n8n, Pipedream and IFTTT: posting to a customer's Page or Instagram

### Takeaway
Zapier and Make can post through official OAuth without a Meta app of your own, but both are built for one account connecting its own Pages, not for a SaaS with many non-technical customers. Self-hosted n8n does need your own Meta app, so it does not solve the problem. IFTTT cannot publish to Instagram at all.

### Cited Findings
**Zapier**
- Instagram for Business connects by OAuth, and the Publish Photo and Publish Video actions need permission to create content on the linked Page — [Zapier help, undated](https://help.zapier.com/hc/en-us/articles/8496101110541)
- A Zapier template says video publishing "will only work for an Instagram Business Account and not a Personal or Creator Account" — [Zapier templates, undated](https://zapier.com/apps/facebook-pages/integrations/instagram-for-business)
- Pricing: Free has 100 tasks a month. Professional starts at 750 tasks for $19.99/mo billed annually or $29.99 monthly, with one seat. Team starts at 2,000 tasks for $69/mo billed annually, with 25 users and shared connections — [Zapier pricing, updated 3 Nov 2026](https://zapier.com/pricing)
- Zapier White Label says "Users connect their accounts inside your product without ever logging in to Zapier", with Zapier visible only on the standard OAuth screen — [Zapier White Label, undated](https://zapier.com/developer-platform/white-label)
- White Label is "currently in limited access", by email to whitelabel@zapier.com — [Zapier docs, undated](https://docs.zapier.com/white-label/getting-started)
- In a Zapier community thread, an agency was told clients would hold their own Zapier accounts and pay directly, and that the agency could not pay on their behalf — [Zapier Community, undated](https://community.zapier.com/how-do-i-3/manage-zapier-for-multiple-companies-but-not-their-app-11875)

**Make**
- The connection needs a Facebook account with admin-equivalent tasks on the Page linked to Instagram — [Make help, undated](https://make.com/en/help/app/instagram-business)
- Custom app credentials are optional, under advanced settings, which means the default connection does not need your own app — [Make help, undated](https://make.com/en/help/app/instagram-business)
- Community reports say Creator accounts are rejected and connection failures are common — [Make Community, undated](https://community.make.com/t/instagram-business-account-connexion/40565); [IM006 OAuth thread, undated](https://community.make.com/t/instagram-for-business-oauth-fails-with-im006-token-already-exist-token-not-found/115997)

**n8n**
- "Regardless of the authentication method you choose, you'll need a Meta for Developers account and a Meta app." — [n8n docs, undated](https://docs.n8n.io/integrations/builtin/credentials/facebookgraph/)
- Self-hosted or cloud makes no difference to the Graph API node, and Instagram publishing needs images at a public URL — [Keyapi guide (third party), undated](https://www.keyapi.ai/blog/n8n-instagram-graph-api-node-guide)

**Pipedream**
- Connections default to Pipedream's OAuth client, but that client cannot fetch end-user credentials or trigger workflows with end-users' accounts in production — [Pipedream docs, undated](https://pipedream.com/docs/connect/managed-auth/oauth-clients.md)
- A community post says the default Facebook connection requests only email, public_profile and pages_manage_engagement, and other scopes need your own Facebook app — [Pipedream Community, undated](https://pipedream.com/community/t/does-pipedream-support-facebook-and-meta-ads/14358)
- Pricing reports conflict: $99/mo for 100 external users per one third party, against free managed auth up to 1,000 users per a community thread — [UsagePricing, undated](https://www.usagepricing.com/blueprint/pipedream); [Pipedream Community, undated](https://pipedream.com/community/t/what-is-the-user-limit-and-pricing-model-for-pipedream-connect-at-scale/12588)

**IFTTT**
- Instagram on IFTTT has four triggers and zero actions, and needs a business account — [IFTTT Instagram page, undated](https://ifttt.com/instagram)

### Inferences
- **Whose app:** Zapier's and Make's connections appear to run on their own Meta apps, since no developer setup is asked of the user. Neither page says so outright. This is what lets Xedine avoid verification, at the price of depending on their continued Meta access.
- **Rough Zapier volume:** at one publish each to Facebook and Instagram per day, one restaurant uses about 60 tasks a month. That makes 750 tasks enough for about 12 restaurants at $19.99/mo, assuming each publish counts as one task.
- **The blocker is the connection, not the price.** With one Xedine-owned account, the owner must complete OAuth inside the founder's Zapier or Make session. Without a remote connection link, the founder would need the owner's Facebook login, which brings back the password problem. Separate accounts per owner avoid this, but an English workflow tool is not realistic for this audience.
- **White Label is the only option here that fits the product.** It is gated and unpriced, but asking costs one email.
- **n8n gains nothing:** a Xedine-owned Meta app is exactly the thing the founder is trying to avoid, and asking each owner to create their own is unrealistic.

### Gaps
- Make's prices and its embedded product, Make Bridge, were not confirmed. My search returned nothing useful on either.
- Whether Zapier's terms permit running many unrelated customers' Pages from one account was not checked.
- Whether Zapier has a remote "connect your account" link for outside clients was not confirmed.
- Whether Zapier's and Make's actions support Reels on the Facebook Page side, not only Instagram, was not confirmed.
- Pipedream's Instagram publishing support was not found in the docs I read.
- IFTTT's Facebook Pages actions were not checked.
- n8n's self-hosting cost and licence terms for commercial multi-customer use were not checked.
- The standard limit on an unverified Meta app, namely that it works only for people with a role on that app, is from my prior knowledge and was not re-verified here. Whether adding each owner as a tester is workable is untested.

## Meta Business Suite and Creator Studio: bulk scheduling by hand

### Takeaway
Scheduling by hand certainly works, and a bulk video or Reels upload exists on the Facebook side, but sources conflict on batch size, time window and CSV import. I could not retrieve Meta's own help text. Treat "an owner schedules a month in one sitting" as unproven until tested.

### Cited Findings
- Meta has a help page titled "Bulk upload multiple videos in Meta Business Suite". Only the title loaded in my tool — [Meta Business Help Centre, undated](https://www.facebook.com/business/help/563248174101110)
- A search snippet of that page says bulk-uploaded videos can go to only one Page, not several. It referred to Creator Studio, so the wording may be out of date — [Meta Business Help Centre, undated](https://www.facebook.com/business/help/563248174101110)
- A 2026 trade article reports a calendar-style Content Planner in Creator Studio and a bulk Reels upload for "multiple Reels", with no batch size stated — [SocialDay, published 6 Jul 2026, updated 7 Aug 2026](https://socialday.live/features/facebooks-content-planner-and-bulk-reels-upload-arrive-as-meta-squares-up-to-thi)
- That article says Business Suite restricts scheduling to "up to a month ahead of time" — [SocialDay, 2026](https://socialday.live/features/facebooks-content-planner-and-bulk-reels-upload-arrive-as-meta-squares-up-to-thi); another guide reports a 30-day limit — [SocialBu, undated](https://socialbu.com/blog/bulk-schedule-facebook-posts); other results in my search cited a 75-day window
- CSV import is contradictory, even within one site: one guide says up to 25 posts per upload, text-only with image URLs, no Stories or Reels — [SocialRails guide, undated](https://socialrails.com/blog/bulk-social-media-scheduling-guide); another SocialRails page says there is no bulk upload button or file format, and that the 25 is really a per-day scheduling cap — [SocialRails scheduling, undated](https://socialrails.com/blog/category/scheduling)
- A competitor says Meta's tool requires scheduling each post manually — [SocialBu, undated](https://socialbu.com/blog/bulk-schedule-facebook-posts)

All of the guides above except Meta's own page are competitor or trade sources, with an interest in making Meta's tool look weak.

### Inferences
- **What Xedine could prepare regardless:** a ZIP of numbered posters and Reels plus a caption sheet, one row per date. That works with any route. An upload on a phone looks unlikely to be practical, so the owner would probably need a computer, which most of this audience won't sit down to use.
- **Better version:** a person does the scheduling. If an owner gives the founder or a helper Page access through Meta's own roles, no password changes hands and one person can load a week's batch per Page. This trades owner taps for founder hours and only suits a paid tier or early pilots. This is my idea and not something I found documented as a service model.
- A monthly batch also removes the "fresh daily" value, because dish availability and offers change.

### Gaps
- Official batch limits, scheduling window, and whether Instagram Reels can be included in bulk uploads could not be verified. Meta help pages do not render in my fetch tool, so a manual check in Business Suite would settle this in minutes.
- Whether the mobile Business Suite app offers bulk upload is unknown.
- Whether "Creator Studio" in the 2026 article is the same product as the older tool, or a loose name for a Business Suite feature, is unclear.

## Hand-off flow: Web Share, deep links, Android intents, captions and tap count

### Takeaway
A PWA button using the Web Share API can hand a poster or Reel to the Instagram app on Android, and this has been reported working for Feed and Reels. On iPhone, Reels were reported working and Feed reported failing. Caption pre-fill is not available, so the caption must go through the clipboard. Expect about 6 to 10 taps per post.

### Cited Findings
**Web Share API**
- It needs HTTPS and a user gesture such as a button tap, and cannot be launched "at arbitrary points by a script" — [MDN, modified 16 Jul 2026](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
- It accepts `files`, with `.mp4`, `.jpeg` and `.png` among usually shareable types, and MDN says to check `navigator.canShare()` first because sharing can still fail — [MDN, modified 16 Jul 2026](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
- It is "not Baseline" — [MDN, modified 16 Jul 2026](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
- Support is listed for Chrome for Android 156, Safari on iOS 12.2 to 27.2, and Samsung Internet 8.2 to 30, with no Android WebView entry on the page as I read it — [Can I Use, usage data Sep 2026](https://caniuse.com/web-share)

**Real-world reports with Instagram (anecdotal, the most direct evidence I found)**
- Android: sharing to Instagram as a Feed post or a Reel worked. iPhone: Reels worked, but choosing Feed gave "We're sorry, but something went wrong". The same files uploaded fine by hand. The thread had no replies in what I could read — [Meta developer forum, "about 2 years ago", so roughly 2024](https://developers.secure.facebook.com/community/threads/1094504835445267/)
- On iOS Safari, a share with `text` as well as files reportedly ignored the files — [WebKit bug 251500, Feb 2023](https://lists.webkit.org/pipermail/webkit-unassigned/2023-February/1084883.html)
- A related report covers sharing an image to Facebook from Safari on iOS. I saw only the snippet — [Apple developer forums, undated](https://developer.apple.com/forums/thread/665812)

**Captions**
- Facebook's sharing guide says "your app should not pre-fill any content to share" — [Facebook Sharing for Android, undated](https://developers.facebook.com/docs/sharing/android/)
- Plugin notes say the Instagram app stopped accepting pre-filled captions on iOS and Android, and that the caption is instead copied to the clipboard — [InstagramPlugin README, undated and likely old](https://github.com/muhsin-k/InstagramPlugin)
- Instagram's own Feed and Stories sharing docs do not mention captions — [Sharing to Feed, undated](https://developers.facebook.com/docs/instagram-platform/sharing-to-feed/); [Sharing to Stories, undated](https://developers.facebook.com/docs/instagram-platform/sharing-to-stories/)

**Native intents and deep links**
- Android Feed: an implicit intent with `EXTRA_STREAM` loads media into Instagram's composer. Video must be MP4 or MKV, 3 seconds to 10 minutes, at least 640x640 — [Sharing to Feed, undated](https://developers.facebook.com/docs/instagram-platform/sharing-to-feed/)
- iOS Feed: saves a `.ig` or `.igo` image for the Document Interaction flow, documented for PNG and JPEG — [Sharing to Feed, undated](https://developers.facebook.com/docs/instagram-platform/sharing-to-feed/)
- Stories: `instagram-stories://share?source_application=<APP_ID>` on iOS with the media on `UIPasteboard`, and the `com.instagram.share.ADD_TO_STORY` intent on Android. "Beginning in January 2023, you must provide a Facebook AppID" — [Sharing to Stories, undated](https://developers.facebook.com/docs/instagram-platform/sharing-to-stories/)
- Facebook on Android: `ShareVideoContent` or `ShareMediaContent` through the SDK's Share dialog — [Facebook Sharing for Android, undated](https://developers.facebook.com/docs/sharing/android/)
- Telegram bots can attach a button that copies text to the clipboard, limited to 1 to 256 characters, since Bot API 7.11 — [GramIO type mirror of Bot API, undated](https://jsr.io/@gramio/types/doc/objects/~/TelegramCopyTextButton)

### Inferences
Estimated taps (my own walk-through, not measured on a device):

| Path | Steps | Taps |
|---|---|---|
| Android, Telegram to PWA, Instagram Reel | Open link; tap "Copy caption and share"; pick Instagram; pick Reels; Next; paste caption (long-press, Paste); Share | 7 to 9 |
| Android, poster to Feed | Same, with Feed instead of Reels | 7 to 9 |
| iPhone, Reel | Same; caption paste is one extra confirm | 8 to 10 |
| iPhone, poster to Feed | Reported failing; test it. Fallback is save to Photos, then post from Instagram | 10 or more |
| Telegram only, no page | Open media; save or share; pick app; caption from copy button | 8 to 10 |

- **Best flow to test:** Telegram message with the media preview, then a "Post" button that opens the PWA page in the real browser. A single button writes the caption to the clipboard, then calls `navigator.share({ files })`. Pass files only, because of the iOS report above.
- **PWA and link-out cautions:** the native intents and URL schemes above need a native Android or iOS app, and a web page cannot use them to pass files. A Telegram-launched in-app browser may not support Web Share, so the link should open the system browser. Fetch the file into memory before the tap, as a slow download could break the user gesture.
- **The 256-character limit matters:** Telegram's copy button is too short for most captions with hashtags, especially in Bangla. Copy from the PWA page instead, or keep the Telegram version short.
- **Stories are a side route, not the answer:** a Meta App ID requires an app but the docs I read do not require Business Verification for it. Stories also have no captions in the way a post has, and they need a native app for the file hand-off.
- **Audience:** the iPhone issue matters less if owners are mainly on Android, which fits my impression of Bangladesh's market, but I did not source a share figure.

### Gaps
- No 2026 test report was found for Web Share to Instagram or Facebook, so the evidence is one undated forum thread and older bugs. A device test on one mid-range Android and one iPhone is needed before building. Check: Feed and Reels on each, Facebook on each, and whether the caption clipboard survives the switch to the other app.
- **Facebook identity is the biggest unknown:** whether the Facebook app's share target posts as the owner's personal profile or lets them pick their Page, and whether a video goes in as a Reel. If it defaults to the personal profile, the owner would post to the wrong place.
- Whether the Meta Business Suite app appears as a share target and can post to Facebook and Instagram together was not found. If it can, it may be the best single-tap target, so test it first.
- Facebook's official Share to Reels doc returned 404 at the URL I tried, so its current intent and requirements were not verified.
- Android WebView and Telegram in-app browser support for Web Share with files was not verified.

## WhatsApp Business API limits, Telegram bot file limits, and WhatsApp Channels or Status

### Takeaway
Telegram is the cheaper and roomier hand-off channel: 50 MB sends, no per-message charge in what I read, and it is already built. WhatsApp's Cloud API caps video at 16 MB, which should still fit an 8-second Reel. WhatsApp Channels have no official API according to vendor sources, and I found nothing on a Status API.

### Cited Findings
- WhatsApp Cloud API limits: images 5 MB (JPEG, PNG, static WebP), video 16 MB (MP4 or 3GP with H.264 video and AAC audio), documents 100 MB — [Meta WhatsApp docs, undated](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media/)
- Telegram bots can send files "of any type of up to 50 MB in size", and `getFile` downloads work up to 20 MB — [Telegram Bots FAQ, undated](https://core.telegram.org/bots/faq)
- A self-hosted Local Bot API Server allows uploads up to 2,000 MB — [Telegram Bot API, undated](https://core.telegram.org/bots/api)
- Telegram rate limits: about one message per second per chat, 20 per minute in groups, and about 30 per second in bulk without paid broadcasts — [Telegram Bots FAQ, undated](https://core.telegram.org/bots/faq)
- Channels: vendors state the official Cloud API has "Not Supported (0% functionality)", and that Channels have "no API, no automation" in 2026 — [Whapi.Cloud, undated, sells an alternative](https://whapi.cloud/how-to-automate-whatsapp-channels-api); [Kanal guide, 2026](https://getkanal.com/blog/whatsapp-channels-feature-guide.md)
- Whapi.Cloud offers Channel posting through its own gateway, not through Meta's API — [Whapi.Cloud, undated](https://whapi.cloud/blog/whatsapp-channel-api-automation)

### Inferences
- An 8-second 1080p Reel at normal bitrates should be about 5 to 15 MB, which fits both channels, but the render settings should enforce a limit below 16 MB if WhatsApp is ever used.
- Unofficial WhatsApp gateways look like the same kind of risk as browser automation: they could get a restaurant's main business number restricted. I would not use them.
- Channels and Status remain free for manual use. The same share button could list WhatsApp as a target, so an owner can post the day's poster to Status in a few taps. For a neighbourhood restaurant whose regulars are saved contacts, that may be a useful extra, but I found no reach data for it.

### Gaps
- No official Meta statement on Channels or Status APIs was found. "No API" rests on vendors, one of which sells a workaround.
- Bangladesh's WhatsApp template rates and the 24-hour-window rule were not retrieved. From prior knowledge, a daily business-initiated send outside that window needs a paid template, so this should be checked before choosing WhatsApp over Telegram.
- How many Bangladeshi restaurant owners use Telegram at all was not researched. Xedine's existing Telegram rollout is the best evidence available.

## Other platforms: TikTok, YouTube Shorts, Google Business Profile, Telegram channels

### Takeaway
YouTube Shorts is the standout: Google reversed its private-only rule for unverified projects on 2 Nov 2026, and the upload limit is now 100 calls a day. OAuth verification of the consent screen still matters above 100 users. TikTok remains private-only until an audit passes, and Google Business Profile is free for photo posts but needs an access application.

### Cited Findings
**YouTube**
- Uploads from unverified API projects "are no longer restricted to private viewing mode", which reverses the 28 Jul 2020 policy — [YouTube API revision history, entry 2 Nov 2026](https://developers.google.com/youtube/v3/revision_history)
- `videos.insert` costs 1 unit in the Video Uploads bucket and is limited to 100 calls a day. The page also says "Videos uploaded from unverified API projects are not restricted to private viewing mode." — [videos.insert reference, undated](https://developers.google.com/youtube/v3/docs/videos/insert)
- From 1 Jun 2026, `videos.insert` and `search.list` moved to their own quota buckets, with more available through the Quota Extension Form — [YouTube API revision history, entry 1 Jun 2026](https://developers.google.com/youtube/v3/revision_history)
- Before that, on 4 Dec 2025, the upload cost fell from about 1,600 units to about 100 — [YouTube API revision history, entry 4 Dec 2025](https://developers.google.com/youtube/v3/revision_history)
- Some uploads may still default to private because of creator account settings, and the entry does not mention OAuth verification — [YouTube API revision history, entry 2 Nov 2026](https://developers.google.com/youtube/v3/revision_history)
- Apps using sensitive or restricted scopes without verification may show an "unverified app" screen, and are limited to "100 new users in total" — [Google Cloud help, undated, ©2026](https://support.google.com/cloud/answer/7454865)
- Third-party articles still describe the old private-only rule. They predate the change, so don't rely on them — [Activepieces, undated](https://www.activepieces.com/blog/youtube-api-quota-exceeded-how-to-fix-and-avoid-it)

**TikTok**
- "Unaudited API Clients can only post contents in `SELF_ONLY` viewership", up to 5 users in 24 hours, and all accounts must be private when posting — [TikTok Content Sharing Guidelines, undated](https://developers.tiktok.com/doc/content-sharing-guidelines)
- Unaudited private restriction is also on the Direct Post reference — [TikTok Direct Post reference, updated 4 Aug 2026](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
- Audit rules require the client to serve a wide audience. An unacceptable example is "A utility tool to help upload contents to the account(s) you or your team manages" — [TikTok Content Sharing Guidelines, undated](https://developers.tiktok.com/doc/content-sharing-guidelines)
- Audited apps still have creator caps, and about 15 posts per day per creator account — [TikTok Content Sharing Guidelines, undated](https://developers.tiktok.com/doc/content-sharing-guidelines)
- Vendor: the audit takes weeks with variable outcomes, and posts made before the audit stay private — [bundle.social, 2 Aug 2026](https://bundle.social/blog/tiktok-api-approval)

**Google Business Profile**
- Access requires a Google Account, a valid business reason, a Cloud project and a business website URL, with a review within 14 days — [Google overview, undated](https://developers.google.com/my-business/content/overview?authuser=6); [Google FAQ, undated](https://developers.google.com/my-business/content/faq)
- A limit of 0 requests per minute means not yet approved, and 300 means approved — [Unified.to guide, undated](https://unified.to/blog/how_to_set_up_google_business_profile_api_access_and_get_oauth_2_credentials)
- A third party claims a 60-day-old profile is required, and I found no official confirmation — [SlashPost, 2026](https://slashpost.ai/blogs/google-business-profile/google-business-profile-api-documentation-2026)
- Local Posts can be created by `POST .../localPosts` with event, offer and call-to-action (including `ORDER`) types. Examples show `PHOTO` only, and video is not mentioned — [Google posts guide, undated](https://developers.google.com/my-business/content/posts-data)

### Inferences
- **YouTube:** the 100-a-day limit appears to apply per project, so one daily Reel per restaurant would fit about 100 restaurants before a quota request. Because this rule is two days old, test one public upload before planning around it. Consent-screen verification is a separate process from Meta's business check, and it is probably needed by the time Xedine passes 100 owners, because `youtube.upload` is likely a sensitive scope.
- **TikTok:** Xedine is a customer-facing product where each restaurant connects its own account, which may be defensible under the audit rule, but "posts made for restaurants by a generator" could draw questions about authentic original content. Apply later if owners ask for it.
- **Google Business Profile:** this may have the best value for a restaurant, since posts show up when customers search nearby. It only takes the daily poster, so no Reel. Owners need a verified profile, which many may lack, and Xedine's own website should satisfy the URL requirement.
- **Telegram channels:** a bot added as a channel admin can post without verification, per my knowledge of the Bot API (not re-read in this pass). Customer reach in Bangladesh is probably small, so this is cheap to add but not a replacement.

### Gaps
- Whether `youtube.upload` is formally classed as a sensitive scope, and the verification time for it, was not confirmed. The Google page I read speaks generally.
- Whether uploaded vertical 8-second videos are always treated as Shorts was not re-verified.
- TikTok's "upload to creator's inbox as draft" path may suit a hand-off and might not need the same audit, but I did not verify this.
- Whether TikTok audit approval is realistic for a solo Bangladeshi developer is unknown.
- GBP availability and post reach in Bangladesh were not researched.

## Facebook Page cross-post: can Instagram auto-share to Facebook once connected?

### Takeaway
Probably yes: several third-party guides describe a linked-account setting that shares Instagram posts to Facebook, which could cut two publishes to one. No official Meta help page was retrieved, guides disagree on where the setting lives for Pages, and one reports that Reels can arrive looking like a photo.

### Cited Findings
- Guides describe linking accounts in Accounts Center and using an automatic sharing toggle, or a path through Connected experiences, then Sharing across profiles. The summary I read did not tie each path to one guide — [Metricool, undated](https://metricool.com/crossposting-instagram-facebook/); [Minter.io, undated](https://minter.io/blog/how-to-automatically-crosspost-instagram-content-to-facebook)
- For Pages, one guide says to use Meta Business Suite, because the personal-profile switch doesn't apply. Another says the setting is under "Also share on Facebook" in Accounts Center. These conflict — [TimeToPost, undated](https://timetopost.co/blog/instagram-facebook-crossposting-guide/); [Technobezz, undated](https://www.technobezz.com/how-to-fix-instagram-sharing-to-facebook-not-working)
- Requirements listed are a creator or business Instagram account, a Facebook Page, and a personal Facebook account with admin access to that Page — [WhatsTheProcessFor, undated](https://www.whatstheprocessfor.com/process/setting-up-instagram-to-auto-crosspost-to-your-facebook-business-page)
- One source says Reels can appear on Facebook as just a photo, and that Business Suite or API publishing is more likely to give a real Reel. It is a single source — [TimeToPost, undated](https://timetopost.co/blog/instagram-facebook-crossposting-guide/)
- Two sources report recent changes: a migration around 23 Apr 2026 in how accounts link, and Accounts Center being renamed Meta Account. Each rests on a single source — [Technobezz, 2026](https://www.technobezz.com/how-to-share-a-facebook-post-to-instagram); [JoinBrands, 2026](https://joinbrands.com/blog/posting-facebook-to-instagram/)

### Inferences
- For a hand-off, this is valuable: Instagram-first means the owner taps through once and Facebook follows.
- It could hurt owners who are Facebook-first and have no Instagram, which fits my impression of Bangladeshi restaurants but which I did not source. They would either need to create an Instagram account or use a direct Facebook share.
- Xedine could offer a one-time setup guide with Bangla screenshots, but Meta's menu paths are moving, so it would need upkeep.

### Gaps
- No official Meta help page confirmed the feature, its Page behaviour, or whether a shared Reel stays a Reel in 2026. A test on a real linked Page takes about ten minutes and would settle all of these.
- All findings in this section come from search-result summaries of third-party guides, so the match between each claim and its link is uncertain, especially the 23 Apr 2026 migration and the rename.
