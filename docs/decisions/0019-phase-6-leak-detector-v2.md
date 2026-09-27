# ADR 0019 — Phase 6 Leak Detector v2

- Date: 2026-10-02
- Status: accepted (built unattended — **§2 and §4 are choices the founder should confirm**)

## Context
Phase 6 must explain the food-cost gap in ৳ by cause, branch and item, and recover S6–S9 from the seeded stock ledger (ADR 0018) within ±10%, without false positives on the clean café. METRICS.md defines the variance bridge and Price Watch but leaves open what "standard cost" is, how to tell a leak from normal loss, and how to avoid flagging a market-wide price rise (open question 7).

## Decision
1. **The bridge is an identity.** Per branch between two counts, with s = the ingredient's unit cost on the opening count day ("standard") and p = the weighted price actually paid in the period (s if nothing was bought): TFC = theoretical × s; waste = logged waste × s; unexplained = variance.qty × s; price effect = actual usage × (p − s); cogs.actual = actual usage × p. So cogs.actual − TFC = waste + price effect + unexplained, exactly. Components are rounded once per branch and cogs.actual is shown as their sum, so the bridge always adds up on screen. The count-uncertainty band (±1% of counted value, configurable) is shown beside it. This resolves METRICS.md open question 1: `variance.qty` is *unexplained* usage.
2. **A leak is usage beyond what normal branches lose.** `usage.unexplained` fires when unexplained usage is ≥ 5% of what recipes say (the "problem" band) and exceeds the band. Its ৳ impact is only the excess over a baseline: the pooled rate of the org's *other* branches whose own rate is normal (clamped to 0–5%), or a 2% allowance for a single-branch org. *Confirm: impact is "beyond normal", not the whole gap — it is smaller but defensible, and it is what recovers S7/S9 within tolerance.*
3. **We name suspects, not a cause.** From counts alone over-portioning and unlogged waste look the same, so there is one finding type with evidence that points: the dishes using the ingredient with their share, the quantity that went into dishes voided after the KOT, and POS-exception findings at the same branch in the period (theft hints). Suggested actions cover all three.
4. **Mirrored gaps are a transfer.** When one branch is ≥ 5% over and another ≥ 5% under on the same ingredient and the smaller gap is at least half the larger, one `transfer.suspected` finding is raised on the losing branch (impact = the average of both excesses) and the over-use finding is suppressed. *Confirm the 50% match rule.*
5. **Price Watch needs two witnesses.** A purchase line is flagged only when its unit price is > 8% above both the branch's own 28-day median (≥ 3 prior purchases) and the market that day — the other branches' same-day median, or an imported reference price from the week before. A market-wide rise (every branch pays more) stays quiet; a lone branch with no reference is never flagged. Impact = paid above the market price. Owners import reference prices as CSV.
6. **Transfer hygiene.** Transfers not confirmed a day after sending, and transfers that arrived short, are findings on the receiving branch (if above the ৳ floor).
7. **Periods align to counts.** Stock detectors report the count-to-count period they used; scans use the four weeks to the org's latest count, so re-running in the same week updates the same finding. The day-close job runs them on the count weekday.
8. **Flash P&L uses recipe costs where they exist** (METRICS.md): COGS = recipe cost of costed lines + the assumed % of the rest, labelled recipes / mixed / assumed. With no recipes it equals Phase 2's figure.
9. **Explain this.** The evidence page carries the owner's actions (≤ 3 clicks from the dashboard) and an "Ask the assistant" link; `explain_finding` answers deterministically even without an AI key.
10. **Resolution tracking.** Resolved findings have their own tab; a finding that recurs after being resolved is badged "came back", and a resolved one with newer occurrences "still happening".

## Alternatives considered
- **Whole gap as impact** — simpler, but overstates the leak by normal loss and misses ±10% on S7/S9.
- **Weekly regression to separate over-portioning from waste** — four weekly points are too few to tell.
- **Own-history price drift alone** — fires on every market move (METRICS.md open question 7).

## Consequences
- Every Phase 6 figure is SQL; CI's golden script checks S6–S9 and the clean café on the full seed (SEED_PHASE=6).
- **Revisit** the 5% / 8% / 50% thresholds with pilot data.
