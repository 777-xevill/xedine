# Meta access rules for publishing to customers' Facebook Pages and Instagram accounts, and what works without Business Verification

Research date: 2026-11-04. Labels used below:
- **[OFFICIAL]**: Meta developer documentation. Almost all these pages show no last-updated date, so they are dated "retrieved 2026-11-04". The rule text can be older than that.
- **[VENDOR]**: a company blog or docs page. Many of them sell an alternative to App Review, so they have a commercial interest.
- **[ANECDOTAL]**: a developer report.
- **[OLD]**: the source is more than 12 months old.

Meta pages were read through a page-summarising fetch tool. Quotes are as returned by that tool, so check them against the live page before quoting them publicly.

Graph API version context: v26.0 is the latest, introduced 2026-07-29. v25.0 was introduced 2026-02-18 and is available until 2028-07-29, so Xedine's v25.0 is still supported. The changelog index shows no v25/v26 access-rule changes, but the per-version changelog pages were not read — [OFFICIAL Graph API changelog, retrieved 2026-11-04](https://developers.facebook.com/docs/graph-api/changelog).

## What do the Pages and Instagram publishing permissions require in 2026 (access level, App Review, Business Verification, Access Verification, tech provider), and which are mandatory for serving other people's Pages?

### Takeaway
To serve Pages or Instagram accounts of people with no role on the app, each permission needs Advanced Access, which means App Review plus Business Verification. Meta's docs disagree on whether Tech Provider or Access Verification still applies: one page says it is no longer required, and another still describes it as a restriction.

