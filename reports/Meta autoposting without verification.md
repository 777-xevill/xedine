# Rent an approved Meta app now

Xedine cannot post to other people's Facebook Pages and Instagram accounts through its own Meta app without Business Verification, and no login type or app setting gets around that. The one route that keeps ADR 0040's "posts by itself" promise is to rent access from a posting company whose Meta app is already approved. **Upload-Post at $50 a month covers up to 25 restaurants and has the clearest written permission for this use**, and Outstand at a flat $129 becomes cheaper past 50 restaurants. That is not zero, but at the rate implied in ADR 0008 it is about ৳6,100 a month, less than three pilot subscriptions. The only free route that is safe is a tap-to-post hand-off: Xedine sends the finished post on Telegram and the owner publishes it in about 7 to 10 taps. That breaks the "posts by itself" promise, so keep it as the fallback. Never store an owner's Facebook password or cookies, because that clearly breaks Facebook's terms and puts the owner's personal account at risk. Whether a Bangladeshi individual or sole proprietor can pass verification is still unanswered, because that research track was stopped early. Most evidence on the posting companies comes from the companies themselves, so test before trusting it.

## Every Meta route to other people's accounts ends at one gate

Meta gives each permission one of two levels. **Standard Access** works only for people who hold a role on your app. **Advanced Access** works for anyone, but Meta approves it permission by permission and it "requires App Review and Business Verification" ([Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview)). App Review means Meta staff check screen recordings of your app and test it themselves. Business Verification means proving your legal business exists. Restaurant owners hold no role on Xedine's app, so Xedine needs Advanced Access on every publishing permission.

