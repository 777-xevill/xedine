# Xedine — Product Spec

## One line
Xedine is the system a Bangladeshi restaurant owner opens to see today's profit, where money is leaking (with proof in taka), and what to do next — built on a POS that captures every order.

## Who it's for
- Single-branch restaurants (most of the market) and multi-branch chains (best early customers: they feel branch variance and have staff to maintain inputs).
- Any format: kacchi/biryani houses, rice & curry (bhaater hotel), kabab/grill, fast food/burger, pizza, cafés, Chinese/Thai, bakery/sweets, cloud kitchens, fine dining.

## Roles
Owner · Branch manager · Cashier · Kitchen · Purchaser (bazar) · Accountant (read-only) · Xedine platform admin (no tenant data access by default).

## Product principles
1. **Capture at the order, not after payment.** Every sale has items, time, channel, staff, payment method.
2. **Deterministic numbers, AI explanations.** AI never computes money; it explains findings produced by the analytics engine.
3. **Evidence or silence.** Every insight carries ৳ impact, period, evidence rows, confidence, and 1–3 suggested actions.
4. **Draft → approve.** AI drafts, humans approve ("assistant mode"). Per-task "agent mode" only later, after trust.
5. **Minimal input.** Ask for the fewest inputs that unlock the most value; measure input discipline per branch.
6. **WhatsApp-first for owners**, web for depth, Bangla-first for staff screens.
7. **Restraint.** Max 3 proactive insights per owner per day; snooze/dismiss teaches the system.
8. **Works on bad days.** Offline POS, cheap Android tablets, 58/80 mm thermal printers.

## Modules (IDs referenced by ROADMAP)
**M1 POS & Orders** — menu (categories, items, variants, modifiers, branch prices, availability/86), dine-in with tables, takeaway, delivery channels (own, foodpanda, Pathao Food, custom) with commission settings; order status separate from payment status; discounts with reason codes; voids/refunds with reason + manager PIN after KOT; split payments (cash, card, bKash, Nagad, Rocket, Upay, bank); shifts with opening float, cash count, over/short; receipt + KOT printing; VAT/service-charge config; invoice data ready for Mushak 6.3 (TODO verify); optional customer phone/name with consent; offline mode; optional QR table ordering.

**M2 Kitchen Display** — realtime queue (oldest first), two-tap status (preparing → ready), ticket timers, station filters, waste button, timestamps on every status change (feeds service-speed analytics).

**M3 Health Monitor & Flash P&L** — live today view: sales, orders, AOV, covers, channel mix, estimated profit, "৳X more sales needed to break even today", red/amber/green per branch.

**M4 Item Velocity & Sales Explorer** — "How many kebabs sold in the last 2 hours / today / last week / this month?" by item, branch, channel, daypart; best/worst sellers; slow movers.

**M5 Recipes & Menu Profit Intelligence** — ingredients, units & conversions, recipes & sub-recipes, yields; AI drafts recipes from a menu photo/list for the chef to correct; recipe cost auto-updates with purchase prices; menu engineering (Star / Plowhorse / Puzzle / Dog); margin alerts when ingredient prices jump; price & portion simulator.

**M6 Purchasing (Bazar)** — suppliers; purchase entry by form, photo of chit/receipt, or voice note → AI draft lines → human confirm; price history; Purchase Price Watch (vs own history, vs other branches same day, vs reference prices).

**M7 Inventory & Waste** — guided weekly count of the 10–15 costliest items (full count optional); waste log with reasons (KDS button + mobile) and leaderboard; transfers branch↔branch and central kitchen→branch with receive confirmation; theoretical stock; days of cover 🟢 ≥7 · 🟡 3–6 · 🔴 <3 (configurable, shorter for perishables); branch discipline score.

**M8 Leak Detector — "Where am I losing money?"**
- Zero-input leaks (POS data only): void/discount/refund anomalies by cashier/shift, manual price overrides, cash-share drift, cash over/short, delivery-commission drag, negative-margin items.
- Input-dependent leaks: food-cost variance bridge (logged waste, purchase-price drift, unexplained usage = over-portioning/theft/unrecorded), over-portioning suspects by item × branch, phantom variance from unrecorded transfers, supplier price creep.
- Ranked by ৳ impact × confidence; always with evidence.

**M9 Demand Forecast & Bazar List** — item × daypart × branch forecasts with a Bangladesh calendar (Ramadan/iftar/sehri, Eid, Pohela Boishakh, national holidays, salary week, weekend, rain, hartal, big cricket matches); accuracy tracked vs a naive baseline and hidden if it doesn't beat it; prep plan in cooking units (e.g., pots of kacchi); tomorrow's bazar list = forecast usage − stock + safety stock, grouped by supplier → owner approves → sent on WhatsApp.

