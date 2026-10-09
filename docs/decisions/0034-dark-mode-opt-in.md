# ADR 0034 — Dark mode as an opt-in switch

- Date: 2026-10-10
- Status: accepted
- Amends: ADR 0024 ("light only, never a black background"). Light stays the default.

## Context
ADR 0024 replaced a dark glass UI the founder found "too black" with a light one. Later the founder asked for a black-and-white (light/dark) mode and, asked plainly, chose: a switch, light by default, not following the phone's setting.

## Decision
- **A Light | Dark switch in the sidebar**, under the language switch (`ThemeSwitcher`). Everyone starts light. The choice is kept in the browser (`localStorage`, key `xedine-theme`) and shown as `data-theme="dark"` on `<html>`.
- **No flash.** A small inline script (`ThemeScript`) at the top of the dashboard layout sets the attribute before the page paints. `ThemeApplier` sets it on entering the dashboard and puts light back on leaving it.
- **Only the dashboard.** The theme components are mounted by the org layout alone, so sign-in, the landing page, the till (POS) and the kitchen screen (KDS) stay light. The till and kitchen run on cheap tablets in bright rooms (BRAND.md), and the receipt print templates are untouched.
- **Same tokens, second set of values.** `[data-theme='dark']` in `globals.css` remaps the semantic tokens (page, card, raised panel, text, borders, glass, shadows) onto the guideline palette: navy page, navy-2 cards, mist text, slate secondary text. It is navy, never pure black. Components are unchanged: they already read tokens only (`brand-tokens.test.ts` forbids hex in components, and now also checks the dark block).
- **Status and accent colours.** They were bright by design (made for a dark page); the light theme mixes them with navy to get readable "ink". In dark the bright originals are used directly. Purple as text is lightened (`--accent-purple-ink`, 6.4:1 on a card; the brand purple itself is 3.4:1 there). The primary button gradient and the logo tile do not change.
- **Contrast** (WCAG, on the dark card): text 17.7:1, secondary 7.9:1, muted 5.9:1 (4.8:1 on a raised panel), purple text 6.4:1, status colours 6.2–9.8:1.

## Alternatives considered
- Follow the phone's night setting automatically: rejected by the founder in favour of an explicit switch (an owner's phone is often in night mode while the restaurant screen should stay familiar).
- Theme on the whole site: the till and kitchen would turn dark in bright dining rooms.
- A cookie instead of `localStorage`, so the server could render dark: more code for a per-device preference; the inline script already avoids the flash.

## Consequences
- The choice is per browser, not per account: a new phone starts light.
- A new colour must work in both sets of tokens; the dark block is the second place to look when a token is added.
