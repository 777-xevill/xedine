# The Partner plan ($250 a month)

Xedine's most powerful plan (the founder, 2026-11-18): everything in Pro, plus the founder's team working with the
restaurant every month, Xegency's way: discover → audit → suggest → visualise → build → launch → improve. The
home page card is `PartnerCard` in `src/components/landing-3d/pricing-section.tsx`; the counted deliverables are
`PARTNER` in `src/components/landing-3d/pricing.ts`.

## What the restaurant gets each month

| Service | What exactly | Who pays the outside cost |
| --- | --- | --- |
| Cinematic films | 1 story film (~30 s) + 4 short reels of its dishes, made in Higgsfield | Xedine (Higgsfield, ~$55–60 a restaurant) |
| Ads run for you | Facebook and Instagram ads planned, run and improved | **The restaurant** (the ad money, paid straight to Meta) |
| A visit and a makeover plan | The founder studies the place; AI pictures of walls, light, entrance | Xedine (Higgsfield images or Cloudflare FLUX, free tier) |
| Your own website and app | Made for its brand and menu with Claude Code: a website on Cloudflare and an app (a PWA, or a Play Store app the way Xedine's own is made, ADR 0065) | Xedine (free hosting); the domain and the Play developer fee are the restaurant's |
| Your brand look | Logo touch-up, menu design, one style for every post | — (printing is the restaurant's) |
| One custom build | A page, an automation or a report just for that restaurant | Xedine (Claude Code) |
| Monthly growth review | What was done and what changed in sales, from Xedine's metrics, on a call | — |
| Strongest AI | 50 a week (Pro: 20) — not built yet | Xedine |

Not in the price, quoted first: the ad money, printing, building work, hardware. Visits in Dhaka; elsewhere by
video call. Nothing is unlimited.

## The real limit: the founder's time

Per restaurant a month, roughly: a visit and its pictures (½ day), the film and reels (1 day), ads (2 hours a
week), the custom build (1 day), the review (1 hour) — about 4 working days. A solo founder can serve about
**4–5 Partner restaurants**; the card says "We take a few restaurants at a time". Higgsfield is the only paid
tool; at ~$60 a restaurant it leaves ~$190 of each $250.

## What to build in Xedine for Partner restaurants (proposal, nothing built yet)

Best first; each is a thin slice on what Xedine already has.

1. **Ads → sales** (no outside approval needed). The founder enters each campaign's dates, spend and the dishes it
   promotes; Xedine shows the sales of those dishes before and during it, from the existing sales metrics (a new
   metric in docs/METRICS.md, deterministic, no AI numbers). This is the proof a $250 client renews for.
   Later, Meta's Marketing API (needs `ads_read` app review) can fill spend and reach by itself.
2. **Partner films in the autopilot.** An upload slot on Growth → Video for the finished Higgsfield films; the
   autopilot posts them to Facebook, Instagram and TikTok at the restaurant's best times (the publishing code
   exists, ADR 0040/0041/0061). Higgsfield has no API we rely on, so making the film stays manual.
3. **Makeover pictures.** Photograph a wall, the entrance or the lighting in Xedine; FLUX (already wired for dish
   pictures, ADR 0057) draws the redesign; the owner sees before/after side by side. Each picture marked
   "AI concept", never a promise of the result.
4. **Monthly growth review page.** One page per month: what the team did (written by the founder) beside the
   month's numbers from metric functions (sales, best sellers, leaks fixed, repeat customers). Printable.
5. **Restaurant website from Xedine's data.** A site at the restaurant's own domain whose menu, prices, photos,
   branches and hours come from Xedine, so they never go stale; the design is made per restaurant with Claude
   Code. The biggest of the five; start with one restaurant.
6. **The plan itself in billing.** A `partner` row in `plans`, the higher strongest-AI limit, and the team's
   deliverables as a monthly checklist the owner can see.

Open questions for the founder: the price in taka for Bangladesh; whether the card should name Xegency as the
team; how many Partner places to open first.
