# ADR 0058 — Posters without limits, dishes by sales or the owner's marks, a cleaner Growth page

Date: 2026-11-15 · Status: accepted · Amends: 0040, 0057

## Context
ADR 0057 gave the autopilot ten fixed designs modelled on the founder's eight reference posters. The founder:
the references were examples, not templates — "styles are limited, I want different types of design, not
limited". Also: the owner must be able to mark which dishes go out, or the autopilot should pick by sales;
and the Growth page must be easier to understand.

## Decision
1. **A poster is a look, not a design.** `look.ts` puts every poster together from independent parts:
   22 layouts (the ten of ADR 0057 plus stack, corner, halo, magazine cover, side panel, speech bubble,
   ticket, comic burst, polaroid, vintage bill, chalkboard, collage), 8 colour schemes worked out from the
   restaurant's two colours with contrast checks, 15 display faces each paired with a Bangla face
   (Galada, Atma, Tiro Bangla added), 14 backgrounds, 8 dish treatments, 9 decoration sets, 5 headline
   effects, mirroring and a seed. Each layout lists the parts that suit it; the tone weights the choice.
   A look is deterministic (same look → same poster), so preview and render agree.
2. **"More designs" never ends.** Growth shows six looks at a time; each page shows layouts the earlier pages
   did not, then they return in new colours, type and backgrounds. The chosen look travels with the post
   (`social_posts.design_spec`, checked by `LookSchema` in the action and the job; `template` keeps the
   layout name, any name now).
3. **The autopilot** takes a fresh look per post whose layout its last three posts did not use. The
   owner's fixed design list (`social_settings.designs`) is no longer read.
4. **Which dish:** `mark_social_dish` (owner or manager, audited) marks a dish *post*, *never* or *auto*.
   Marked dishes → only those, taking turns. None marked → the five best sellers by units over the last
   30 days (`items.qty_sold`, `metric_item_qty` last_30d), taking turns, then the rest of the menu as
   fallbacks if photos fail. No sales → the whole menu in turn. The "best seller" story and badge are used
   only for a dish in that top five.
5. **Growth** is one status line (autopilot, accounts, next dish and why) and four tabs: Make a post ·
   Dishes (sales, best-seller and next badges, the three marks) · Coming up · Posted. The never list and
   the design checkboxes left Settings → Social.

## Consequences
- Thousands of combinations at no cost; all still pure HTML/CSS rendered by Chromium.
- Quality is held by per-layout allowed parts and contrast maths, checked on contact sheets
  (`pnpm social:preview posters … --every`).
- `social_settings.designs` is dead and can be dropped in a later migration.
