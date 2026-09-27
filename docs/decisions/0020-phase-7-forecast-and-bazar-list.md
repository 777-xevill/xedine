# ADR 0020 — Phase 7 forecasting and the bazar list

- Date: 2026-10-03
- Status: accepted (built unattended — **§2 and §6 are choices the founder should confirm**)

## Context
Phase 7 must forecast per item × daypart × branch, track WAPE against the naive "same weekday last week" and hide the model when it is not ≥ 10% better (METRICS.md), turn the forecast into a prep plan in cooking units, and draft tomorrow's bazar list for approval and sending. The ROADMAP lists an ML forecasting service as "later"; Bangladesh's calendar (Ramadan, Eid closures, salary week, rain, hartal) drives demand.

## Decision
1. **Forecast v1 is SQL, not ML.** Weighted average of the same weekday over the last four weeks (weights 4, 3, 2, 1), using only comparable reference days: not closed, not flagged, and the same Ramadan status as the target (so Ramadan forecasts come from Ramadan days and carry the iftar shift). References are normalised for salary week and the target re-scaled by it; flagged target days are scaled by what that kind of day did before. A closed day forecasts zero; with no comparable reference (the first days of Ramadan) the naive value is used.
2. **Calendar effects are learned, not typed in.** Salary-week factor = average units on salary-week days ÷ other normal days (last 84 days, outside Ramadan). A flag's factor (rain, hartal, cricket, holiday…) = units on past flagged days ÷ their baseline (same weekday 1–4 weeks earlier), needing two such days, clamped 0.3–2.0. The owner marks closed days (Eid closure); managers may flag rain, hartal or cricket for yesterday, today or tomorrow (`flag_day`); everything else on the calendar is the owner's. *Confirm that managers may flag days.*
3. **WAPE decides what is shown.** `m_forecast_accuracy` backtests the last 28 days (each day forecast only from days before it) per branch; the model is shown only while its WAPE is ≤ 90% of naive's, else the plan uses "same weekday last week" and says so. Measured at item × daypart × day, which is noisy — the level the kitchen plans at.
4. **Prep plan in cooking units.** Recipes may carry `batch_portions` and `batch_unit` (a deg of kacchi feeds 40): the plan shows batches, portions and the two heaviest ingredients (what to marinate or soak).
5. **The bazar list.** Draft = forecast usage over the ingredient's `bazar_days` + safety stock − stock expected at the end of today (theoretical stock now − the unsold part of today's forecast) − goods on the way, scaled by the tuning, rounded up to the purchase pack, with the supplier last bought from. Never counted = no stock (the line says so).
6. **Approve → send → reconcile.** Owner or manager approves (edits allowed; 0 drops a line). Each edit teaches `bazar_tuning`: adjust ← 0.7 × adjust + 0.3 × (approved ÷ suggested − 1), clamped ±50%. Sending composes one WhatsApp message per supplier with a phone (their lines) and optionally one to the purchaser (the whole list), queued in the messaging outbox (templates await Meta approval, ADR 0010). Reconcile compares approved quantities with purchases entered for the day or the day before. *Confirm that suppliers may be messaged directly once templates are approved (a person approves every send, CLAUDE.md #4).*
7. **The day close stores tomorrow's forecast** and the accuracy rows (history for briefs); screens compute on demand.

## Alternatives considered
- **Exponential smoothing / an ML service** — better eventually, but needs a second runtime; v1 is transparent and testable.
- **Hand-entered calendar multipliers** — would let the demo "cheat"; learning them keeps the oracle honest.

## Consequences
- Seed: Eid closures marked closed, rain days flagged, degs on the biryani recipes, bazar days and packs on ingredients; S10 planted with its facts; CI checks it at SEED_PHASE=7.
- Local run on the seed (Jan–Mar): the Ramadan forecast puts 21.1% of units at iftar (actual 22.8%); WAPE in late Ramadan 64.5% vs naive 72.7%; in early Ramadan the model is not better, so it would be hidden.
- **Revisit** with pilot data: the weights, the 28-day window and the tuning rate.
