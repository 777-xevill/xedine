# ADR 0009 — Brand tokens: adopt colour now, defer typography

- Date: 2026-09-22
- Status: accepted

## Context
CLAUDE.md non-negotiable #9 said to use neutral design tokens until BRAND.md reads READY, so that rebranding is a token swap. But `Brand_assets/` already held a finished colour guideline (`brand_guidline.png`) and a logo (`logo.png`), so Phase 0 would have built the app shell on neutral tokens and then immediately re-themed it.

The guideline supplies a complete **dark-mode** colour system: near-black backgrounds (`#05060A` → `#12182A`), a pink→purple→blue→cyan brand gradient at 135°, four accent colours, four text tiers, two border tiers, and four status colours. It supplies **no typography, no spacing or radius scale, no light mode, and no logo usage rules.**

## Decision
**BRAND.md status becomes `READY (colour & surfaces) · PENDING (typography, logo usage, light mode)`.** Phase 0 builds on the real colour tokens; type stays on a system stack.

- All brand colours are defined as CSS variables on `:root`. No hex literals in components — rebranding stays a token swap.
- **Dark is the default and only theme for Phase 0.** The guideline is dark-only; a light theme would be invented, not branded.
- **Typography stays on a neutral system stack** until the founder supplies the guideline's type section. BRAND.md's requirement for a Bangla-capable pairing (Hind Siliguri / Noto Sans Bengali alongside a Latin UI font) is unmet and is a **Phase 0 blocker for the `bn` locale** — Bangla in a Latin-only fallback font renders badly.
- Radius, spacing and shadow scales are inferred from the guideline's UI preview (~8–12px radius on cards and inputs, pill badges) and recorded in BRAND.md as inferred, not specified.
- `logo.png` is a dark-background raster. An SVG and a favicon/app-icon set are still needed; it must not be placed on a light surface until a light-background variant exists.

## Two findings that change how the tokens get used

1. **`#687087` "Muted Text" fails WCAG AA for body text.** On the `#0D1120` card background it measures **3.8:1** (AA needs 4.5:1 for normal text, 3:1 for large). Muted text is therefore restricted to labels ≥18.66px bold / ≥24px, or metadata that is not the only source of a fact. Anything a user must read — including every ৳ figure — uses `#F7F8FC` (primary) or `#A7ADBF` (secondary). All status colours pass comfortably (success 10.5:1, error 6.7:1, cyan 11.1:1).
2. **The guideline's "AI Insight" card pairs the AI badge with a percentage.** That visual pattern contradicts non-negotiable #1. The rule for Xedine: **the gradient and the "AI Generated" badge mark narrative, drafts and suggested actions — never a number.** A ৳ figure or a percentage is rendered in plain text tokens because it came from a metric function. The badge is the draft→approve affordance, not decoration.

## Alternatives considered
- **Keep neutral tokens through Phase 0** — what the docs originally said, and safer if the guideline were still in flux. Rejected: the guideline is finished for colour, so this would mean building a UI twice.
- **Treat the guideline as fully READY** — rejected because inventing a type scale and a light mode and calling them "the brand" is worse than leaving them marked pending.

## Consequences
- Easier: Phase 0's app shell looks like Xedine from the first screenshot; no re-theming pass later.
- Harder, and needing attention in Phase 1:
  - **A neon-on-near-black POS is a legibility risk on a cheap Android tablet in a bright dining room at midday.** BRAND.md's own screen personalities call for POS "big touch targets, high contrast". The KDS wants dark (readable at 2m) and gets it for free; the POS may need a high-brightness variant of the dark palette. Test on real hardware in daylight before Phase 1 closes.
  - **Thermal receipts and KOTs are monochrome 58/80mm.** The brand does not apply. Receipt templates use pure black on white with no gradient, and the logo needs a 1-bit variant or none.
  - Dark-only means no `prefers-color-scheme: light` support. Record it as a deliberate gap so nobody "fixes" it by inventing colours.
- **Revisit** when the founder supplies typography (unblocks the `bn` locale properly), an SVG logo, and a light-surface logo variant.
