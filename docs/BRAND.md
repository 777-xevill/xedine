# Brand — STATUS: READY (colour & surfaces, light theme) · PENDING (typography, logo usage)

Source: `Brand_assets/brand_guidline.png`, `Brand_assets/logo.png`. Decisions: [ADR 0009](decisions/0009-brand-tokens.md), [ADR 0024](decisions/0024-light-workspace-redesign.md) (light theme).

**What you may use now:** every colour below, as CSS variables. **What is still pending:** typography (no fonts specified — and the `bn` locale needs a Bangla face), logo usage rules and an SVG/favicon set.

**Never hardcode a hex value in a component.** All colour reaches the UI through CSS variables on `:root`, so rebranding stays a token swap.

## Theme

**Light is the only theme (ADR 0024 — the founder asked for a clean, light UI with no black background).** The guideline's colours below are kept verbatim as raw `--palette-*` / accent / status tokens in `globals.css`, and the light theme maps onto them:

| Semantic token | Light value | From the guideline |
|---|---|---|
| `--bg` | `#F7F8FC` | "Primary text" mist, used as the page |
| `--surface` | white | — (cards, sheets, inputs) |
| `--surface-elevated` | white + 14% slate | hover / selected fills, stat tiles |
| `--text` | `#0D1120` (17.9 : 1 on white) | "Card background" navy, used as text |
| `--text-secondary` | `#41485A` (9.3 : 1) | "Disabled text" slate |
| `--text-muted` | `#687087` (4.9 : 1 — passes AA on white) | "Muted text" slate |
| `--border` / `--border-strong` | slate `#A7ADBF` mixed into white (32% / 58%) | — |

**Ink variants.** The accent and status colours are bright by design (made for a dark page) and fail AA as text on white. The Tailwind colour utilities therefore resolve to *ink* variants — each brand colour mixed with the guideline navy (success 50%, warning 52%, danger 62%, info 70%, cyan 55%, blue 82%, pink 72%), all ≥ 4.5 : 1 on white. The bright originals stay reachable as `*-bright` for dots, bars and fills. Purple `#7C3CFF` (5.6 : 1 on white) is the interactive accent as-is.

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

1. **`--text-muted` (`#687087`) is for labels and metadata.** On the light theme it passes AA (4.9 : 1 on white, 4.6 : 1 on `--bg`), but every BDT figure, metric and finding still uses `--text` (figures) or `--text-secondary` (body).
2. **White text does not pass AA on the bright half of the gradient** (pink 3.2:1, cyan ~1.4:1, blue 4.0:1 against white). **Decision (ADR 0024, `src/components/ui/button.tsx`, tokens in `globals.css`):** the primary action is **purple → deepened blue** (`--action-gradient`: `#7C3CFF` → blue mixed 30% with navy) with **white text** (`--on-action`): 5.6 : 1 and 6.4 : 1, so it passes AA at body size. The full four-colour `--brand-gradient` is reserved for the logo tile, the assistant composer's halo and decorative glow — never behind body-size text or a figure.
3. **Radius / spacing / shadows are inferred, not specified:** 12px inputs, 20px cards, 24px sheets, full-round pills; soft navy shadows on white cards; a purple glow on the primary action. Marked inferred until the founder confirms.

## Typography — PENDING

No fonts, weights, size scale or numeral style are specified in the guideline. Until they arrive:
- Use a neutral system stack. Do not choose a display font and call it the brand.
- **The `bn` locale is blocked on this.** Bangla needs a real Bengali face (Hind Siliguri or Noto Sans Bengali) paired with the Latin UI font; system fallbacks render Bangla badly. This is a Phase 0 blocker for `bn` UI review, not for `bn` string extraction.
- Numerals: Latin by default, Bangla digits when locale is `bn`, via the shared formatter — a typography choice only insofar as the chosen face must have Bangla digits.

## Logo — PENDING usage rules

`Brand_assets/logo.png`: knife and fork crossed into an X under a chef's hat, above a plate, in the brand gradient on near-black.
- Raster, dark-background only. On the light UI it always sits in **its own rounded app-icon tile** (`src/components/brand-mark.tsx`), never directly on a light surface. The wordmark next to it is navy text.
- Still needed: SVG, favicon/app-icon set, clear space, minimum size, and a 1-bit monochrome variant for 58/80mm thermal receipts.

## Surface personalities

| Surface | Treatment |
|---|---|
| **POS** | Light palette with solid (unblurred) surfaces, big touch targets, maximum contrast — better in a bright dining room than the old neon-on-black. Still verify on a real 10" Android tablet |
| **KDS** | Light, solid surfaces, readable at 2m. Status colour + icon + label; ticket age drives warning → danger |
| **Dashboard** | Sidebar + one workspace (ADR 0024). Calm, few charts; home answers "how are we doing" and "what needs attention". Gradient only on the primary action, the logo tile and the assistant composer |
| **Receipts / KOT** | **Brand does not apply.** Pure black on white, 58/80mm, no gradient, no colour |
| **WhatsApp brief** | Plain text. No colour; emoji carry status per the fixed rules below |

## Fixed semantic rules (keep after branding)

- 🟢 / 🟡 / 🔴 statuses always pair colour with an icon and a text label.
- Money: ৳ prefix, lakh grouping (1,23,456); negative values use `--danger` and a minus sign.
- Findings show ৳ impact first, then evidence, then actions.
- **The gradient and the "AI Generated" badge mark narrative, drafts and suggested actions — never a number.** A figure is rendered in plain text tokens because it came from a metric function, not a model. The badge is the draft→approve affordance, not decoration. (The guideline's own "AI Insight" card pairs the badge with a percentage; Xedine does not copy that.)
