# ADR 0006 — Test-oracle clock and Phase 0 schema scope

- Date: 2026-09-22
- Status: accepted

## Context
Two problems with the test oracle as written in ROADMAP.md:

1. The seed generates "365 days of orders **ending yesterday**", while Phase 2+ golden tests assert **exact** values from `supabase/seed/manifest.json`. Data that shifts daily and assertions that don't are incompatible — CI would rot overnight, and rolling windows like `last_2h` would be untestable.
2. Phase 0's "Done when" requires the manifest to validate, but scenarios **S4–S9** involve recipes, purchases, stock counts, waste and transfers — tables that don't exist until Phase 3 and Phase 5. As written, Phase 0 cannot pass its own gate.

## Decision

**Clock: fixed anchor date.**
- `supabase/seed/manifest.json` carries an `anchor_date`. The seed generates the 365 days **ending on the anchor**, not on today.
- Initial anchor: **2026-09-21**.
- Tests freeze "now" to `anchor_date 23:30 Asia/Dhaka` (a point inside the last business day) so `last_2h`, `today` and `week_to_date` are all deterministic and non-empty.
- The clock is injected — every metric function and job takes a `now` parameter or reads a single `clock` module. **No `now()` / `new Date()` in business logic**; a lint rule enforces this. This is also what makes business-day cutoff behaviour testable at 00:00 and 04:00.
- Re-anchoring is a deliberate act: bump `anchor_date`, regenerate, regenerate expected values, commit. Not automatic.

**Schema: full core schema in Phase 0; seed data grows per phase.**
- Phase 0 migrates the core tables from ARCHITECTURE.md's entity list, so **RLS policies, helper functions and the isolation suite are written once and cover every table** rather than being revisited in P3 and P5.
- The generator only produces data for scenarios a phase can actually detect. Each manifest scenario carries `available_from_phase`.
- The manifest validator checks only scenarios at or below the current phase, read from a single `SEED_PHASE` setting. Phase 0 validates **S1, S2, S3 (commission component), S13**; the rest are present-but-pending and reported as such rather than failing.

## Alternatives considered
- **Relative-to-today seed** — demos always look live, but golden tests would have to recompute expectations from the generator, which means the test and the code under test share a source of truth. That is a much weaker oracle, and the whole point of the manifest is independence.
- **Both modes (`--anchor` flag)** — genuinely useful for sales demos later, and still possible to add. Not worth the generator complexity in Phase 0.
- **Phase 0 builds only what P1–P2 need** — smallest honest Phase 0, but reopens the RLS suite and the generator twice, and designs the recipe/inventory schema in a phase already under pressure.
- **Phase 0 builds full schema *and* full seed** — one seed to maintain, but balloons Phase 0 well past two weeks and designs inventory semantics before anything consumes them.

## Consequences
- Easier: CI assertions stay valid indefinitely; tenancy correctness is proven across the whole schema in the phase dedicated to it; later phases add generator logic without touching migrations or RLS.
- Harder: demo data ages — by Phase 10 the demo org's "today" is roughly a year stale. Accept it for tests; add a `--anchor=today` demo mode before the first sales demo.
- Phase 0 is at the **top of its 1–2 week estimate**, since it migrates tables that nothing yet reads.
- Empty tables still need RLS tests. An isolation test against a table with no rows proves nothing — the Phase 0 suite must insert fixture rows per table as org A and assert org B sees zero.
- **ROADMAP amended** so Phase 0's "Done when" reads "manifest validates for phase-0 scenarios".