**M10 AI Owner Assistant** — chat on web and WhatsApp in Bangla, Banglish or English; answers only from metric tools; morning brief (09:00), evening close (23:00), weekly review; proactive insight feed that challenges the owner with evidence (e.g., "Mirpur's beef usage is 11% above recipe for 3 weeks — ৳18,400 this month. Check portioning or receiving."); remembers owner-stated context (goals, rules, constraints); understands the business profile (cuisine, format, price band, branches).

**M11 Customers & Retention** — profiles by phone (+880), consent (transactional/marketing), visit history; post-meal feedback link (rating 0–10 + comment) sent after payment (replaces asking at the counter); RFM segments; at-risk detection; automations (thank-you + second-visit nudge within 48 h for first-timers, win-back); frequency caps; holdout groups to measure real lift.

**M12 Reviews → Operations** — Google reviews (Business Profile API, needs access approval), own feedback, pasted Facebook/foodpanda reviews (Meta removed third-party Groups API access in April 2024); themes; AI reply drafts; joins complaints with KDS ticket times, staffing and items ("slow service" → Friday 20–22 tickets 2× slower).

**M13 Branch Intelligence** — league table, like-for-like comparisons, manager scorecards, transfer audit, "gap to best branch" in ৳.

**M14 Industry Benchmarking** — opt-in, anonymised comparison of food cost %, labour %, GP %, sales per branch per day, AOV, rating, repeat rate, waste %, delivery share against peers by segment (cuisine, format, branch band, city/area, AOV band); percentiles only; minimum 5 restaurants per segment; "industry reference" ranges clearly labelled until enough peers exist.

**M15 Compliance Tracker** — licences (trade, fire, BFSA, environment, others — configurable), expiry reminders 60/30/7 days, VAT deadline reminders, sales-VAT summary export (TODO verify rules).

**M16 Staff (lite)** — staff list, monthly salary & allowances, advances ledger, basic attendance, sales per staff. No AI shift scheduling (monthly salaries make it low value).

**M17 Growth / Social (optional)** — content ideas grounded in sales data (push Stars, fix weak dayparts), hooks, shot list & camera angles, captions (bn/en), posting calendar, Google Business Profile checklist. No auto-posting in MVP.

**M18 Platform** — onboarding wizard (target: live in < 2 hours), plans & usage caps, billing, admin console, data export.

## Bangladesh context (design constraints)
- Currency ৳ (BDT), lakh/crore grouping, optional Bangla digits. Timezone Asia/Dhaka (UTC+6, no DST).
- Weekend Friday–Saturday; week start configurable (default Saturday). Thursday night/Friday are often peaks — verify per restaurant.
- Dayparts (defaults, editable): breakfast 06–11, lunch 11–16, snacks 16–19, dinner 19–23, late 23–04. Ramadan mode: iftar ≈16:00–19:30, dinner, sehri ≈01:00–04:00.
- Purchasing is mostly cash at the bazar with handwritten chits; prices swing week to week. AI-extracted purchases always need human confirmation.
- Staff are mostly monthly salaried (often with meals). Food cost and leakage matter more than labour scheduling.
- Payments: cash dominant; bKash/Nagad common; cards in higher-end places.
- Delivery platforms charge high commissions: channel margin matters.
- Owners live on WhatsApp and Facebook; many prefer Bangla/Banglish.
- Power/internet interruptions are normal → offline POS.
- Regulations (VAT by category, Mushak 6.3 invoice fields, EFD/SDC rollout, licences) change: keep them as config, mark TODO(verify), confirm with a local accountant before claiming compliance.

## Proven patterns from Thala (founder's earlier QR ordering system)
RLS with server-side routes · order status separate from payment status · dark-mode two-tap KDS · oldest-first queue · deterministic rules engine for insights · synthetic Dhaka-pattern demo data. Reuse the patterns. Reuse code only if the founder owns it and explicitly asks.

## Out of scope for MVP
AI shift scheduling · payroll tax filing · tip management · lending (lender partnership possible later) · auto-posting to social · delivery-platform API integrations (manual tagging/CSV first) · EFD/SDC device integration (design data so it can be added) · native apps (PWA first).

## Pilot success signals
Owners act on ≥1 finding per week · findings worth ≥2× the subscription per month · branch input discipline ≥80% · onboarding <2 h · forecasts beat the naive baseline · weekly active owners.

Provisional pricing is in [ADR 0008](decisions/0008-provisional-pricing.md) — Growth at ৳4,500/branch/month, so the 2× signal means **≥ ৳9,000/month of evidenced findings per branch**. Pilot offer: first 5 restaurants at 50% off, locked 12 months, billed from Pilot gate A.
