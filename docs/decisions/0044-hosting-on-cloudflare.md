# ADR 0044 — Hosting moves from Vercel to Cloudflare Workers

- Date: 2026-11-10
- Status: accepted (founder's request; **cut-over of xedine.org is a separate, confirmed step**)

## Context
Vercel's free limit stopped the site once already (402, 2026-11-02) and forced a move to a second account. The founder asked to host on Cloudflare instead.

## Decision
1. **App on Cloudflare Workers through OpenNext** (`@opennextjs/cloudflare`, `wrangler.jsonc`, `open-next.config.ts`). Pages is not used (Workers is Cloudflare's current path for Next). The adapter needs Next ≥ 16.4.5, so Next went 16.3.5 → 16.4.5 (typecheck, lint and 340 unit tests pass).
2. **Builds run on GitHub Actions** (`deploy-cloudflare.yml`, `pnpm cf:deploy`). Locally on Windows OpenNext's bundling fails with "Access is denied" on pnpm's symlinks, and WSL is unavailable (virtualization off).
3. **The social autopilot leaves the web app.** A Worker cannot run Chromium or ffmpeg, so the 10-minute tick runs as the GitHub Actions workflow `social-tick` (`scripts/social-tick.ts`, `pnpm social:tick`), same job, same `job_runs` claim. The route `/api/jobs/social_tick` now only answers `runs_on_github_actions`, so pg_cron's old call is harmless. This reverses the "Rendering on GitHub Actions" rejection in ADR 0040; its two worries remain: scheduled workflows run only from the **default branch** (`main`), and the keys must be GitHub secrets. GitHub's 5-minute schedule jitter is fine for a 10-minute tick.
4. Removed from `next.config.ts`: the Chromium/ffmpeg tracing settings. `vercel.json` (region `sin1`) is replaced by `placement: smart`.
5. **Everything that pointed at Vercel must be repointed at cut-over:** Worker secrets (from `.env.local`), `SITE_URL`, Telegram webhook (`pnpm telegram:webhook`), Meta and TikTok redirect URIs, `private.app_config.job_base_url`, and the xedine.org DNS (move the domain's DNS to Cloudflare).

## Consequences
- New dependencies: `@opennextjs/cloudflare`, `wrangler` (both maintained by Cloudflare). `workerd` build script left denied in `pnpm-workspace.yaml`.
- The `/api/jobs` `maxDuration` is gone; the other jobs are short.
- Not verified: a real Worker build and deploy. The first run of `deploy-cloudflare` is the test.
