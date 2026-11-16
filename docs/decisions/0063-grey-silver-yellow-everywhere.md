# ADR 0063 — Grey, silver and yellow everywhere, with motion

Date: 2026-11-16 · Status: accepted (the founder) · Supersedes the colours of ADR 0024 and ADR 0034 · Builds on
ADR 0009, 0056

## Context

The founder: "grey is primary colour like whole page, silver is correct, yellow also … I want to change internal
full A to Z … don't change anything, I just want to change colour and UI/UX … add animation everywhere … our new
logo everywhere … don't use any colour, only these colours." Asked plainly, they chose: the whole app ("a to z":
owner pages, till and kitchen screen, sign-in, customer pages); grey as the primary colour with the rest left to
our judgement; "Apple-type" motion with glass and glow; a new modern font.

Until now only the landing page (ADR 0056) wore grey #2B2D31, silver #D9DADC and yellow #FFC93C; the app inside
was light (ADR 0024) with an opt-in navy dark mode (ADR 0034), purple actions and the guideline's neon accents.

## Decision

1. **Three colours, nothing else.** Grey is the page everywhere; silver the words and edges; yellow the actions,
   focus and attention. Every other shade is a `color-mix()` of the three; white only for paper, QR codes and
   the landing page's light parts. The semantic tokens keep their names, and the old accent utilities
   (`purple`, `pink`, `cyan`, status colours) now resolve to the three, so every screen follows without a
   rewrite. A test fails on any other colour in `globals.css`.
2. **Meaning without more colours:** yellow is attention (warning a tint, danger solid), silver is calm
   (success, info); status keeps its icon and words. Chart: yellow and silver. Four players: yellow, silver,
   gold, pale gold.
3. **One theme.** The light/dark switch is removed (the grey is already the dark, calm look). The phone's status
   bar is grey (`themeColor`), the native controls dark (`color-scheme`).
4. **Glass and glow:** translucent grey with blur, a hairline silver rim and a top light; a faint drifting
   yellow/silver light behind the page; a yellow glow under primary actions. Solid surfaces on the till and
   kitchen screen (cheap tablets) and for people who ask for less transparency.
5. **Motion, Apple-style** (CSS only, no new dependency): pages arrive in a short cascade through each
   section's `template.tsx`; a loading skeleton while a page's numbers load; cards rise in on scroll; presses
   sink on a spring; dialogs rise on a spring; menus drop in; the sidebar's yellow marker grows in; figures
   arrive out of a blur (the value is final from the first frame; no counting up, so no number is ever shown
   that the metric did not produce). The till keeps only the press feedback. Everything stops for reduced
   motion.
6. **Font:** Inter (Latin) + Noto Sans Bengali (Bangla) via `next/font` (self-hosted at build time, no request
   to Google from the browser). This settles BRAND.md's "typography pending".
7. **Logo:** the chef tile everywhere (sidebar, phone bar, sign-in, assistant avatar, browser tab, phone home
   screen, notifications); the old gradient X logo files are removed.
8. **No feature, flow, text or data change.** Layout and navigation stay as ADR 0024 set them (sidebar + one
   workspace); only how they look and move.

## Consequences

- CLAUDE.md non-negotiable #9 now reads "grey, silver, yellow only"; BRAND.md is rewritten.
- Posters and videos (ADR 0057, 0058, 0061) keep their own looks: they are the restaurant's marketing, not the
  app's interface.
- Not verified on a real device before going live (no local server on this machine); the first look is on
  xedine.org.
