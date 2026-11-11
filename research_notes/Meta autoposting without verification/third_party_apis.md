# Third-party social posting APIs: publishing to customers' Facebook Pages and Instagram without passing Meta review

Research date: 2026-11-04. Pages without a stated date were read live that day, so their date is "as read 2026-11-04". Older data is flagged where it appears. Pages were read through a page-extraction tool, so check any quote against the live page before relying on it in a contract or an ADR. Cost figures marked "my arithmetic" are calculated from the cited rate cards, and no vendor quoted them.

Scenario used for all costs: 1 restaurant = 1 Facebook Page + 1 Instagram = 2 connected accounts and 1 customer profile. Each restaurant publishes about 30 posts a month to both networks, which is 60 deliveries a month.

| Restaurants | Connected accounts | Posts created / month | Deliveries / month |
|---|---|---|---|
| 10 | 20 | 300 | 600 |
| 50 | 100 | 1,500 | 3,000 |
| 200 | 400 | 6,000 | 12,000 |

## Which providers truly fit, and what do they cost at 10, 50 and 200 restaurants?

### Takeaway
Four providers have primary-source evidence that customers connect through the provider's own Meta app with a per-customer connect flow: **Upload-Post, Outstand, Zernio (formerly Late) and Ayrshare**. For a near-zero budget, **Upload-Post** is the best start (explicit terms, free test tier, $50/mo for up to 25 restaurants). **Outstand Business** is the best at scale ($129/mo flat, explicit resale right, and a way to move to your own Meta app later). Zernio fits technically but its terms are silent on resale, and Ayrshare fits technically but starts at $299/mo. Self-hosted Postiz and Mixpost, Nango and Unified.to all need your own Meta app, so they defeat the goal.

### Cited Findings

**Fit table (prices in USD per month, billed monthly; yearly rate in brackets where published)**

| Provider | Uses provider's Meta app? | Customer connect flow | Resale in terms | 10 restaurants | 50 restaurants | 200 restaurants | Verdict |
|---|---|---|---|---|---|---|---|
| **Upload-Post** | Yes, stated | JWT link or own page, Professional plan and up | Explicitly allowed | $50 ($33) | $147 ($118), or $105 with a +25 add-on | $438 ($350) | **Fits, best start** |
| **Outstand** | Yes, stated ("Managed Keys") | OAuth authorize URL; hosted page not confirmed | Business plan only | $129 | $129 | $129 | **Fits, best at scale** |
| **Zernio / Late** | Yes, stated | Hosted, branded welcome screen, or headless | Terms silent | $78 | $318 | $618 | **Fits; get resale confirmed in writing** |
| **Ayrshare** | Yes, stated | Hosted JWT linking page | No explicit grant; product marketed for it | $299 | $778.80 ($658.80) | $1,577.30 ($1,357.30) | Fits technically; too expensive |
| Postproxy | Yes per vendor blog | URL on Postproxy's domain | Embedding yes, standalone resale no (secondary source) | $49 | about $109 | at most about $409 | Promising, unverified |
| PostPeer | Yes per vendor blog | Not documented as multi-tenant | Unknown | $33 | $43 | $120 | Unverified |
| bundle.social | Unknown | Teams per customer | Unknown | $100 ($90) | $100 ($90) | $100 ($90) if 6,000 posts counts as "created" posts | Key question unanswered |
| Postiz cloud | Yes, but only for Postiz users | None documented | Forbidden without written agreement | $49 | $99 | No listed plan | No |
| Postiz self-hosted | **No, own app** | Own install | Open source | Server cost | Server cost | Server cost | No (needs verification) |
| Mixpost | **No, own app** | Own install | Enterprise licence required for SaaS | $1,199 one-time plus server | same | same | No (needs own Meta app) |
| Blotato | Not relevant | Dashboard only, single operator | Not found | $29 | $499 | Unknown | No |
| Buffer | Not relevant | Third-party OAuth reported as not enabled | Terms reported to forbid similar services | Not priced | Not priced | Not priced | No |
| Publer | Not relevant | Reported as no API connect | Not verified | about $126 | about $630 | about $2,520 | No |
| Metricool | Not verified | Not verified | Not verified | $67 | $210 | Custom | Not shown to fit |
| SocialPilot, Hootsuite | Not relevant | Not found | Hootsuite terms reported to forbid replicating the product | Enterprise quote | Enterprise quote | Enterprise quote | No |
| Nango, Unified.to | **No, own app** | Their connect UI | Not relevant | Not priced | Not priced | Not priced | No |