For Facebook that means `pages_manage_posts`, plus the `pages_read_engagement` and `pages_show_list` permissions it depends on ([Permissions reference](https://developers.facebook.com/docs/permissions)). Facebook Reels use the same three, with a Page token from someone allowed to create content on that Page ([Reels guide](https://developers.facebook.com/docs/video-api/guides/reels-publishing)). A token is a digital key that lets an app act for someone. Instagram through Facebook Login needs `instagram_content_publish` and `instagram_basic` as well, and also `ads_management` and `ads_read` if the person's Page role came through Business Manager ([Instagram publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)).

Meta's pages are not fully consistent. Some say verification "is required for all apps making requests for Advanced Access" ([Permissions reference](https://developers.facebook.com/docs/permissions)), while others say you "may be prompted" ([App Review guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide)). My reading is that the softer wording is about whether an app needs Advanced Access at all, so Xedine should plan on verification being mandatory. A second conflict is unresolved. One page says Access Verification "is no longer required" ([Access Verification](https://developers.facebook.com/docs/development/release/access-verification)), while another still blocks apps from serving other businesses until the owner is verified as a Tech Provider, meaning a company approved to build tools for other businesses ([Tech Providers](https://developers.facebook.com/docs/development/release/tech-providers)). The Tech Providers page is probably out of date, but Meta does not confirm this.

**Facebook Login for Business does not help.** It needs a business-type app, replaces the permission list with a `config_id`, and still needs Advanced Access to serve businesses you don't own. Its best token type, which never expires, is for tech providers only ([Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business)). `meta.ts` already supports the `config_id` option, but using it would not change Xedine's position.

### Without verification, you get about 50 testers and a visibility problem

An app used only by people with a role on it needs neither verification nor App Review ([Business Verification](https://developers.facebook.com/docs/development/release/business-verification); [App Review](https://developers.facebook.com/docs/app-review)). A restaurant owner can technically become a Tester using an ordinary Facebook account, with no developer account. They accept in Facebook Settings and must confirm they are working on the developer's behalf. Most apps not linked to a verified business can have only about 50 testers ([App Roles](https://developers.facebook.com/docs/development/build-and-test/app-roles)). A paying customer is not "working on the developer's behalf", and Standard Access is "intended for apps that will only be used by people who have roles on them" ([Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels)). The notes found no text that explicitly bans customer testers and no stated penalty, so the risk is unknown rather than proven low.

**The bigger problem affects Xedine today.** Meta says data created in Development mode, "such as test posts, can only be seen by role users" ([App Modes](https://developers.facebook.com/docs/development/build-and-test/app-modes)). Postiz's docs report the same on real Pages ([Postiz](https://docs.postiz.com/providers/facebook)). ADR 0040 and the comment in `meta.ts` record only that the app can post to Pages whose admins hold a role. They do not record that the public may not see those posts, so **a post that looks successful on the founder's demo Page may be invisible to customers.** Check it from a logged-out browser. An API call can succeed without the post reaching the public, and no source settles this for Instagram.

One untested variant remains: a Live-mode app holding only Standard Access, used by role users. The visibility rule is written only about Development mode, but no official text confirms this works, or that a Business-type app can go Live this way ([App Modes](https://developers.facebook.com/docs/development/build-and-test/app-modes)). Moving from Development to Live also requires a Data Use Checkup, Meta's yearly data-handling questionnaire ([Data Use Checkup](https://developers.facebook.com/docs/development/maintaining-data-access/data-use-checkup)). Even if it works, the 50-tester cap and the "on the developer's behalf" wording make it a small-pilot bridge at most.

## Instagram Login removes the Page link, not the verification

Instagram now offers two connection routes, and the difference matters for onboarding but not for approval.

| | Instagram Login | Facebook Login (what Xedine uses) |
|---|---|---|
| Facebook Page | Not required | Instagram must be connected to a Page |
| Permissions | `instagram_business_*` | `instagram_*` plus Page permissions |
| API address | `graph.instagram.com` | `graph.facebook.com` |
| Publishing, comments, insights | Yes | Yes |
| Hashtag search, product tags, partnership ads | No | Yes |
| Serving accounts you don't own | Advanced Access, so App Review and verification | Same |

The table comes from Meta's [overview](https://developers.facebook.com/docs/instagram-platform/overview), and the access rule is confirmed on the [Business Login page](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login.md). An account you don't own or manage needs Advanced Access on either route, and the notes found no source showing otherwise.

Instagram Login has one real benefit for Xedine. `listPages` in `meta.ts` finds Instagram only through the linked Page, and `connectPage` in `connect.ts` adds it only if that link exists, so a restaurant with an unlinked Instagram gets Facebook only. The costs are that owners would connect twice to cover both networks, and Instagram tokens expire after 60 days unless refreshed ([Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login.md)), which would need a new refresh job. Meta's own page gives both 100 and 50 posts per 24 hours as the daily limit ([Instagram publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)), but one post a day stays well under either.

## Four posting companies say their approved app does the work, from $50 a month

These companies run a Meta app and let your customers sign in through it, so you never file for review yourself. Upload-Post says there is "no app review on your side" ([Upload-Post](https://www.upload-post.com/platforms/facebook/)). Outstand says its subscription "includes Outstand's own Meta app" ([Outstand](https://www.outstand.so/docs/configurations/facebook)). Zernio, formerly Late, says users connect "through Zernio's approved platform apps" ([Zernio](https://zernio.com/use-cases/saas-platforms)). Ayrshare says you need no "App Review, Business Verification, or Page tokens" ([Ayrshare](https://www.ayrshare.com/facebook-api.md)). **These are the companies' own statements, and nobody has independently audited them.**

All four support Page photos, Facebook Reels, Instagram images and Instagram Reels, and an 8-second vertical Reel fits inside every published limit. Monthly costs below assume one Page and one Instagram per restaurant, about 30 posts a month to each, billed monthly. Ayrshare's totals are calculated from its rate card, not quoted by the company.

| Provider | 10 restaurants | 50 restaurants | 200 restaurants | Written permission for this use | Main catch |
|---|---|---|---|---|---|
| **Upload-Post** | $50 | $105 to $147 | $438 | Explicit ([terms §2.2](https://www.upload-post.com/terms)) | Customer connect link starts on the $50 plan ([white label](https://www.upload-post.com/whitelabel)); public only since May 2025 ([Product Hunt](https://www.producthunt.com/products/upload-post/launches)) |
| **Outstand** | $129 | $129 | $129 | Explicit on Business plan ([terms](https://www.outstand.so/terms)) | No hosted connect page confirmed, so you may have to build the Page picker |
| **Zernio** | $78 | $318 | $618 | Terms silent ([terms](https://zernio.com/tos)) | First 2 accounts free with no card ([pricing](https://zernio.com/pricing)); ask for written permission |
| **Ayrshare** | $299 | $778.80 | $1,577.30 | No explicit grant ([terms](https://www.ayrshare.com/terms/)) | Too expensive; Instagram must be linked to a Page ([docs](https://www.ayrshare.com/docs/apis/post/social-networks/instagram)) |

Prices come from each company's page: [Upload-Post](https://www.upload-post.com/pricing), [Outstand](https://www.outstand.so/), [Zernio](https://zernio.com/pricing) and [Ayrshare](https://www.ayrshare.com/pricing/). Upload-Post's free plan has only 2 profiles and 10 uploads a month and leaves out the customer connect feature, so it cannot test the real sign-up flow. Zernio's per-account pricing is actually cheaper for the first five restaurants ($48 for 10 accounts, by my arithmetic), and it is the only one with a confirmed `account.disconnected` alert ([Zernio](https://docs.zernio.com/platforms/facebook)). That is useful for pilots if Zernio confirms by email that a SaaS may use it this way.

Several options fail the test. Self-hosted Postiz and Mixpost, plus Nango and Unified.to, all require your own Meta app, so they bring the verification problem straight back ([Postiz](https://docs.postiz.com/providers/facebook); [Mixpost](https://docs.mixpost.app/services/social/facebook/); [Nango](https://nango.dev/docs/api-integrations/facebook/how-to-register-your-own-facebook-api-oauth-app); [Unified.to](https://docs.unified.to/guides/how_to_register_your_facebook_oauth2_application.md)). Postiz cloud forbids white-label resale without a written agreement ([Postiz terms](https://postiz.com/terms)). Blotato documents no way for customers to connect their accounts ([Blotato](https://help.blotato.com/api/start)). Postproxy ([pricing](https://postproxy.dev/pricing)) and PostPeer ([pricing](https://www.postpeer.dev/pricing)) look cheap but have thinner evidence, and nobody has established whose Meta app bundle.social uses.

Three trade-offs come with renting. Owners see the provider's name on Facebook's permission screen, which is stated for Upload-Post and likely for the others ([Upload-Post](https://www.upload-post.com/whitelabel)). Switching provider should force every restaurant to reconnect, because consent belongs to the app they approved. And **nobody has answered whether Meta permits this lending**: the notes did not check Meta's terms on this point, and I found no vendor page that addresses it. Independent reviews are also scarce, as the only Trustpilot records found were Zernio's 4.8 from 208 reviews ([Trustpilot](https://www.trustpilot.com/review/zernio.com)) and Ayrshare's 4.0 from 4 ([Trustpilot](https://www.trustpilot.com/review/ayrshare.com)).

Paying from Bangladesh is a separate unknown. A 2020 Bangladesh Bank circular capped a single card transaction at $300 ([The Business Standard](https://www.tbsnews.net/node/135475)), and I could not confirm that limit for 2026. If it still applies, Zernio's bills at 50 restaurants and above and Upload-Post's $438 plan would not go through. One user reports a dual-currency card with a $1,000 annual cap ([Shopify community](https://community.shopify.com/t/payment-issues-from-bangladesh/321503)), which $50 a month fits and $129 a month does not. PayPal does not accept Bangladesh addresses ([Elevate Pay](https://www.elevatepay.co/blog/is-paypal-available-in-bangladesh)). No vendor page documents support for Bangladeshi cards, so try a small charge first.

## Without a provider, tap-to-post is the only safe way onto Meta

The ban-risk ratings below are judgement calls, because no source gives a measured ban rate for any route.

| Option | Works? | Ban risk | Verdict |
|---|---|---|---|
| Browser bot or instagrapi with owner's login | Technically, but fragile | High and severe | **Reject** |
| Zapier or Make, per owner | Yes | Low | Poor fit: English setup for every owner |
| Zapier White Label | As Zapier describes it | Low | Worth one email; limited access and no public price |
| n8n self-hosted | Needs your own Meta app | n/a | Reject |
| IFTTT | Instagram has zero actions | n/a | Reject for Instagram |
| Business Suite by hand | Yes for scheduling; bulk limits unclear | None | Fallback for pilots |
| **Telegram plus tap-to-post page** | Yes on Android; one iPhone gap | None | **Best free fallback** |
| **YouTube Shorts** | Yes, public uploads now allowed | Low | **Add** |
| **Google Business Profile** | Photos, after approval | Low | **Add for posters** |
| TikTok | Private-only until audited | Low | Later |

Bot routes fail on Facebook's plain wording: "Not share your password, give access to your Facebook account to others", with accounts open to being permanently disabled ([Facebook Terms](https://www.facebook.com/legal/terms)). Meta's platform terms separately bar apps from collecting login credentials ([Platform Terms](https://developers.facebook.com/terms/)). A session cookie grants the same access, so it is no better. instagrapi's own README says it is "fragile in production" and best for testing and research ([instagrapi](https://github.com/subzeroid/instagrapi)). The real danger is the size of the failure, because a Page runs from a personal profile, and one database breach would expose every owner's Facebook account.

Zapier and Make appear to run on their own Meta apps, but they are built for one account connecting its own Pages. Zapier White Label is the exception, letting users connect "inside your product" ([Zapier](https://zapier.com/developer-platform/white-label)), though it is "currently in limited access" by email ([Zapier docs](https://docs.zapier.com/white-label/getting-started)). n8n says "you'll need a Meta for Developers account and a Meta app" ([n8n](https://docs.n8n.io/integrations/builtin/credentials/facebookgraph/)), and IFTTT has no Instagram actions ([IFTTT](https://ifttt.com/instagram)). Business Suite certainly schedules posts by hand, but sources conflict on batch size and I could not read Meta's help text ([Meta help](https://www.facebook.com/business/help/563248174101110)).

### How the tap-to-post hand-off would work

Xedine already makes the posters and Reels and keeps them downloadable on Growth when nothing is connected (ADR 0040), and the Telegram bot is already live. The new piece is a web page with one button that copies the caption and opens the phone's share sheet through the Web Share API, which needs HTTPS and a real tap ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)). The most direct evidence is one forum thread from about 2024: on Android, sharing to Instagram Feed and Reels worked, while on iPhone, Reels worked and Feed failed ([Meta forum](https://developers.secure.facebook.com/community/threads/1094504835445267/)). Pre-filled captions are not available ([Facebook Sharing](https://developers.facebook.com/docs/sharing/android/)), so the owner pastes the caption. Telegram's copy button holds only 256 characters ([Bot API mirror](https://jsr.io/@gramio/types/doc/objects/~/TelegramCopyTextButton)), which is too short for most Bangla captions with hashtags, so the copy must happen on the web page.

The 7 to 10 taps is a desk estimate per post, not measured on a phone, and posting to two networks doubles it unless cross-posting works. Third-party guides describe a setting that shares Instagram posts to Facebook automatically, but no official page confirmed it, and one says Reels can arrive looking like a photo ([TimeToPost](https://timetopost.co/blog/instagram-facebook-crossposting-guide/)). **The largest unknown is whether Facebook's share target posts to the owner's Page or to their personal profile.** Whether the Business Suite app appears as a share target is also unknown, and it could be the best single target. No data shows how long owners keep tapping. Telegram suits this better than WhatsApp on file size, with 50 MB against 16 MB for video ([Telegram](https://core.telegram.org/bots/faq); [WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media/)).

### Other platforms give free, automatic reach today

**YouTube ended private-only uploads for unverified projects on 2 November 2026** ([YouTube revision history](https://developers.google.com/youtube/v3/revision_history)). Uploads are limited to 100 calls a day ([videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)), which fits about 100 restaurants posting one Reel daily if the limit is per project. Apps using sensitive permissions without Google's own check are limited to 100 new users ([Google Cloud](https://support.google.com/cloud/answer/7454865)), and YouTube's upload permission is probably one of those, though this was not confirmed. The rule is days old, so test one public upload first.

Google Business Profile takes photo posts with `ORDER` buttons ([Google posts](https://developers.google.com/my-business/content/posts-data)) and needs a business website, with access reviewed within 14 days ([Google FAQ](https://developers.google.com/my-business/content/faq)). Those posts may appear when customers search nearby, though its reach in Bangladesh was not researched. TikTok keeps unaudited apps private-only ([TikTok](https://developers.tiktok.com/doc/content-sharing-guidelines)). None of these replaces Facebook, but they give the autopilot somewhere real to publish while Meta is unresolved.

## Whether Bangladesh can pass verification is still unanswered

**This section is thin on purpose. The dedicated Bangladesh research track was stopped before it finished, so I cannot tell you whether a Bangladeshi individual or sole proprietor can complete Meta Business Verification, or which documents Meta accepts.** Meta's Help Center article on eligibility and documents returned only its title, so the official rules were not read.

What the notes do contain is limited. One vendor says a sole proprietor can pass "if the business is registered", that no private limited company is needed, and that accepted papers include registration or licence documents, tax documents and business bank statements. That page sells a verification service with an approval guarantee, says Meta publishes no country list for India, and makes no claim about Bangladesh ([Amandeep Singh](https://singhamandeep.com/?p=3738)). Another vendor says document names must match the details in Business Manager ([bundle.social](https://bundle.social/blog/meta-app-review-20-days)). Meta mentions "Individual Verification" only in passing and does not explain it or say it satisfies Advanced Access ([Business Verification](https://developers.facebook.com/docs/development/release/business-verification)).

Nothing in the notes covers a Bangladeshi trade licence, TIN or DBID. ADR 0040 records that the founder has no trade licence and suggests DBID, but that is an earlier suggestion, and this research neither supports nor rejects it. **Don't obtain any document on the strength of this report.** The direct check is to read the live Help Center article in a normal browser and open the verification flow in a Meta business account to see what it offers for Bangladesh. Lawyers or registration offices can come after that.

## Launch on Upload-Post now, and treat verification as independence rather than savings

Xedine should keep autopilot as the product, publish through a rented app, use tap-to-post when a connection fails, and add YouTube. The tests come first because almost every claim about these companies is self-reported.

| When | Step | Cost |
|---|---|---|
| **This week** | Open a demo Page post from a logged-out browser, to settle what the Development-mode app really reaches | Free |
| | Connect the demo Page and Instagram on Zernio's free tier; publish a poster and a Reel; check both logged out | Free |
| | Test sharing on a mid-range Android and an iPhone: Feed, Reels, Facebook identity, Business Suite, clipboard | Free |
| | Read the live verification article and open the flow; email Zernio about SaaS use and whitelabel@zapier.com about access | Free |
| | Try a small international charge on the card you would use, and ask the bank about limits | Small |
| **Before the first customer** | Put publishing behind one internal gateway; store `provider`, `profile_id` and `account_id` per restaurant | Founder time |
| | Add a Telegram alert and a reconnect prompt, which ADR 0040 lists as not built, and send the tap-to-post link when publishing fails | Founder time |
| | Add Bangla text before the permission screen explaining why it shows another company's name | Founder time |
| | Amend ADR 0040 §6, §7 and "Meta access", and write a new ADR | Founder time |
| **First paying restaurants** | Upload-Post Professional, billed monthly ($50, up to 25 restaurants); use the first month to repeat the test with a real owner's connect link | $50/month |
| **Soon after** | YouTube Shorts, then Google Business Profile posters | Free |
| **Past 50 restaurants** | Move to Outstand Business if it passes the test, since Upload-Post then costs $147 | $129/month |
| **When documents are ready** | Apply for verification and App Review on Xedine's own app | Document costs not researched |

In the code, the switch point is the publish step in `src/modules/social/jobs/autopilot.ts`, which calls the `meta.ts` functions directly. Keep `meta.ts` for later and add the provider beside it. ADR 0040 §6 stops double posting by saving `fb_id` and `ig_id` as each network succeeds, so check that the chosen provider reports each network's result separately. Also ask each provider what happens if the same request is sent twice.

The "offline for a month" promise needs softening even with a provider. Zernio warns that "Facebook tokens expire frequently" ([Zernio](https://docs.zernio.com/platforms/facebook)), and Meta says Page tokens can be invalidated "under certain conditions" it does not list in what was read ([tokens guide](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived)). Owners will sometimes need to reconnect.

Verification should wait until the documents are clear, then be prepared properly. Meta wants a 1080p screen recording per permission and real API calls within 30 days of submitting. It also needs a privacy policy URL, a 1024x1024 icon and a way for reviewers to test the app ([App Review guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide)). The `pages_manage_posts` recording must show creating, editing and deleting a post ([Permissions reference](https://developers.facebook.com/docs/permissions)), and `meta.ts` has no edit or delete call yet. Check the scope list too: `META_SCOPES` includes `business_management`, which is not among the publishing dependencies the notes list, and omits `pages_read_user_content`, which `instagram_basic` is listed as depending on. Meta promises a decision within a week, while vendors who sell an alternative report about 20 days ([WoopSocial](https://woopsocial.com/blog/meta-app-review-rejected-2026-fix-guide)). I could not verify the data deletion URL requirement.

### What each route risks

| Route | Terms position | What could go wrong | Size |
|---|---|---|---|
| Stored passwords or cookies | Clear breach ([Facebook Terms](https://www.facebook.com/legal/terms)) | Owner loses profile and Page; a breach exposes all owners | **Severe; don't do it** |
| Customers as testers | Conflicts with "on the developer's behalf"; no stated penalty found | Removal cuts off posting; 50-tester ceiling; posts may not reach the public | Unknown |
| Rented provider app | Not checked against Meta's terms | A Meta action against that app stops every restaurant at once; I found no such incident, but evidence is thin | **Chance unknown, impact high** |
| Provider's own terms | They can suspend "without prior notice" | Upload-Post caps liability at 12 months' fees or €100, and excludes posts sent to the wrong accounts ([terms](https://www.upload-post.com/terms)); Outstand caps at 12 months' fees or $100 ([terms](https://www.outstand.so/terms)) | Xedine carries the loss |
| Meta changing its API | Outside anyone's control | Meta cut third-party Groups access in 2024 ([TechCrunch](https://techcrunch.com/2024/02/05/meta-cuts-off-third-party-access-to-facebook-groups-leaving-developers-and-customers-in-disarray/amp)) | Hits all routes |
| Tap-to-post | Owner posts normally through Meta's own apps | Owners stop tapping; no data on how soon | Commercial, not account risk |

Monthly billing limits the provider risk, and a working hand-off means a provider outage costs owners taps rather than lost posts. Legal exposure under Bangladeshi law was not researched.

## Conclusion

The question looks like a compliance problem, but it is mostly a dependency decision. A flat $129 at 200 restaurants works out to about ৳80 each at ADR 0008's rate, so saving money is a weak reason to verify. The stronger reasons are Xedine's name on the permission screen and no longer having every restaurant depend on one small company's standing with Meta. Each provider move also makes owners reconnect, so choose carefully and move rarely.

The most urgent finding costs nothing to check: the current demo posts may never have reached the public. ADR 0040's promise now rests on a choice the founder has not yet made, which is whether "budget zero" still holds. If it must stay strictly zero, Xedine becomes a tap-to-post product on Facebook and Instagram and automatic only on YouTube and Google. If one small monthly bill is acceptable, the promise survives, with the softer wording that owners sometimes need to reconnect.
