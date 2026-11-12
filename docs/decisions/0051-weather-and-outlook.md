# ADR 0051 — Weather and the outlook on the Plan page

- Date: 2026-11-13
- Status: accepted (built at the founder's request — **§2, §4 and §6 are choices the founder should confirm**)

## Context
The founder found the Plan page hard for a beginner (a table of item × daypart decimals, ISO dates, a WAPE sentence) and asked for a "real-time" forecast that reads the weather per location and knows festivals and programmes, and that tells the owner what is coming in the next hours, tomorrow and the week. The forecast already learns what a flagged day does to sales (ADR 0020 §2): rain is the `weather` flag, but someone had to press "Rain". Zero budget.

## Decision
1. **Weather source: MET Norway Locationforecast 2.0 (compact)**, free with no key and allowed for commercial use under CC BY 4.0 (the page credits "Weather data: MET Norway"; every request names the client in `User-Agent`, as their terms ask). Google's Weather API is paid; Open-Meteo's free tier is non-commercial. Hourly for about 2½ days, six-hourly up to 9 days.
2. **Where a branch is.** `branches.latitude/longitude` (new, nullable). The owner sets it on the Branch page — "Use this phone's location" or numbers from Google Maps — through `set_branch_location` (owner only, audited, both or neither). Until then the weather follows the branch's area, then its city, from a table of place centres, else Dhaka. *Confirm: area-level weather is good enough until an owner sets the spot.*
3. **The weather job** (`weather`, pg_cron every 3 hours at :20) fetches once per place rounded to ~1 km, upserts `weather_hours` (branch-scoped, read by everyone at the branch, written only by the job), and keeps two weeks.
4. **Rain moves the forecast by itself.** A business day with ≥ 5 mm of rain forecast at any of the org's branches (today…+7) gets a `weather` calendar event with source `weather forecast`; when the forecast changes, those automatic events are removed again. Events a person added are never touched. The forecast then scales that day by what rainy days did before — the same learned factor as before, no new model and no number invented. Calendar events stay org-wide (as in ADR 0020), so a multi-city chain flags a day if any branch expects rain. *Confirm the 5 mm threshold (TODO(verify) in `outlook.ts`).*
5. **The Bangladesh calendar is added for the owner.** National days and religious festivals for the next ~4 months (`BD_CALENDAR`, every date TODO(verify); the lunar ones are estimates) are inserted into each org's calendar with source `bd calendar (estimate)`, once each — `org_job_marks` remembers, so one the owner deletes is not added back. Local events (a concert, a mela, a match nearby) have no free reliable source: the owner adds them on the Calendar page or flags hartal/cricket on the Plan page.
6. **Telling the owner.** (a) "Rain soon": when ≥ 1 mm/hour is forecast at a branch within the next 6 hours, the owner gets one message per branch per business day (Telegram now, WhatsApp through the outbox), with when, how much, and a plain tip; `notifyOwnerOnce` claims the key in `org_job_marks` before sending, so a job that runs twice never sends twice. (b) The morning brief adds today's weather and the next 7 days' rain and calendar days; the evening close adds tomorrow's. These are notifications to the owner about the owner's business, like the briefs — not autonomous sends to customers. *Confirm the rain-soon alert is wanted (it can be noisy in monsoon).*
7. **The page.** A 7-day strip (weather icon, top temperature, rain in mm, holidays) that doubles as the day picker, "next hours" for today, and the forecast as one sentence ("Tomorrow: about 412 dishes", same day last week beside it) with "Counted in: Eid, Rain, salary week" and a plain list of dishes; the daypart table and the accuracy explanation are folded away. Tabs read "What will sell / What to cook / What to buy".

## Alternatives considered
- **Google Weather API / AccuWeather** — paid.
- **Open-Meteo** — better probabilities, but the free API is non-commercial.
- **Per-branch calendar events** — more exact for chains in different cities, but every forecast function reads org-wide flags; left for when a chain needs it.
- **Fetching weather on page load** — slower pages, and alerts need a job anyway.

## Consequences
- New tables `weather_hours`, `org_job_marks`; columns `branches.latitude/longitude`; RPC `set_branch_location`; job `weather`.
- The forecast shows a rainy day differently from before only through the learned rain factor; with fewer than two past rainy days it is unchanged (ADR 0020 §2).
- **Revisit:** the 5 mm and 1 mm/hour thresholds with pilot data; the calendar list every year.
