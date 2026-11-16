# Brand — STATUS: READY (colour, surfaces, motion, typography, logo) · ADR 0063

Decisions: [ADR 0063](decisions/0063-grey-silver-yellow-everywhere.md) (the whole app in the founder's three
colours, motion, font, logo), [ADR 0056](decisions/0056-landing-page-palette-and-chef-logo.md) (where the palette started),
[ADR 0009](decisions/0009-brand-tokens.md) (tokens only, never a hex in a component). ADR 0024's light theme
and ADR 0034's light/dark switch are superseded.

**Never hardcode a colour in a component.** All colour reaches the UI through CSS variables in
`src/app/globals.css`, so rebranding stays a token swap. `src/lib/brand-tokens.test.ts` fails on a hex in a
component, and on any colour in `globals.css` other than the three below plus white.

## The three colours

| Colour | Token | Hex | Role |
|---|---|---|---|
| **Grey** | `--brand-grey` | `#2B2D31` | **The primary colour.** The page everywhere, the words on yellow |
| **Silver** | `--brand-silver` | `#D9DADC` | The words, hairline edges, calm statuses, the second chart colour |
| **Yellow** | `--brand-yellow` | `#FFC93C` | Actions (buttons, switches, the current page), focus, attention |

Every other shade is a `color-mix()` of these three. White appears only on paper (receipts, printed QR
cards), inside QR codes (scanners need it) and on the landing page's light parts.

## Surfaces (Apple-style elevation: what is closer is lighter)

| Token | Value | Use |
|---|---|---|
| `--bg` | grey | The page |
| `--bg-secondary` | grey + 3.5% silver | The sidebar (as frosted glass) |
| `--surface` | grey + 5.5% silver | Cards, sheets |
| `--surface-elevated` | grey + 9% silver | Fields, stat tiles, the current sidebar item |
| `--surface-hover` | grey + 13% silver | Hover and the selected tab |
| `--border` / `--border-strong` | grey + 12% / 22% silver | Lines |
| `--glass-edge` | silver at 13% | The hairline rim on glass |
| `--scrim` | grey at 72% | Behind dialogs and the phone menu |

Glass (`glass`, `glass-strong`) is translucent grey with a 22px blur, a hairline silver rim and a faint top
light (`--rim`). Depth comes from lighter fills and rims, not from black shadows. The page has a faint
yellow glow from the top corner and a silver one from the bottom, drifting over half a minute (`.aurora`).

## Text (worst case on the lightest surface, all pass WCAG AA)

| Token | Value | Contrast | Use |
|---|---|---|---|
| `--text` | silver | 7.9 : 1 (9.9 on the page) | Primary text, **every figure** |
| `--text-secondary` | silver 86% | 6.1 : 1 | Body copy, table cells |
| `--text-muted` | silver 76% | 5.1 : 1 | Labels, metadata |
| `--text-disabled` | silver 45% | — | Disabled controls only |
| yellow as text | yellow | 9.0 : 1 on the page | Links, attention words, active icons |

## Meaning with three colours

Status is **never colour alone**: always an icon and words too (BRAND rule since ADR 0009).
- **Yellow is attention.** Warning = a yellow tint; danger = solid yellow (badges) or a yellow edge
  (alerts) — the loudest thing on the screen. Negative money is yellow with a minus sign.
- **Silver is calm.** Success, done and information are silver with their icon.
- Charts: yellow for the main series or the peak, silver (or yellow at half strength) for the rest.
- Four-way colour (game players, the wheel): yellow, silver, gold (yellow 60% + silver) and pale gold.
- The old accent names (`purple`, `pink`, `cyan`, `success`, `warning`, `danger`, `info`) still exist as
  utilities and resolve to the above, so every screen follows without a rewrite.

## Actions

- **Primary:** yellow pill with a soft top light and grey words (9 : 1), a yellow glow underneath.
- **Secondary:** a raised grey pill with a silver rim. **Ghost:** words only. **Danger:** outlined yellow.
- **Focus:** a 2px yellow ring; fields glow yellow when focused.
- `--brand-gradient` (yellow → gold → silver) is for the composer's halo and decoration only, never
  behind a figure.

## Motion (ADR 0063)

Apple-style: smooth deceleration for what arrives (`--ease-smooth`), a gentle spring (≈4% overshoot,
`--ease-spring`) for what you touch.
- **Pages** arrive in a 45 ms cascade: the title out of a soft blur, then each block rising (`.page-enter`,
  via each section's `template.tsx`). A grey-glass skeleton with a silver sheen shows while a page loads.
- **Cards** further down rise in as they scroll into view (`data-reveal`, scroll timelines where the
  browser has them). Clickable cards lift 2px on hover.
- **Everything pressable** sinks to 97% while held. Dialogs and the till's sheets rise on a spring;
  menus drop in; the sidebar marker grows in; figures arrive out of a blur (`animate-figure`).
- **The till and the kitchen screen** keep only the press feedback: no page cascade, no aurora, no blur.
- **Reduced motion:** every animation stops (`prefers-reduced-motion`); reduced transparency gets solid
  surfaces.

## Typography (ADR 0063)

**Inter** for Latin letters and digits, **Noto Sans Bengali** for Bangla, both self-hosted by `next/font`
(`src/app/layout.tsx`). Large page titles are bold with tight tracking; figures use tabular digits; Bangla
digits when the locale is `bn`, via the shared formatters.

## Logo

The chef tile: `public/brand/logo-chef-{64,192,512}.png` (source `Brand_assets/logo-chef-source.jpeg`), a
white app-icon tile with the grey chef and a yellow hat band. It sits on the grey as it is, with a hairline
rim, everywhere: the sidebar, the phone bar, sign-in, the assistant's avatar, the browser tab
(`src/app/icon.png`), the phone home screen (`src/app/apple-icon.png`) and notifications. One component:
`src/components/brand-mark.tsx`. Still needed: an SVG and a 1-bit version for thermal receipts.

## Landing page (ADR 0056)

The public landing page keeps its light parts (a pale silver page, white cards, grey words) inside the
`.landing` wrapper, with grey bands (`.landing-dark`) like the app. Yellow is never text on its light parts.

## Surface personalities

| Surface | Treatment |
|---|---|
| **Dashboard** | Frosted sidebar + one workspace (ADR 0024's layout). Glass cards on the grey page |
| **POS** | Same grey, **solid** surfaces (no blur), big touch targets; press feedback only |
| **KDS** | Same grey, solid surfaces, readable at 2 m; ticket age drives silver → yellow + icon + words |
| **Customer pages** (table QR, card, games) | Same grey; games use the four-step yellow/silver set |
| **Receipts / KOT** | **Brand does not apply.** Pure black on white, 58/80 mm |
| **WhatsApp / Telegram** | Plain text. Emoji carry status per the fixed rules below |

## Fixed semantic rules

- 🟢 / 🟡 / 🔴 statuses always pair colour with an icon and a text label.
- Money via `formatMoney` in the restaurant's currency; negative values use `--danger` and a minus sign.
- Findings show the money impact first, then evidence, then actions.
- **The gradient and the "AI Generated" badge mark narrative, drafts and suggested actions — never a
  number.** A figure is rendered in plain text tokens because it came from a metric function, not a model.
