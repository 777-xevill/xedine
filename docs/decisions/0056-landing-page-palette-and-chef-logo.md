# ADR 0056 — The landing page uses the founder's grey, silver and yellow; the new chef logo

- Date: 2026-11-15
- Status: accepted (the founder's request: change the logo to the one they sent, and change the colours on the
  landing page only, not inside the app: grey #2B2D31, silver #D9DADC, and yellow #FFC93C for buttons and small
  places; no other colours)

## Decision
1. **Three tokens, landing page only.** `--landing-grey`, `--landing-silver` and `--landing-yellow` live in
   `globals.css` (with `--color-landing-*` Tailwind utilities). Components still never write a hex colour.
2. **Scoped by a wrapper.** `src/app/page.tsx` is wrapped in `.landing`, which remaps the shared semantic tokens
   (`--bg`, `--surface`, `--text*`, `--border*`, `--action-gradient`, `--on-action`, shadows) onto the three
   colours plus white. Shared components (buttons, the language switch) take the palette without being changed.
   Dark bands use `.landing-dark` (grey band, silver text). The app inside keeps its palette (ADR 0024, 0034).
3. **Yellow is for actions and small marks only:** primary buttons (yellow with grey words, 9 : 1), the
   highlighter under the headline accent, step numbers, small dots and icons, one chart bar. Text is grey on a
   pale silver page (12.5 : 1); silver on grey is 9.9 : 1. No gradients and none of the guideline accents
   (pink, purple, blue, cyan) on this page.
4. **The chef logo.** The founder's image is kept as `Brand_assets/logo-chef-source.jpeg`; the tile is cut
   out with see-through rounded corners as `public/brand/logo-chef-{64,192,512}.png`, used on the landing page
   (header, footer, call-to-action box).

## Consequences
- The sidebar, sign-in, chat avatar, browser-tab icon (`src/app/icon.png`), home-screen icon and notification
  icons still use the old logo; switching them is a separate choice.
- `brand-tokens.test.ts` checks the three hex values and that landing buttons are yellow with grey words.