**Rate cards behind the table**
- Upload-Post: Free $0 (2 profiles, 10 uploads/mo, full API); Basic $24 (5 profiles, no white label); Professional $50 or $33 yearly (25 profiles, white label); Advanced $147 or $118 yearly (75); Business $438 or $350 yearly (225, extra profiles $1 each). Professional add-on: +25 profiles for $55. Page says "Last updated: October 2026" — [Upload-Post pricing](https://www.upload-post.com/pricing)
- Outstand: "Pay as you go" $19/mo includes 3,000 posts, then $0.007 per post up to 10k, then $0.005; unlimited accounts. Business $129/mo includes 50,000 posts and starts with 1,000 account slots — [Outstand homepage](https://www.outstand.so/). Ayrshare's page says the $19 plan covers 300 posts and also says 3,000, so it contradicts itself — [Ayrshare vs Outstand, competitor, updated 2026-10-23](https://www.ayrshare.com/compare/outstand-api-alternative.md)
- Outstand meters each post delivered to each connected account (competitor source) — [Ayrshare vs Outstand](https://www.ayrshare.com/compare/outstand-api-alternative.md)
- Zernio: accounts 1-2 free with no card; 3-10 at $6; 11-100 at $3; 101+ at $1; unlimited posts; the vendor's own examples are 20 accounts = $78 and 100 accounts = $318 — [Zernio pricing](https://zernio.com/pricing)
- Ayrshare: Premium $149 (1 profile); Launch $299 (up to 10 profiles, 28-day free trial); Business $599 or $499 annual (30 profiles), then $8.99 or $7.99 each for profiles 31-100, and $3.49 or $2.99 for 101-500. No free plan — [Ayrshare pricing](https://www.ayrshare.com/pricing/)
- Ayrshare's Max Pack add-on is $300/mo, and it is not needed for the hosted linking page: "Nothing to build, no Max Pack" — [Ayrshare pricing, via search excerpt](https://www.ayrshare.com/pricing/); [Ayrshare JWT overview](https://www.ayrshare.com/docs/apis/profiles/generate-jwt-overview)
- Postproxy: Free 10 posts/mo; Business $49/mo includes 20 profile groups (each holds up to 12 platforms), extra groups from $2, falling to $1.25 at 251+ — [Postproxy pricing](https://postproxy.dev/pricing)
- PostPeer: Free 20 credits; Starter $33 (2,000 credits), Standard $43 (6,000), Pro $120 (20,000); 1 credit per post on most platforms; unlimited connected accounts. The table's annual totals ($396 = 12 × $33) suggest these are yearly-billed rates, so month-to-month may cost more — [PostPeer pricing](https://www.postpeer.dev/pricing)
- bundle.social: Free $0 (20 posts created/mo); Pro $100 or $90 yearly (10,000 posts, unlimited teams); Business $400 or $360 yearly (100,000) — [bundle.social pricing](https://bundle.social/pricing.md)
- Postiz cloud: Pro $49 (30 channels), Ultimate $99 (100 channels), no permanent free plan, 7-day trial — [Postiz pricing](https://postiz.com/pricing)
- Blotato: Starter $29 (20 accounts), Creator $97 (40), Agency $499 (accounts not stated); 7-day trial excludes the API — [Blotato pricing](https://www.blotato.com/pricing)
- Mixpost: Lite free, Pro $299 one-time, Enterprise $1,199 one-time; "Building a SaaS requires an Enterprise license" — [Mixpost pricing](https://mixpost.app/pricing)
- Metricool Advanced: 15 brands $67 or $53 yearly; 25 brands $107 or $85; 50 brands $210 or $159. Source is a competitor; pricing dated July 2026 — [SocialPilot on Metricool](https://www.socialpilot.co/insights/metricool-pricing)
- Publer: about $7 per account with every 10th free (third-party estimate, conflicts with SocialKit's figures); the API is available "exclusively to Business and Enterprise customers" — [SocialChamp](https://www.socialchamp.com/blog/?p=179255); [SocialKit](https://socialk.it/en/pricing/publer); [Publer docs](https://publer.com/docs)
- Another option found: Post for Me at $10 per 1,000 posts; its default consent screen shows "Post for Me", and white label needs your own app (vendor comparison, 2026-10-18) — [Social Media Scheduler comparison](https://socialmediascheduler.cc/blog/social-media-posting-api-comparison)

### Inferences
- **My arithmetic:**
  - Ayrshare at 50: $599 + 20 × $8.99 = $778.80.
  - Ayrshare at 200: $599 + 70 × $8.99 + 100 × $3.49 = $1,577.30.
  - Zernio at 400 accounts: $318 + 300 × $1 = $618.
  - Outstand's non-resale plan would cost $19, $19 and $78, but the terms do not allow that for resale, so $129 is the budget figure.
  - Postproxy: $49 + 30 × $2 = $109, and at most $49 + 180 × $2 = $409, because the middle tiers were not captured.
- **Crossover:** among the four verified providers, Upload-Post is cheapest up to about 50 restaurants. Outstand is cheapest from about 50-75 upward, and 3.4 times cheaper at 200 ($129 against $438).
- **Practical path:**
  1. Test with one real restaurant on free tiers: Zernio (2 accounts, no card) or Upload-Post Free.
  2. Launch on Upload-Post Professional at $50.
  3. Move to Outstand Business when passing about 50 restaurants, or sooner if Outstand passes the same test.
- **Stay monthly:** avoid annual billing until a provider has proven itself, for both vendor-risk and payment-cap reasons (see the payment question).

### Gaps
- Exact cost for Postproxy's middle tiers, and whether its terms allow embedding (only a vendor comparison says so).
- Whether bundle.social counts a post to two networks as one post created.
- Metricool, SocialPilot and Hootsuite prices come from competitors; I did not confirm them on the vendors' own pages.

## Does customer OAuth consent run through the provider's Meta app, or must I bring my own?

### Takeaway
Upload-Post, Outstand, Zernio and Ayrshare all state in their own pages that the provider's approved app is used and you need no review. Self-hosted Postiz, Mixpost, Nango and Unified.to all require your own Meta app. The trade-off is that the consent screen names the provider rather than Xedine, at least on Upload-Post.

### Cited Findings

**Provider's app, no review on your side (all vendor statements, none independently audited)**
- Ayrshare: "Your users link their own Facebook Pages through an OAuth flow inside your product, on Ayrshare's approved Meta app." and "You don't need your own App Review, Business Verification, or Page tokens." (page modified 2026-10-29) — [Ayrshare Facebook API](https://www.ayrshare.com/facebook-api.md)
- Upload-Post, Facebook: "There's no developer app to create, no permission requests and no app review on your side." — [Upload-Post Facebook](https://www.upload-post.com/platforms/facebook/)
- Upload-Post, Instagram: "no app registration, no App Review, no permission approvals, no token refresh logic" — [Upload-Post Instagram guide](https://docs.upload-post.com/guides/post-to-instagram-api)
- Upload-Post, consent screen: networks "show their own screen with the app registered there, which is Upload-Post's approved app"; the hosted domain is app.upload-post.com with no custom domain — [Upload-Post white label](https://www.upload-post.com/whitelabel)
- Outstand: "Facebook is covered by Managed Keys - no Meta app review to pass." and "your subscription includes Outstand's own Meta app". BYOK steps are "optional", to be followed "only if you want your own Meta app credentials on the connection screen." — [Outstand Facebook setup](https://www.outstand.so/docs/configurations/facebook)
- Outstand lists Instagram and Facebook as Managed Keys: "we run the OAuth app", "so you can connect an account without registering anything." — [Outstand getting started](https://www.outstand.so/docs/getting-started)
- Zernio: "Your users connect through Zernio's approved platform apps." and "You never register a developer app or touch a token." — [Zernio SaaS use case](https://zernio.com/use-cases/saas-platforms)
- Zernio's docs do not say whether you can use your own Meta app — [Zernio connecting accounts](https://docs.zernio.com/guides/connecting-accounts)
- Postproxy: "Postproxy's app is already approved on every platform" (blog, 2026-02-15, older and vendor content) — [Postproxy blog](https://postproxy.dev/blog/how-to-add-social-media-publishing-to-your-saas-product/)
- PostPeer: "App Review handled, no Meta Business verification on your side" (own blog, 2026-06-08) — [PostPeer blog](https://www.postpeer.dev/blog/best-instagram-posting-api)
- bundle.social says "official platform permissions, account eligibility, app review, rate limits, and media rules still apply"; I found no statement either way on whose Meta app is used — [bundle.social multi-tenant](https://bundle.social/multi-tenant-social-media-api)

**Your own Meta app required**
- Postiz self-hosted: "Create a new app in Facebook developers"; "for public applications, you will need to verify your business" — [Postiz Facebook docs](https://docs.postiz.com/providers/facebook)
- Mixpost: you "need to create and configure a Facebook application" and paste its App ID and App Secret; no Mixpost-provided app is mentioned — [Mixpost Facebook docs](https://docs.mixpost.app/services/social/facebook/)
- Nango: has you create a Meta developer app and copy its App ID and Secret; some permissions may need App Review — [Nango Facebook guide](https://nango.dev/docs/api-integrations/facebook/how-to-register-your-own-facebook-api-oauth-app)
- Unified.to: "add the application's App ID (as the client ID) and the App secret" after registering your own Meta app (2026-08-28) — [Unified.to Facebook guide](https://docs.unified.to/guides/how_to_register_your_facebook_oauth2_application.md)

**Conflict resolved:** a search summary suggested Outstand's Facebook page described BYOK as the model. The full page, read directly, says Managed Keys is the default and BYOK is optional — [Outstand Facebook setup](https://www.outstand.so/docs/configurations/facebook)

### Inferences
- Restaurant owners will probably see "Upload-Post" (or Outstand, Zernio or Ayrshare) on Facebook's permission screen, not "Xedine". Onboarding copy should explain this before the owner taps through. This is stated directly only for Upload-Post, and is an inference for the others.
- Outstand has the clearest escape route: once Xedine is verified it could add its own Meta app on the same API. Customers would still need to reconnect, because Meta consent is tied to the app they approved.

### Gaps
- I did not read Meta's Platform Terms on whether tech providers may lend their app to another SaaS in this way, so I cannot say whether Meta permits it or tolerates it. No vendor page I read addresses this directly.
- Pipedream Connect: no source found on whether its Facebook and Instagram connectors need your own app.
- Mixpost Cloud: whether it provides its own Meta app, and its prices, were not checked.

## Can each customer connect through a hosted link, and do the terms allow reselling this way?

### Takeaway
Upload-Post and Outstand have the clearest terms for this use. Zernio and Ayrshare market it heavily, but their terms give no explicit grant, so get confirmation by email. Postiz forbids it without a written agreement, and Blotato, Publer and Buffer lack the customer-connect flow.

### Cited Findings
- Upload-Post terms §2.2: building your own product on the Services, including letting your customers connect their social accounts through white-label features on eligible plans, "is permitted and does not require any separate authorization." The same section prohibits reselling the API itself or giving third parties direct access — [Upload-Post terms](https://www.upload-post.com/terms)
- Upload-Post white label is "included from the Professional plan"; "Free and Basic do not include it" — [Upload-Post white label](https://www.upload-post.com/whitelabel)
- Upload-Post flow: create a profile per user, call `generate-jwt`, and get an `access_url` valid for 48 hours with optional logo and title — [Upload-Post profile guide](https://docs.upload-post.com/guides/user-profile-integration/)
- Upload-Post also has a Connect API for your own page: `POST /api/uploadposts/oauth/{platform}/start` returns an `authorize_url`, usable for 15 minutes — [Upload-Post docs](https://docs.upload-post.com/landing/)
- Outstand terms (2026-09-24): "An active Business subscription expressly permits reselling the Service to your clients"; otherwise you may not resell "without an active Business subscription or separate written permission" — [Outstand terms](https://www.outstand.so/terms)
- Zernio: "One profile per customer, with no cap on profiles"; "Multi-tenant from day one" — [Zernio SaaS use case](https://zernio.com/use-cases/saas-platforms)
- Zernio's flows: standard OAuth via `GET /v1/connect/{platform}` with `profileId`; a hosted selection screen; a white-label welcome screen with your name and logo; or headless mode where you build the screen — [Zernio connecting accounts](https://docs.zernio.com/guides/connecting-accounts)
- Zernio's terms (2026-10-09) do not address reselling, white-labelling or use for your own customers — [Zernio terms](https://zernio.com/tos)
- Ayrshare: customers link through a "white-labeled connect page" via a JWT URL and "never log in to Ayrshare" — [Ayrshare Business plan overview](https://www.ayrshare.com/docs/multiple-users/business-plan-overview)
- Ayrshare's terms bar "licensing, selling, renting, leasing, transferring, assigning, distributing, hosting" the site and require you to indemnify it for "content submitted by your end users". White-label use is not addressed in the terms, only in marketing copy — [Ayrshare terms](https://www.ayrshare.com/terms/)
- Postiz terms §7: you may not "resell, sublicense, white-label or otherwise commercialise the Service except under a written agreement with Gitroom Limited" — [Postiz terms](https://postiz.com/terms)
- Postiz's API docs describe OAuth2 for apps serving "other Postiz users" and no hosted connect for non-users — [Postiz public API](https://docs.postiz.com/public-api/introduction)
- Blotato: accounts are connected in the dashboard, then listed with `GET /v2/users/me/accounts`; no customer-connect flow is documented — [Blotato API quickstart](https://help.blotato.com/api/start)
- Publer's docs cover listing workspaces and accounts but not connecting them. A vendor comparison says "Cannot connect accounts via API" — [Publer docs](https://publer.com/docs); [Social Media Scheduler comparison, vendor](https://socialmediascheduler.cc/blog/social-media-posting-api-comparison)
- Buffer's new API: third-party OAuth reported as not enabled, verified July 2026 — [Supergood report card](https://supergood.ai/api-report-card/buffer). A pricing-change tracker mentions "OAuth app clients" on the pricing page, so this is unresolved — [Visualping](https://visualping.io/pages/buffer-pricing-alerts-4896317)
- Same vendor comparison on terms: Buffer's "forbid building a substantially similar service"; Hootsuite and Sprout's "forbid replicating the product"; Postproxy "Embedding in your app is allowed; reselling the API on its own is not." — [Social Media Scheduler comparison, vendor, 2026-10-18](https://socialmediascheduler.cc/blog/social-media-posting-api-comparison)
- SocialPilot: third-party comparison sites (around June 2026) list API access only on the custom-priced Enterprise tier, while one competitor's comparison says it has no API at all. These came from search excerpts, I could not tie each claim to one page, and I did not read SocialPilot's own pricing page — [SocialKit comparison](https://socialk.it/en/compare/hootsuite-vs-socialpilot); [SocialKit pricing guide](https://socialk.it/en/pricing/socialpilot); [bundle.social comparison, competitor](https://info.bundle.social/comparison/socialpilot)

### Inferences
- Xedine bundles posting inside a restaurant product and does not sell API access, so it falls within what Upload-Post's §2.2 permits. On Outstand, budget for Business, because an embedded paid feature could reasonably be read as resale.
- Before committing to Zernio or Ayrshare, ask for one email saying a SaaS may onboard its paying customers this way. A short written answer closes the gap in their terms.

### Gaps
- Metricool: no source found on whether its API supports customers connecting their own accounts.
- Outstand: no page confirmed a hosted connect page. Its docs describe an authorize URL that returns users to your `redirect_uri`, so a Page picker may need to be built by you.

## Do they support Facebook Page photo, Facebook Reels, Instagram image and Instagram Reels, and what are the limits?

### Takeaway
All four fitting providers support all four formats, and an 8-second vertical Reel is well inside every published limit. The realistic failures are account type (Instagram must be Business or Creator, Facebook must be a Page) and media URLs Meta cannot fetch.

### Cited Findings
- Upload-Post, Facebook: Page photos, native video, Reels (9:16 videos post as Reels), Stories; video up to 10 GB and 240 minutes; images under about 10 MB; "Send a file or a public URL." — [Upload-Post Facebook](https://www.upload-post.com/platforms/facebook/)
- Upload-Post, Instagram: photos, carousels and Reels; video "max 300 MB"; must be "a Business or Creator account"; a Facebook Page is not required with Instagram Login — [Upload-Post Instagram guide](https://docs.upload-post.com/guides/post-to-instagram-api)
- Zernio, Facebook: Reels up to 60 seconds; images in practice under the stated 4 MB limit; user must be Page Admin or Editor; examples pass a public HTTPS media URL — [Zernio Facebook docs](https://docs.zernio.com/platforms/facebook)
- Zernio, Instagram: Reels up to 90 seconds and 300 MB in the platform docs, but its landing page says 1 GB, so the two conflict; use 300 MB — [Zernio Instagram docs](https://docs.zernio.com/platforms/instagram); [Zernio Instagram page](https://zernio.com/instagram)
- Zernio defaults to Instagram Login, and publishing works the same with either login method — [Zernio Instagram docs](https://docs.zernio.com/platforms/instagram)
- Ayrshare, Facebook: Reels via a flag on a video post; Meta allows 30 Reels per Page in 24 hours; Ayrshare's own limit is 300 API calls per 5 minutes per profile — [Ayrshare Facebook API](https://www.ayrshare.com/facebook-api.md)
- Ayrshare, Instagram: needs a "Business or Creator Instagram Account connected with a Facebook Page"; media must be reachable by Meta's crawler, otherwise error 479; "Only 50 Instagram posts are allowed over a 24 hour period." — [Ayrshare Instagram docs](https://www.ayrshare.com/docs/apis/post/social-networks/instagram)
- Outstand: Instagram Reels via `reelThumbOffset` in the posts endpoint; Facebook Reels via a `publishAsReel` flag — [Outstand Instagram](https://www.outstand.so/instagram); [Outstand Facebook](https://www.outstand.so/facebook)
- bundle.social: per-account daily publishing caps on Facebook and Instagram of 10 (Free), 50 (Pro), 100 (Business) — [bundle.social pricing](https://bundle.social/pricing.md)

### Inferences
- One post a day per restaurant will not reach any published daily cap.
- Ayrshare requires an Instagram linked to a Facebook Page, while Upload-Post and Zernio can use Instagram Login with no Page link. That could mean fewer onboarding failures for restaurants whose Instagram and Page are not linked.

### Gaps
- Outstand's published size limits were not found.
- Upload-Post's Instagram guide does not state public URL support for Instagram or a length limit. Its Facebook page does state public URL support.
- Ayrshare's exact Reel limits are in a separate media guidelines page I did not read.

## How good are the APIs: docs, webhooks, status and errors, scheduling?

### Takeaway
Zernio has the most directly useful documented webhooks for this job, including a disconnect event. Upload-Post's post-status webhook could not be confirmed. Test failure reporting directly during any trial.

### Cited Findings
- Zernio: webhooks when a post publishes, a message arrives, or an account disconnects — [Zernio docs](https://docs.zernio.com/)
- Zernio warns "Facebook tokens expire frequently" and advises subscribing to `account.disconnected` — [Zernio Facebook docs](https://docs.zernio.com/platforms/facebook)
- Upload-Post: redirects return `connect_status` (`success`, `cancelled`, `error`) and a stable `error_code`; a `comment_received` webhook is documented; the docs navigation lists an async uploads guide — [Upload-Post docs](https://docs.upload-post.com/landing/); [Upload-Post Instagram guide](https://docs.upload-post.com/guides/post-to-instagram-api)
- Outstand: the docs navigation lists a Webhooks page, and the launch post covers five Instagram DM events — [Outstand DM launch](https://www.outstand.so/blog/instagram-dms-api-launch)
- Ayrshare: returns specific errors such as 479 for unreachable media — [Ayrshare Instagram docs](https://www.ayrshare.com/docs/apis/post/social-networks/instagram)
- Blotato: no webhooks on its quickstart; you poll `GET /v2/posts/:postSubmissionId` until `published` or `failed` — [Blotato API quickstart](https://help.blotato.com/api/start)
- Postiz: create-post is limited to 90 requests/hour (100 on cloud), a global value that plans do not change — [Postiz public API](https://docs.postiz.com/public-api/introduction)
- Ayrshare (competitor) says Upload-Post lacks pre-publish validation and a history API, has a public status page, and applies daily caps per connected account — [Ayrshare vs Upload-Post, updated 2026-10-23](https://www.ayrshare.com/compare/upload-post-api-alternative/)

### Inferences
- Xedine needs a "reconnect your Facebook" prompt whichever provider is chosen, so a disconnect signal should be a selection test. If a provider has no such webhook, Xedine would have to poll.

### Gaps
- Could not confirm a post-status webhook on Upload-Post or a disconnect webhook on Upload-Post or Outstand. The Upload-Post docs file is about 880,000 characters and I read only the first 100,000.
- Ayrshare's webhook list was not read.

## How reliable and trustworthy are they, and what are the ban, shutdown and lock-in risks?

### Takeaway
None of these has a strong independent reliability record that I could find. There is no credible report of a named provider's Meta app being banned in 2026, but no provider promises against it, and a ban would hit every restaurant at once. All of them can suspend you without notice.

### Cited Findings
- Upload-Post: operated by TONVI TECH SL (C.I.F. B-19780394). It may end access "without prior notice or liability, for any reason". Liability is capped at 12 months' fees or €100, and excludes "content being published to incorrect accounts or platforms". It does not use your content to train AI. Data export and a DPA are provided — [Upload-Post terms](https://www.upload-post.com/terms)
- Upload-Post launched on Product Hunt on 2025-05-12, with 12 followers there — [Product Hunt](https://www.producthunt.com/products/upload-post/launches)
- Upload-Post's 4.9/5 from 127+ reviews is its own claim; I found no Trustpilot page at the expected address — [Upload-Post llms.txt](https://www.upload-post.com/llms.txt)
- Outstand: provided by FortyTwo Eleven Consulting AB (Org.nr 559358-1746), suspends "immediately, without prior notice or liability, for any reason"; liability is capped at 12 months' fees or $100 — [Outstand terms](https://www.outstand.so/terms)
- Outstand self-reports 12.8M+ posts a month, 500+ companies, and 99.92% uptime — [Outstand homepage](https://www.outstand.so/)
- Zernio: ZERNIO SOFTWARE SL, Palamós, Spain; can suspend "immediately, without prior notice or liability"; no liability cap stated; a DPA applies automatically (terms 2026-10-09) — [Zernio terms](https://zernio.com/tos)
- Late renamed to Zernio, with the company's page dating it to March 2026 and another profile saying "Early 2026"; getlate.dev now 301-redirects to zernio.com — [Zernio marketing page](https://zernio.com/marketing-infrastructure); [redirect, as read 2026-11-04](https://getlate.dev/pricing)
- Zernio Trustpilot: 4.8/5 from 208 reviews; the only clear complaint on page one is a refund dispute over a phone-number deposit (2026-10-23), and no Facebook or Instagram disconnect complaints appear on that page — [Trustpilot](https://www.trustpilot.com/review/zernio.com)
- An independent reviewer says "I have not run Zernio in production" and discloses an affiliate tie to rival Blotato — [Ryan Doser, updated 2026-09-30](https://ryandoser.com/zernio-review/)
- Zernio describes itself as an approved Meta Marketing Partner (vendor claim) — [Zernio Meta Ads](https://zernio.com/meta-ads)
- Ayrshare Trustpilot: 4.0 from only 4 reviews, with a note that reviews may not be representative — [Trustpilot](https://www.trustpilot.com/review/ayrshare.com)
- Ayrshare's status page logged Meta-side API outages affecting posting in 2024; these are older data and were later marked resolved — [Ayrshare status](https://docs.ayrshare.com/additional-info/status-update)
- Ayrshare can suspend "without prior notice or liability", disclaims third-party bans, and caps liability at 12 months' fees or $100 — [Ayrshare terms](https://www.ayrshare.com/terms/)
- Postiz: Gitroom Limited contracts for subscriptions; Gitroom LLC is the entity registered with the platforms — [Postiz terms](https://postiz.com/terms)
- Precedent for platform risk: Meta removed third-party Facebook Groups access in 2024, which hit scheduling tools (older data, and an API removal rather than a vendor ban) — [TechCrunch, 2024-02-05](https://techcrunch.com/2024/02/05/meta-cuts-off-third-party-access-to-facebook-groups-leaving-developers-and-customers-in-disarray/amp)

### Inferences
- **Lock-in:** Meta consent is granted to the provider's app, so switching provider should require every restaurant to reconnect. Post data and API code are the easy parts to move; those consents are not.
- **Mitigation:** keep posting behind one internal gateway and store `provider`, `profile_id` and `account_id` per branch, so a switch needs code in one place plus a reconnect prompt.
- **Single point of failure:** because all customers share one provider app, a Meta action against that app would stop all restaurants at once. This is my reasoning, and I found no incident showing it has happened to these vendors.
- **Age:** Upload-Post has been public only since about May 2025, so it deserves monthly billing and a tested fallback.

### Gaps
- No usable Reddit threads or first-hand developer reports turned up on Upload-Post, Zernio or Ayrshare, despite targeted searches. Most comparison content comes from competing vendors. This is a real evidence gap, so reliability claims above should be read as weak.
- Outstand's founding date and independent reviews were not found. The TrustMRR profile could not be read.
- Ayrshare's company age was not confirmed from a primary source. Vendor comparisons call it the most mature, but that is not evidence.
- Live status-page history for 2026 was not checked for any provider.

## Does self-hosted Postiz or Mixpost need your own Meta app and therefore verification?

### Takeaway
Yes. Both use your own Meta app, and Postiz's docs say public use needs business verification. Self-hosting does not solve the problem, however cheap it is.

### Cited Findings
- Postiz: create your own app, request advanced access for `pages_show_list`, `business_management`, `pages_manage_posts` and others; "for public applications, you will need to verify your business"; advanced permissions are not required "for personal use only" — [Postiz Facebook docs](https://docs.postiz.com/providers/facebook)
- In Development mode, posts are visible only to app roles, and others see the post without its image or may not see it at all — [Postiz Facebook docs](https://docs.postiz.com/providers/facebook)
- Postiz's own pricing page lists getting your own social apps approved for self-hosting as an optional paid service, with no price shown — [Postiz pricing](https://postiz.com/pricing)
- Mixpost needs your own Facebook app. Its docs say unpublished app data is visible only to app role users, and they list `pages_manage_posts` and `instagram_content_publish` among the permissions — [Mixpost Facebook docs](https://docs.mixpost.app/services/social/facebook/)
- Third parties sell "guaranteed" Postiz Meta approvals; this is unverified marketing and does not remove business verification — [singhamandeep.com](https://singhamandeep.com/postiz-app-approval/)
- A January 2025 comment from the Postiz maintainer said a standalone Instagram provider needs no Facebook business account, and that sign-off is needed only for public use (older, secondhand via a Reddit mirror) — [Reddit mirror](https://lr.in.psf.lt/r/selfhosted/comments/1i5qnzq/postiz_v1281_opensource_social_media_scheduling)

### Inferences
- Xedine serving many restaurants is public use, so Postiz's personal-use exception would not apply. A self-hosted install would remain useful only after verification is done.

### Gaps
- Mixpost's docs do not explicitly say verification is required; they cover only the need for your own app, and an App Review link for one feature. Meta's current Advanced Access rules were not read directly.

## Can this be paid for from Bangladesh?

### Takeaway
Probably by international card for amounts under about $300 per charge, but the cap I found dates from 2020 and I could not confirm it for 2026. PayPal is not an option. No vendor documents Bangladesh payment support, so try a small charge first.

### Cited Findings
- Bangladesh Bank circular of 2020-09-20: "A single transaction must be within $300", within annual limits. Permitted purposes include BASIS member IT or software firms and technology-related expenses. **This is six years old** — [The Business Standard](https://www.tbsnews.net/node/135475)
- PayPal: "you can't open a PayPal account with a Bangladesh address" as of 2026-09-09; a July 2026 framework allows bank-linked wallets with foreign providers, but no PayPal launch date exists (fintech vendor blog) — [Elevate Pay](https://www.elevatepay.co/blog/is-paypal-available-in-bangladesh)
- An undated Prothom Alo headline says PayPal and Payoneer-like services were cleared for launch, which I could not confirm — [Prothom Alo](https://en.prothomalo.com/amp/story/business/local/lxga62dv91)
- Freelancer Cards for international software and subscription payments are becoming widely available (2026) — [Ittefaq](https://en.ittefaq.com.bd/16481/credit-cards-financial-lifeline-for-middle-class)
- One user reports a dual-currency card with a USD 1,000 annual international cap (anecdote) — [Shopify community](https://community.shopify.com/t/payment-issues-from-bangladesh/321503)
- Issuers may block recurring international charges by default (commercial guide) — [spendfigo](https://spendfigo.com/guides/digitalocean/bangladesh)

### Inferences
- If the $300 cap still applies, these charges would be problematic: Ayrshare Business ($599+), Zernio at 50 and 200 restaurants ($318, $618), Upload-Post Business ($438), and any annual plan such as Upload-Post Advanced ($1,411/yr).
- Monthly charges that fit under the cap: Upload-Post Professional and Advanced, Outstand Business, Postproxy (up to roughly 145 groups at the $2 rate, my arithmetic), and Ayrshare Launch at $299, only just.
- An annual cap on a personal card could be a tighter limit than the per-charge one: $129/mo is $1,548 a year, above the anecdotal USD 1,000.

### Gaps
- No current Bangladesh Bank text on per-transaction or annual limits was found; ask the issuing bank.
- None of the vendor pages I read state which payment processors or countries they accept, or say anything about Bangladeshi cards.
