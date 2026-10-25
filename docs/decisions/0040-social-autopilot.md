# ADR 0040 — Social autopilot: Xedine posts to Facebook and Instagram by itself

- Date: 2026-10-26
- Status: accepted (built at the founder's request; the choices in §1–§3 were the founder's answers)

## Context
The Growth page only drafted ideas and captions; the owner had to approve each one and post it by hand
(PRODUCT.md M17: "no auto-posting in MVP", CLAUDE.md #4). The founder wants a fully automated social
media manager: the owner sets it up once, and the restaurant's Facebook Page and Instagram get a fresh
post every day, "even if the owner is offline for a month", with a picture that matches the caption and
short videos with strong hooks. Budget: zero. Groq (free) is the AI now; Anthropic later; nothing else paid.
Reference look: `Brand_assets/demo-gen/` — one dish on a bold flat colour, a diagonal band, a huge
headline, a short tagline, logo and contact.

## Decision
1. **Fully automatic, no preview** (founder's choice over "morning preview" and "approve a week"). This
   is a deliberate exception to CLAUDE.md #4 for social posts only. Guard rails instead of approval:
   - words come from one public fact (best seller, the quietest time of day, a dish spotlight, or the
     owner's own line); every number in the words must be in that fact or the owner's line, or the post
     is stopped (`inventedNumber`, CLAUDE.md #1). Sales figures themselves are never put in a public post;
   - the owner can switch it off, choose days and time, list dishes never to post, and skip any coming post.
2. **Real photos, improved** (founder: "the restaurant uploads pictures and you improve them"). Posts are
   made only from the dish photo on the Menu page (ADR 0031). Groq's vision model checks the photo really
   shows food and is sharp (the demo's "Beef Bhuna" photo is a man at a desk — exactly what this stops).
   Cloudflare Workers AI FLUX.2 [klein] 4B takes the photo as a reference and returns a studio-lit plate on
   the brand colour (free tier 10,000 neurons/day ≈ 60 pictures of 1024×1280). If Cloudflare is not set
   up or the quota is used up, the real photo is used. **The image model never draws text.**
3. **Text, logo and Bangla are laid on by Xedine** in HTML templates rendered by a real Chromium
   (`@sparticuz/chromium` + `puppeteer-core` on Vercel), because image models garble words and simpler
   renderers (Satori) do not shape Bangla conjuncts. Four poster designs (band, centre, frame, split)
   rotate by day; 1080×1350 JPEG.
4. **Reels are motion posters**, not AI video (no free AI-video API exists): 8 s, 1080×1920, 24 fps —
   hook on a highlight box over the blurred dish (0–3 s), the plate spins in with headline and tagline
   (3–6 s), contact card and call to action (6–8 s). Frames are stepped through the Web Animations API, so
   output is identical on any machine; `ffmpeg-static` encodes H.264 + silent AAC (Reels' format).
   `format = mix` alternates a poster day and a reel day.
5. **Everything runs inside the existing app**: pg_cron → `/api/jobs/social_tick` every 10 minutes
   (answers at once, works in `after()` up to Vercel's 300 s). Each tick: plan today's and tomorrow's
   autopilot post, make posts due within 3 hours, publish posts that are due, delete media of posts 3+
   days old (Supabase free storage is 1 GB). No GitHub Actions, no extra service.
6. **Publishing through Meta's Graph API** (`v25.0`): Facebook photo / Reels (`video_reels` with
   `file_url`) and Instagram containers (image or `REELS`, polled until `FINISHED`). Media are read by
   Meta from the public `social-media` bucket. `fb_id` / `ig_id` are written as each platform succeeds,
   so a retry never posts twice; three failures mark the post failed with a plain-words reason.
7. **Connecting**: the owner signs in with Facebook (signed, 30-minute OAuth state; the returning browser
   must be the same user). The Page token (does not expire on its own) goes to `social_tokens`, a
   service-only table; if Facebook offers several Pages the owner picks one. All token handling lives in
   `src/modules/social/connect.ts`, the one non-job file allowed the service role for this.
8. **Who**: the owner sets up (Settings → Social); the owner or a manager sees Growth, makes a post of
   their own (`request_social_post`) and skips one (`skip_social_post`), both audited.

## Alternatives considered
- **A morning preview the owner can stop, or approving a week at once**: offered; the founder chose no preview.
- **Fully AI-drawn food**: looks good but may not match the restaurant's real plate; rejected for trust.
- **Rendering on GitHub Actions**: free 2,000 min/month, but scheduled workflows run only on the default
  branch and add secrets to manage; Vercel's 300 s functions are enough (a reel renders in ~20 s locally).
- **Remotion**: free for ≤3 people but a licence to track and more weight; the same frame-stepping idea is
  ~100 lines here.
- **Gemini / Pollinations images**: Gemini's API free tier no longer covers images; Pollinations has no
  clear commercial terms or limits.

## Consequences
- New: `social_settings`, `social_accounts`, `social_tokens` (service only), `social_connect_pending`
  (service only), `social_posts`, enum `social_post_status`, `request_social_post`, `skip_social_post`,
  bucket `social-media`, cron `xedine-social-tick` (migration `20261026000001_social_autopilot.sql`).
  The old Growth idea drafts (`growth_content_drafts`, `metric_growth_inputs`) stay; the drafts UI is gone.
- New dependencies: `@sparticuz/chromium` (Chromium for serverless), `puppeteer-core` (drives it),
  `ffmpeg-static` (encodes reels; its install script is allowed in `pnpm-workspace.yaml`).
- Environment: `META_APP_ID`, `META_APP_SECRET` (optional `META_LOGIN_CONFIG_ID` for a Business app's
  Facebook Login for Business), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`. Locally, `CHROME_PATH`.
  Without Meta keys posts are still made and can be downloaded from Growth; without Cloudflare the real
  photo is used.
- **Meta access**: until Xedine passes Business Verification and App Review, the Meta app stays in
  Development mode and can post only to Pages whose admins hold a role on the app (the founder's demo
  Page). The founder has no trade licence (online-only business); DBID is the suggested route. *Open.*
- Gaps, not built: likes/reach insights on Growth; holiday/festival posts (Eid, Pohela Boishakh); music on
  reels; telling the owner on Telegram when a post fails or the Page token stops working.