### Cited Findings
**Permission dependencies (official):**
- `pages_manage_posts` depends on `pages_read_engagement` and `pages_show_list`. `pages_read_engagement` depends on `pages_show_list`. `pages_show_list` has no dependencies — [OFFICIAL Permissions reference, retrieved 2026-11-04](https://developers.facebook.com/docs/permissions).
- `instagram_content_publish` depends on `instagram_basic`, `pages_read_engagement` and `pages_show_list`. `instagram_basic` is listed as depending on `pages_read_user_content` and `pages_show_list` — [OFFICIAL Permissions reference](https://developers.facebook.com/docs/permissions).
- `instagram_business_content_publish` depends on `instagram_business_basic`, which has no dependencies — [OFFICIAL Permissions reference](https://developers.facebook.com/docs/permissions).
- Facebook Page Reels need the same three Page permissions, plus a Page token from a user who can perform `CREATE_CONTENT` on the Page — [OFFICIAL Reels publishing guide, retrieved 2026-11-04](https://developers.facebook.com/docs/video-api/guides/reels-publishing).
- Instagram with Facebook Login needs `instagram_basic`, `instagram_content_publish` and `pages_read_engagement`. If the user's Page role was granted through Business Manager, it also needs `ads_management` and `ads_read` — [OFFICIAL Instagram content publishing, retrieved 2026-11-04](https://developers.facebook.com/docs/instagram-platform/content-publishing).

**Access levels (official):**
- "Permissions with Standard Access can only be requested from app users who have a role on the requesting app." Business, Consumer and Gaming apps get Standard Access automatically — [OFFICIAL Access Levels, retrieved 2026-11-04](https://developers.facebook.com/docs/graph-api/overview/access-levels).
- "Permissions with Advanced Access can be requested from any app user", but Advanced Access "must be approved on an individual permission and feature basis" — [OFFICIAL Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels).
- "Advanced Access if your app serves Instagram professional accounts you don't own or manage"; Standard Access covers accounts "you own or manage" — [OFFICIAL Business Login for Instagram, retrieved 2026-11-04](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login.md).
- Advanced Access "requires App Review and Business Verification" — [OFFICIAL Instagram Platform overview, retrieved 2026-11-04](https://developers.facebook.com/docs/instagram-platform/overview).

**Tech Provider and Access Verification (official pages conflict):**
- "Access Verification is no longer required"; the page is kept as a legacy reference — [OFFICIAL Access Verification, retrieved 2026-11-04](https://developers.facebook.com/docs/development/release/access-verification).
- Contradicted by: "any apps claimed by a business cannot be used by other businesses until the business has been verified as a Tech Provider". This page lists `pages_manage_posts` and `pages_show_list` among the restricted permissions, with an exception for users who have a role on the app — [OFFICIAL Tech Providers, retrieved 2026-11-04](https://developers.facebook.com/docs/development/release/tech-providers).
- The Access Verification page also says Business Verification is a prerequisite for it, and that unverified businesses had their calls rejected — [OFFICIAL Access Verification](https://developers.facebook.com/docs/development/release/access-verification).

### Inferences
- For Xedine's model (many unrelated owners, no role on the app), Advanced Access on `pages_manage_posts`, `pages_read_engagement` and `pages_show_list` is mandatory for Facebook. On the Facebook Login route, Instagram adds `instagram_content_publish` and `instagram_basic`. On the Instagram Login route, it adds `instagram_business_content_publish` and `instagram_business_basic`.
- The Tech Providers page is probably stale, given the explicit "no longer required" on the Access Verification page. This is my reading, not something Meta confirms.

### Gaps
- Meta's permission reference does not state an access level per permission. It describes review requirements, and the Advanced Access rule is general.
- I could not determine when Access Verification was retired.

## What works with no verification: Development vs Live mode, Standard Access limits, app roles and tester limits, and can a restaurant owner be a tester?

### Takeaway
With no verification, an app can serve only people who hold a role on it. A restaurant owner can technically be added as a Tester with no developer account, but the cap is about 50 testers, and the role is defined as someone testing on the developer's behalf.

### Cited Findings
- "Apps in Development mode can only request permissions from role users." "Apps in Live mode can request permissions from anyone, but only permissions approved through App Review." — [OFFICIAL App Modes, retrieved 2026-11-04](https://developers.facebook.com/docs/development/build-and-test/app-modes).
- Apps used only by people with a role "do not need to complete verification" — [OFFICIAL Business Verification, retrieved 2026-11-04](https://developers.facebook.com/docs/development/release/business-verification).
- "If your app will only be used by app users who have a role on the app itself, App Review is not required." — [OFFICIAL App Review, retrieved 2026-11-04](https://developers.facebook.com/docs/app-review).
- Business Verification is also not triggered for people who have a role "in a Business that has claimed the app" — [OFFICIAL Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview).
- Role limits: up to 500 administrators. Up to a combined 500 analytics users and testers for apps linked to a Business Manager with Business Verification. "Most apps, not linked, can have up to 50 testers." — [OFFICIAL App Roles, retrieved 2026-11-04](https://developers.facebook.com/docs/development/build-and-test/app-roles).
- Developer account: "In order to have an Administrator, Developer, or Analytics role on an app, a person must have a Meta Developer Account." Tester invitations can go to regular Facebook users — [OFFICIAL App Roles](https://developers.facebook.com/docs/development/build-and-test/app-roles).
- Accepting as a tester: the invitee goes to Facebook Settings, Apps and Websites, then the "Requests" section. They must agree to the Meta Platform Terms and confirm they are working on the developer's behalf — [OFFICIAL App Roles](https://developers.facebook.com/docs/development/build-and-test/app-roles).
- Testers "cannot edit any app settings, give other people access to the app or access insights" — [OFFICIAL App Roles](https://developers.facebook.com/docs/development/build-and-test/app-roles).
- Standard Access "is intended for apps that will only be used by people who have roles on them" — [OFFICIAL Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels).
- "Everyone with an app role (admin, developer, tester) can log in and publish to Pages they manage" in development mode; users without a role are not granted Pages permissions — [VENDOR PostZen, 2026-09-11](https://www.postzen.dev/blog/facebook-graph-api-post-to-page). Agrees in part: [VENDOR Creator OS, 2026-10-06, updated 2026-10-21](https://www.creatoros.ca/blog/facebook-graph-api-page-posting-without-app-review/).
- [OLD, 2019] Since 2019-10-23, apps must be in Live Mode for production use. Dev Mode apps "can only access data for the following roles" and cannot manage assets the app's business does not own, such as Pages — [OFFICIAL Meta developer blog, 2019-09-23](https://developers.facebook.com/blog/post/2019/09/23/live-mode-for-production-use/).

### Inferences
- A restaurant-owner onboarding flow would be: the owner has Facebook, the founder invites them as Tester, and the owner accepts in Facebook Settings and agrees to the terms. Then the owner runs Xedine's OAuth. This works for a small pilot, capped at about 50 testers because the app is unverified and unlinked.
- Owners would have to confirm they are working on the developer's behalf, which does not describe a paying customer. Using the tester role for production customers appears to conflict with the stated purpose of Standard Access and with the 2019 production-use rule. I found no text that explicitly bans it or states an enforcement consequence, so the risk level is unknown.

### Gaps
- The developer-role cap was not visible in what I retrieved.
- Whether "a role in a Business that has claimed the app" can be used for customers without a verified business was not tested. The Tech Providers text suggests it would not help for other businesses' Pages.

## Do posts made in Development mode or via Standard Access appear publicly, or only to app-role users?

### Takeaway
For Development mode, Meta's wording is explicit: test posts "can only be seen by role users". Developer reports for Facebook match this. I found no official or reliable statement for Live mode with Standard Access, and no direct evidence either way for Instagram.

### Cited Findings
- "Any data generated while an app is in Development mode, such as test posts, can only be seen by role users." — [OFFICIAL App Modes](https://developers.facebook.com/docs/development/build-and-test/app-modes).
- "Data generated while in Development mode such as test posts will become visible to all app users once you switch." — [OFFICIAL App Modes](https://developers.facebook.com/docs/development/build-and-test/app-modes).
- "Posts made via the API will display for yourself but will not be visible for other users." and "In Development mode, posts with media are only visible to app developers/testers". The stated fix is changing the App Mode to Live — [VENDOR Postiz docs, undated](https://docs.postiz.com/providers/facebook).
- The same Postiz page says that "if your Postiz install is for personal use only these advanced permissions are not required", while its setup still switches the app to Live — [VENDOR Postiz docs, undated](https://docs.postiz.com/providers/facebook).
- [OLD, 2020] A developer reported that in development mode "your posts aren't visible for other users, only for yourself", later describing them as shown only to the Page admin. That fix used the older `manage_pages` and `publish_pages` permissions with App Review — [ANECDOTAL GitHub issue, 2020-03-06 to 2020-04-13](https://github.com/verbb/social-poster/issues/32).
- In Live mode, the App Modes page's statement that Standard Access can only be requested from role users is scoped to Consumer apps — [OFFICIAL App Modes](https://developers.facebook.com/docs/development/build-and-test/app-modes).
- A search of 2026 Instagram guides found no source saying whether Development-mode Instagram posts are publicly visible. Neither [VENDOR PostZen](https://www.postzen.dev/blog/facebook-graph-api-post-to-page) nor [VENDOR Creator OS](https://www.creatoros.ca/blog/facebook-graph-api-page-posting-without-app-review/) addresses post visibility.

### Inferences
- Publishing from a Development-mode app to a restaurant's real Facebook Page should be treated as not reaching customers. That would defeat the product's purpose.
- Possible route, unconfirmed: **Live mode + Standard Access + role users**. Role users could grant permissions, and the role-only visibility rule is written only about Development mode. The Postiz personal-use note points the same way. No official text confirms this, so it needs a direct test, viewing the post from a logged-out browser or a non-role account.
- Note the phrase "visible to all app users", which is not the same wording as "everyone". The exact audience after switching is not spelled out.

### Gaps
- I found no official changelog entry recording a change to the visibility rule, and could not establish when the current wording began. The 2020 report and the undated current page describe the same behaviour.
- Whether an app can go Live holding only Standard Access is not stated for Business-type apps in what I read.
- Public visibility of Instagram posts and Facebook Reels from Development-mode apps could not be verified.

## Can an app in Development mode with role users publish Reels and to Instagram?

### Takeaway
Meta's docs don't exclude either, and a 2026 vendor guide says Instagram publishing from development mode works for an account added as an Instagram Tester. What the public sees is unverified, so a live test is the only way to settle it.

### Cited Findings
- The Instagram content publishing guide lists Standard Access alongside Advanced Access on all three integration paths — [OFFICIAL Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing).
- Reels on Instagram use a container with `media_type=REELS` and a `video_url`. The media must be on a public server when the publish attempt runs — [OFFICIAL Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing).
- The Facebook Reels guide does not mention Development mode, App Review or Business Verification. It sets these limits: 3 to 90 seconds; recommended 1080x1920; minimum 540x960; 30 API-published posts per rolling 24 hours — [OFFICIAL Reels publishing guide](https://developers.facebook.com/docs/video-api/guides/reels-publishing).
- `file_url` limits on Facebook Reels: files hosted on sites restricting access through robots.txt are rejected, Meta CDN (fbcdn) URLs are rejected, and URLs requiring authentication are unsupported — [OFFICIAL Reels publishing guide](https://developers.facebook.com/docs/video-api/guides/reels-publishing).
- You can "publish from a Meta app in development mode" by adding your account as an Instagram Tester in the app dashboard and accepting the invite in Instagram settings — [VENDOR Blotato, 2026-08-06, updated 2026-10-30](https://www.blotato.com/blog/instagram-posting-api).
- "Some functionality, such as webhooks, require your app to be published." — [OFFICIAL Instagram use case](https://developers.facebook.com/documentation/development/create-an-app/instagram-use-case.md).

### Inferences
- Calling the API from a role user's account is likely to succeed in Development mode for both Reels and Instagram. A successful API response does not prove public reach (see the previous question).
- Xedine's render storage must allow Meta to fetch files: public, no auth, and not blocked by robots.txt.

### Gaps
- I found no official statement that specifically confirms Reels or Instagram publishing in Development mode. I also found no first-hand developer report covering Reels.
- I could not read Meta's official Instagram Tester instructions. The accept flow above is from a vendor.

## Is Business Verification strictly required for App Review/Advanced Access on these permissions? Has individual verification changed this?

### Takeaway
In current docs the general answer is yes, though some pages use softer wording ("may"). I found no evidence that individual verification replaces it. Vendors report that a registered sole proprietor can pass, and nothing specific to Bangladesh was found.

### Cited Findings
- Business Verification "is required for all apps making requests for Advanced Access" — [OFFICIAL Permissions reference](https://developers.facebook.com/docs/permissions).
- "Business Verification is required to get Advanced Access." — [OFFICIAL Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels).
- Softer wording: "as of February 1, 2023" you "might need to complete Business Verification" — [OFFICIAL Business Verification](https://developers.facebook.com/docs/development/release/business-verification). In the review flow, "you may be prompted to complete business verification" after selecting permissions — [OFFICIAL App Review submission guide, retrieved 2026-11-04](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide). It may be needed "depending on the nature of your app" — [OFFICIAL App Review](https://developers.facebook.com/docs/app-review).
- Individual Verification appears on Meta's page only in passing: click "+ Business Verification" "if you have previously completed Individual Verification". The page does not explain it, or say it satisfies Advanced Access — [OFFICIAL Business Verification](https://developers.facebook.com/docs/development/release/business-verification).
- "For some permission sets, you need to complete Business Verification first", and premature submissions are auto-rejected — [VENDOR WoopSocial, 2026-09-01](https://woopsocial.com/blog/meta-app-review-rejected-2026-fix-guide).
- A sole proprietor can pass "if the business is registered"; "Nothing in Meta's rules requires a private limited company". Accepted documents include incorporation certificates, business registration or licence documents, government tax documents and business bank statements. A utility bill alone cannot prove the legal name. The page says Meta publishes no country-specific list for India, and it makes no claim about Bangladesh. It sells a verification service with a "100% Approval or Refund" offer, so treat it with caution — [VENDOR Amandeep Singh, undated, © 2026](https://singhamandeep.com/?p=3738).
- Document names must match the business details: Meta "requires most advanced permissions to be tied to a verified business entity", using registration documents, utility bills or tax certificates that match Business Manager — [VENDOR bundle.social, 2026-08-04](https://bundle.social/blog/meta-app-review-20-days).

### Inferences
- For `pages_manage_posts` and the Instagram publishing permissions serving other people's accounts, plan on Business Verification being mandatory. The softer "may" wording seems to cover whether an app needs Advanced Access at all, not a way around it for those that do.

### Gaps
- Meta's Business Help Center verification article returned only its title, so **official eligibility rules and document lists were not verified**.
- I found no official statement on individuals or unregistered sole proprietors, and nothing on Bangladesh-specific documents such as a trade licence or TIN.
- I found no Meta documentation explaining what Individual Verification is today, or showing that it changed this requirement.

## Instagram API with Instagram Login vs with Facebook Login: differences, Page link, permissions, verification, rate limits and fit

### Takeaway
Instagram Login needs no Facebook Page and has no Page permissions, which is simpler for restaurants without a linked Page. The same access rule applies to both: accounts you don't own or manage need Advanced Access, meaning App Review and Business Verification. It removes the Page link, not the verification.

### Cited Findings
| Item | Instagram Login | Facebook Login | Source |
|---|---|---|---|
| Facebook Page | "Not required" | Account "must be connected to a Facebook Page"; user needs admin-equivalent tasks on it | [OFFICIAL overview](https://developers.facebook.com/docs/instagram-platform/overview) |
| Permissions | `instagram_business_*` family | `instagram_*` family plus Page permissions | [OFFICIAL overview](https://developers.facebook.com/docs/instagram-platform/overview) |
| Base URL | `graph.instagram.com` | `graph.facebook.com` | [OFFICIAL overview](https://developers.facebook.com/docs/instagram-platform/overview) |
| Business portfolio | Not required by the flow | Depends on the Facebook Login for Business configuration | [OFFICIAL overview](https://developers.facebook.com/docs/instagram-platform/overview) |
| Hashtag search, product tagging, partnership ads | Not supported | Supported | [OFFICIAL overview](https://developers.facebook.com/docs/instagram-platform/overview) |
| Publishing, comments, insights, mentions | Supported | Supported | [OFFICIAL overview](https://developers.facebook.com/docs/instagram-platform/overview) |

- Business Verification is required if the app "requires Advanced Access", or is used by people with no role on the app or a claiming Business. The overview gives no login-specific exception — [OFFICIAL overview](https://developers.facebook.com/docs/instagram-platform/overview).
- Instagram Login requires App Review when the app accesses data you don't own or manage — [OFFICIAL Instagram use case](https://developers.facebook.com/documentation/development/create-an-app/instagram-use-case.md).
- **Publishing limit conflict on the same page:** "limited to 100 API-published posts within a 24-hour moving period", while the carousel section says "limited to 50 published posts within a 24-hour period". Carousels count as one post — [OFFICIAL Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing). The live number can be read from `/{ig-user-id}/content_publishing_limit` — [VENDOR Blotato](https://www.blotato.com/blog/instagram-posting-api).
- Both logins use Instagram Business Use Case rate limiting, except Business Discovery and Hashtag Search, with the formula "Calls within 24 hours = 4800 * Number of Impressions" — [OFFICIAL overview](https://developers.facebook.com/docs/instagram-platform/overview).
- Accounts connected to a Page requiring Page Publishing Authorization cannot publish until it is complete. Meta recommends advising users to complete it in advance — [OFFICIAL Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing).
- Both flows: authorization codes and short-lived tokens valid for 1 hour, long-lived tokens for 60 days — [OFFICIAL overview](https://developers.facebook.com/docs/instagram-platform/overview). The Instagram long-lived token can be refreshed once at least 24 hours old and unexpired, and expires if not refreshed within 60 days — [OFFICIAL Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login.md).

### Inferences
- Fit for Xedine: Instagram Login suits owners who have an Instagram professional account but no linked Page. It also needs fewer permissions, which should make review narrower. Facebook posting would still need its own Facebook Login flow, so owners would connect twice on a two-network setup.
- Xedine's current design (Page token plus Instagram containers) is the Facebook Login route. Restaurants whose Instagram is not linked to their Page cannot publish on it.
- Treat the daily limit as 50 until the live endpoint is checked. Xedine's posting volume should be far below either figure.

### Gaps
- The claim that Instagram Login avoids App Review for other people's accounts was not supported: the Blotato page, on direct reading, does not say this.
- I found no first-hand report on running Instagram Login with non-owned accounts using only Standard Access. Meta's wording says it is not allowed.

## Facebook Login for Business vs classic Facebook Login, configurations (config_id), and business-type app requirements

### Takeaway
Facebook Login for Business needs a business-type app (or a supported use case) and uses `config_id` in place of `scope`. It still needs Advanced Access to serve businesses you don't own. Non-expiring system-user tokens are available to tech providers only.

### Cited Findings
- "Facebook Login for Business is the preferred authentication and authorization solution" for tech providers building business tools integrations — [OFFICIAL Facebook Login for Business, retrieved 2026-11-04](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business).
- "Your Meta app must be a business type app", or use a supported use case — [OFFICIAL Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business).
- Configuration: you build one in the App Dashboard and get a "Configuration ID". `config_id` replaces `scope`, and classic Facebook Login does not accept `config_id` — [OFFICIAL Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business).
- "Your app must be approved for Advanced Access" to serve businesses you don't own or manage. This page does not mention Business Verification — [OFFICIAL Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business).
- User access tokens: tied to the person's account and inherit their asset access; short-lived; suited to real-time actions — [OFFICIAL Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business).
- Business Integration System User tokens: tied to the client's business portfolio with explicitly granted access; default to "never expire"; available to tech providers only; use the authorization code grant only — [OFFICIAL Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business).
- Users must grant every requested permission or the app gets none. On switching, unsupported permissions and features are revoked. Rollback to classic is allowed "within 30 days after the switch" — [OFFICIAL Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business).

### Inferences
- Moving to Facebook Login for Business does not remove the verification hurdle, and its most useful token type is tied to Tech Provider status. It would not help an unverified founder now.

### Gaps
- I did not confirm whether classic Facebook Login remains available for new business-type apps in 2026, or which app type Xedine's app is.
- The "supported use case" list was not retrieved.

## App Review needing a screencast, privacy policy, data deletion URL, annual Data Use Checkup: what else is required?

### Takeaway
A review submission needs per-permission screencasts and real API calls, a privacy policy URL, a compliant app icon, a category and a way for reviewers to test the app. The Data Use Checkup is annual for Live or Advanced Access apps. Official time expectation is about a week, while vendors report much longer.

### Cited Findings
- Screencast: 1080 resolution or better, showing a user granting each permission and how the app uses it. A permission with no recording will not be approved — [OFFICIAL submission guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide).
- Per-permission content: `pages_manage_posts` must show the full login flow, then creating, editing and deleting a post, and the updated post on the Page. `instagram_content_publish` must show login, creating a photo post and publishing it — [OFFICIAL Permissions reference](https://developers.facebook.com/docs/permissions).
- API calls: "Calls must be made within 30 days of submitting for App Review" for each permission requesting Advanced Access; call data is logged "within 2 days" — [OFFICIAL submission guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide).
- Privacy policy URL, shown to users in Meta's authentication interfaces; 1024x1024 app icon with no Meta trademarks; accurate category — [OFFICIAL submission guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide).
- Testing: Meta tests with its own accounts. Describe how reviewers get access, but do not include your personal account credentials — [OFFICIAL submission guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide). "If we are unable to access your app to test it, your entire submission will be rejected." — [OFFICIAL App Review](https://developers.facebook.com/docs/app-review).
- Private apps that reviewers cannot test may request approval only for `instagram_basic` and `instagram_manage_comments` — [OFFICIAL Instagram overview](https://developers.facebook.com/docs/instagram-platform/overview).
- Data Use Checkup: "an annual assessment" for apps published live with a use case or holding Advanced Access; an app admin completes it. Not required for Standard Access. Development-mode apps must complete it before switching to Live. Data handling questions were added from January 2024. The page says you complete it to "maintain API access", without listing explicit penalties — [OFFICIAL Data Use Checkup, retrieved 2026-11-04](https://developers.facebook.com/docs/development/maintaining-data-access/data-use-checkup).
- Timing: "you should receive a decision within a week" — [OFFICIAL submission guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide). Contradicted by vendor reports of about 20 days — [VENDOR WoopSocial, 2026-09-01](https://woopsocial.com/blog/meta-app-review-rejected-2026-fix-guide); [VENDOR bundle.social, 2026-08-04](https://bundle.social/blog/meta-app-review-20-days). bundle.social calls its own timeline figures anecdotal and describes a Meta dashboard notice without reproducing it, so the 20-day figure is secondhand. Both vendors sell a way to avoid review.
- WoopSocial claims "You need one video for each permission" and that most apps get rejected at least once. No data given — [VENDOR WoopSocial](https://woopsocial.com/blog/meta-app-review-rejected-2026-fix-guide).

### Inferences
- Xedine's review demo needs a working Facebook posting flow, including editing and deleting a post, on top of what the autopilot does. The permission text asks to see those actions, and the review needs reviewer access to a test restaurant account.

### Gaps
- **Data deletion URL:** none of the official pages I read state this requirement. It may still be required in App Settings, but I could not verify that here.
- The consequences of missing a Data Use Checkup are not spelled out on the page.

## Consequences for an unverified app: limits, restriction, token expiry for tester users

### Takeaway
An unverified app cannot get Advanced Access, so it stays limited to role users with a roughly 50-tester ceiling. I found no tester-specific token rule. Standard token lifetimes appear to apply, and Meta's long-lived Page tokens have no fixed expiry.

### Cited Findings
- Standard Access features "are only active for app users who have a role on the app" — [OFFICIAL Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels).
- "Changing from Advanced to Standard will invalidate/deactivate any permission/feature" for users without a role — [OFFICIAL Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels).
- A Tech Provider's status can lapse if the business's verification changes to unverified — [OFFICIAL Tech Providers](https://developers.facebook.com/docs/development/release/tech-providers).
- Long-lived user token: "generally lasts about 60 days". SDK-based tokens are refreshed once per day when the person makes a request to Facebook; if none are made, the token expires after about 60 days — [OFFICIAL long-lived tokens guide, retrieved 2026-11-04](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived).
- "Long-lived Page access token do not have an expiration date and only expire or are invalidated under certain conditions." The requester must have a role on the Page — [OFFICIAL long-lived tokens guide](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived).
- Contradicted by: "Page tokens derived from a long-lived user token last about 50 to 60 days", and password changes or app revocation end tokens at once. No evidence is cited, and the vendor sells a hosted alternative — [VENDOR Creator OS](https://www.creatoros.ca/blog/facebook-graph-api-page-posting-without-app-review/).
- Instagram Login long-lived tokens last 60 days unless refreshed — [OFFICIAL Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login.md).
- Volume limits apply regardless of verification as far as the docs state: 30 Reels per Page per rolling 24 hours — [OFFICIAL Reels publishing guide](https://developers.facebook.com/docs/video-api/guides/reels-publishing); 100 or 50 Instagram posts — [OFFICIAL Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing).

### Inferences
- Under role-based access, removing a tester, or the owner withdrawing app access, should stop that owner's publishing. This follows from "only active for app users who have a role", but I found no direct confirmation that existing tokens fail right away.
- Xedine should keep handling token failure and re-consent regardless of the token's nominal lifetime, since "certain conditions" can invalidate it.

### Gaps
- I found no official statement of token behaviour specific to testers or to Development mode.
- The "certain conditions" that invalidate a Page token were not listed in what I retrieved.
- I found no official statement of any penalty for an unverified app that uses testers as real customers, and no first-hand report of restriction for doing so.
- Forum and Stack Overflow searches returned little recent first-hand material. Most 2026 commentary comes from vendors with a commercial interest, and the only direct developer report on post visibility is from 2020.
