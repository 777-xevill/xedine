# ADR 0062 — Restaurants in any country

Date: 2026-11-16 · Status: accepted; all six steps built the same day (the founder: complete all steps, target the top 10 countries) · Builds on ADR 0005, 0006, 0061

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

**The ten target markets** (the founder's pick, for marketing): Bangladesh, India, Pakistan, the UAE, Saudi
Arabia, Qatar, Malaysia, Singapore, the United Kingdom and the United States (`TARGET_COUNTRIES`). Why: South
Asian and halal restaurant culture, Bangladeshi and South Asian owners abroad (most UK curry houses), English or
Bangla screens, and currencies that count in hundredths like taka. The other 35 countries in the list work too.

### How steps 2–6 were built

2. **Clock.** `private.business_date()` stays one immutable function in Dhaka wall-clock terms; the cutoff
   helpers almost every metric passes to it (`org_cutoff`, `branch_cutoff`) now return the cutoff shifted by the
   distance between Dhaka and the restaurant's zone (`private.dhaka_shift`), so Dubai's 04:00 is
   business_date(ts, 360). An order's own business_date is stored with the shift of its own moment (exact);
   computed days use the shift of now, so in a summer-time zone (UK, US) a day computed for the other season can
   be off by the hour around its cutoff. The hour of a sale, dayparts (`private.daypart_of_tz`), review and
   complaint dates and the member card's "member since" use the restaurant's zone; the till's shift opens on its
   branch's cutoff. In the app every `businessDate()` and every date shown takes the restaurant's zone
   (`ctx.place`, `placeOfOrg`). The morning brief and the evening close run hourly and go out at 09:00 and 23:00
   local; the day's close runs after each restaurant's cutoff. Xedine's own billing months stay in Dhaka time.
3. **Money.** `formatMoney(minor, locale, currency)` replaces `formatBDT`: the currency's sign (৳, ₹, Rs, $, £,
   S$, RM, or the code: AED 1,250), lakh grouping for taka and the rupees, thousands elsewhere, Bangla digits in
   Bangla. Pages read the currency from the org context, the till from its saved settings (offline too), the
   table and card pages from their loaders, jobs and the assistant from `org_settings`. The assistant is told the
   currency (prompt v7). Only currencies that count in hundredths are offered; a country whose own does not
   (Japan, Korea, Vietnam, the Gulf dinars) starts on US dollars until a decision is made. Prices and offers are
   back in posts and videos in every offered currency. Form labels say "Price", not "Price (৳)". Xedine's own
   price list stays in taka.
4. **Tax.** The rate stays the owner's; the name follows the country (`taxKindOf`: VAT; GST in India, Pakistan,
   Singapore, Australia, New Zealand and Canada; SST in Malaysia; Sales tax in the US; Tax in Qatar and Kuwait)
   on settings, the till, the receipt and posters. The receipt's "BIN" is "Tax no." outside Bangladesh, and the
   Mushak note shows only in Bangladesh. The compliance page keeps "VAT return". TODO(verify) with an accountant
   in each market.
5. **Calendar.** Bangladesh keeps BD_CALENDAR; every other country gets its own special days from culture.ts
   (`countryCalendar`: each festival once over its days, Ramadan as one stretch where it is kept), added to the
   restaurant's calendar by the weather job the same way, so the forecast and the Plan page know them.
6. **Words.** The landing page says "for Bangladesh, South Asia, the Gulf and beyond", lists the ten countries,
   and "your own currency and clock". **Phones:** a customer's number follows the restaurant's country
   (`private.normalize_phone`: Bangladesh's exact rule; elsewhere +code numbers as they are, local numbers with
   the country's code, "(0)" and the trunk 0 dropped); numbers with a country code are masked before any AI.
   Owner sign-in by phone (Telegram) stays Bangladeshi; owners abroad use email or Google.

Not done: interface languages other than Bangla and English; subscription payment from abroad; the Gulf dinars,
yen, won and dong; tax forms for other countries; a legal review of the terms for each market.


## Consequences

- The country list (45 countries, their time zones and currencies) lives in `src/modules/social/culture.ts`
  with the festivals; it may move to `src/lib` when the rest of the app reads it.
- A time zone can change at any time; once step 2 lands, a change moves the business day from then on.
