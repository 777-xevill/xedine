# Brand — STATUS: READY (colour & surfaces) · PENDING (typography, logo usage, light mode)

Source: `Brand_assets/brand_guidline.png`, `Brand_assets/logo.png`. Decision: [ADR 0009](decisions/0009-brand-tokens.md).

**What you may use now:** every colour below, as CSS variables. **What is still pending:** typography (no fonts specified — and the `bn` locale needs a Bangla face), logo usage rules, an SVG/favicon set, and any light theme.

**Never hardcode a hex value in a component.** All colour reaches the UI through CSS variables on `:root`, so rebranding stays a token swap.

## Theme

**Dark is the default and only theme.** The guideline is dark-only; a light theme would be invented, not branded. Do not add `prefers-color-scheme: light` handling until a light palette exists — this gap is deliberate.

## Colour tokens

### Backgrounds & surfaces
| Token | Value | Use |
|---|---|---|
| `--bg` | `#05060A` | Main background |
| `--bg-secondary` | `#080B16` | Secondary background |
| `--surface` | `#0D1120` | Card background |
| `--surface-elevated` | `#12182A` | Elevated surface (modals, popovers, sheets) |

### Text
| Token | Value | Contrast on `--surface` | Use |
|---|---|---|---|
| `--text` | `#F7F8FC` | 17.7 : 1 | Primary text, **all ৳ figures and metric values** |
| `--text-secondary` | `#A7ADBF` | 8.4 : 1 | Secondary text, body copy, table cells |
| `--text-muted` | `#687087` | **3.8 : 1 — fails AA for normal text** | Large labels only (≥ 24px, or ≥ 18.66px bold). Never for a figure or the sole source of a fact |
| `--text-disabled` | `#41485A` | 2.1 : 1 | Disabled controls only (WCAG-exempt) |

### Borders
| Token | Value | Use |
|---|---|---|
| `--border` | `#1B2133` | Normal border |
| `--border-strong` | `#2A3248` | Strong border, focus rings, active states |

### Brand gradient & accents
| Token | Value | Contrast on `--surface` |
|---|---|---|
| `--accent-pink` | `#E84CFF` | 6.2 : 1 |
| `--accent-purple` | `#7C3CFF` | 3.5 : 1 — large text only |
| `--accent-blue` | `#267BFF` | 4.8 : 1 |
| `--accent-cyan` | `#17D9FF` | 11.1 : 1 |
| `--brand-gradient` | `linear-gradient(135deg, #E84CFF, #7C3CFF, #267BFF, #17D9FF)` | — |

### Status
Always paired with an icon **and** a text label — colour is never the only signal.

| Token | Value | Contrast on `--surface` | Meaning |
|---|---|---|---|
| `--success` | `#3DDA9A` | 10.5 : 1 | 🟢 healthy |
| `--warning` | `#FFBE55` | 11.4 : 1 | 🟡 watch |
| `--danger` | `#FF667A` | 6.7 : 1 | 🔴 problem, negative money |
| `--info` | `#4A9AFF` `TODO(verify)` | — | informational (hex partly obscured in the guideline — confirm) |

## Accessibility rules that follow from these values

1. **`--text-muted` (`#687087`) must not carry normal body text.** At 3.8:1 it fails WCAG AA. Anything a user has to read — every BDT figure, every metric, every finding — uses `--text` or `--text-secondary`.
2. **White text does not pass AA on the bright half of the gradient.** Measured against `#F7F8FC`: Neon Pink 2.9:1, Cyan ~1.6:1, Electric Blue 3.7:1, Electric Purple 4.0:1. A primary button with white 16px text on a pink→purple gradient is **not AA-compliant**. **Decision (implemented in `src/components/ui/button.tsx`, tokens in `globals.css`):** the primary action uses the **blue → cyan** slice of the gradient (`--action-gradient`) with **near-black text** (`--on-action`, = `--bg`): 5.6:1 on blue and 12.5:1 on cyan, so it passes AA at normal size. The full four-colour `--brand-gradient` is reserved for the wordmark, large headings and decorative surfaces — never behind body-size text.
3. **Radius / spacing / shadows are inferred, not specified:** ~8px on inputs and buttons, ~12px on cards, full-round on pills, soft outer glow on primary actions. Marked inferred until the founder confirms.

## Typography — PENDING

No fonts, weights, size scale or numeral style are specified in the guideline. Until they arrive:
- Use a neutral system stack. Do not choose a display font and call it the brand.
- **The `bn` locale is blocked on this.** Bangla needs a real Bengali face (Hind Siliguri or Noto Sans Bengali) paired with the Latin UI font; system fallbacks render Bangla badly. This is a Phase 0 blocker for `bn` UI review, not for `bn` string extraction.
- Numerals: Latin by default, Bangla digits when locale is `bn`, via the shared formatter — a typography choice only insofar as the chosen face must have Bangla digits.

## Logo — PENDING usage rules

`Brand_assets/logo.png`: knife and fork crossed into an X under a chef's hat, above a plate, in the brand gradient on near-black.
- Raster, dark-background only. **Do not place it on a light surface** until a light variant exists.
- Still needed: SVG, favicon/app-icon set, clear space, minimum size, and a 1-bit monochrome variant for 58/80mm thermal receipts.

## Surface personalities

| Surface | Treatment |
|---|---|
| **POS** | Dark palette, big touch targets, maximum contrast. **Verify legibility on a real 10" Android tablet in daylight before Phase 1 closes** — neon on near-black is the risk case here, and may need a high-brightness variant |
| **KDS** | Dark, readable at 2m. Status colour + icon + label; ticket age drives `--warning` → `--danger` |
| **Dashboard** | Calm and data-dense. Gradient used sparingly — primary action and brand mark only |
| **Receipts / KOT** | **Brand does not apply.** Pure black on white, 58/80mm, no gradient, no colour |
| **WhatsApp brief** | Plain text. No colour; emoji carry status per the fixed rules below |

## Fixed semantic rules (keep after branding)

- 🟢 / 🟡 / 🔴 statuses always pair colour with an icon and a text label.
- Money: ৳ prefix, lakh grouping (1,23,456); negative values use `--danger` and a minus sign.
- Findings show ৳ impact first, then evidence, then actions.
- **The gradient and the "AI Generated" badge mark narrative, drafts and suggested actions — never a number.** A figure is rendered in plain text tokens because it came from a metric function, not a model. The badge is the draft→approve affordance, not decoration. (The guideline's own "AI Insight" card pairs the badge with a percentage; Xedine does not copy that.)
