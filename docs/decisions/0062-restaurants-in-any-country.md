# ADR 0062 — Restaurants in any country (step 1: where the restaurant is)

Date: 2026-11-16 · Status: accepted (the founder approved the plan and step 1) · Builds on ADR 0005, 0006, 0061

## Context

The founder: "this SaaS is not only for Bangladesh — any country's restaurant owner should be able to use it."
Xedine was built for Bangladesh: money is taka in poisha (ADR 0005), the business day and every metric run in
Asia/Dhaka, the outlook carries the Bangladesh calendar (ADR 0051), the interface is Bangla and English. Short
videos became country-aware first (ADR 0061). At the time of writing, Asia/Dhaka appears in 13 migration files
and about 110 places in the app, and taka formatting in 95.

## Decision

Open Xedine to other countries in steps, each shipped and tested on its own, with **no change for Bangladeshi
restaurants at any step**:

1. **Where the restaurant is** (this ADR, done): `org_settings.country` (ISO 3166), `.timezone` (IANA, one of
   the country's) and `.currency` (ISO 4217), Bangladesh / Asia/Dhaka / BDT by default. The owner picks them at
   sign-up (the country fills in its time zone and currency) and changes them in Settings → General (owner only,
   through the existing RLS; audited by the existing trigger). **The currency is fixed once the restaurant has
   an order** (database trigger, like the price basis in ADR 0005), because every stored amount is in it.
   Videos and posts read the country and clock from here; the copy on `social_settings` from ADR 0061 moved here
   and was dropped. Leaving Bangladesh puts the social posts in English once (the Bangla lines are for
   Bangladesh); the owner can set Bangla again.
2. **Its own clock**: the business day, reports, alerts, briefs and jobs in the restaurant's time zone.
3. **Its own money**: amounts formatted in the restaurant's currency and number style (1,234.50, not the
   lakh grouping), and its minor unit (none for JPY, three decimals for KWD, BHD, OMR, JOD: the poisha columns
   hold hundredths, so those need a decision first). Prices and offers then come back to posts and videos.
4. **Its own tax**: the rate is already the owner's (ADR 0005); the name follows the country (VAT, GST, sales
   tax) and the Bangladesh VAT forms (Mushak) show only in Bangladesh.
5. **Its own calendar**: the Plan page's holidays from the country (culture.ts), not the Bangladesh calendar.
6. **Sign-up and landing page** no longer say "for Bangladesh".

Later: more interface languages (Arabic reads right to left), and subscription payments from abroad.

Until step 3, a restaurant keeping its books in another currency still sees amounts with "৳" in the app, and
its posts and videos show no prices (ADR 0061); the sign-up and Settings pickers say so.

## Consequences

- The country list (45 countries, their time zones and currencies) lives in `src/modules/social/culture.ts`
  with the festivals; it may move to `src/lib` when the rest of the app reads it.
- A time zone can change at any time; once step 2 lands, a change moves the business day from then on.
