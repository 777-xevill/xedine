# ADR 0066 — The launch audit, and the day plan

- Date: 2026-11-19
- Status: accepted (the founder asked for a last full review before the first restaurant and a more
  standard, structured daily plan; built without a real restaurant, so **§2.2, §2.3 and §3.3 are choices
  the founder should confirm**)

## Context
Before the first restaurant goes live the founder asked for one deep review of stock, dish ingredients,
food safety, daily planning, purchasing, sales, money tracking, money leaks and menu profit, and for the
daily planning to become "more standardized, structured and comprehensive, with more useful options and
flexibility". There is no real restaurant yet, so every finding below was reproduced with numbers worked
out by hand (`tests/db/launch-audit.test.ts`, `tests/db/day-plan.test.ts`) and the golden checks on the
seeded year.

The founder's earlier rule for the Plan page stands (2026-11-13): the forecast and "what to cook" make no
promises — dishes are ranked, never counted. Numbers appear only where they are the restaurant's own (a
party order it took) or where buying needs them (the bazar list).

## Decision

### 1. What the review found, fixed
1. **Sizes used the whole dish.** A Half plate took a full plate's mutton from stock and was costed as a full
   plate; food cost of half plates read double and stock ran out on paper. `item_variants.portion_bps` says
   how much of the dish a size uses (half = 5000). It applies whenever the size has no recipe of its own:
   stock (`m_sold_for_stock` now returns plates and portions), the cost snapshot (`item_unit_cost`), Stock →
   Used (plates stay plates), the stock leak's evidence and the bazar list. A new size named "Half"/"হাফ"
   starts at ½, "Quarter" at ¼, anything else the same as the dish; the owner changes it on the Menu page
   (`set_variant_portion`, owner only, audited; the cost already stored on that size's past sales is scaled
   to match, as its stock is).
2. **A voided or back-dated purchase left wrong prices behind.** The weighted price looks back 14 days, but
   only the purchase's own day was worked out again: a ৳40,000 chicken typo stayed in every later day's cost
   until the next chicken purchase, and in the food cost of the sales it priced. Now every later day it
   touched is re-priced, and voiding a purchase re-costs those sales with their own sale-time recipe
   (`recost_sales_for_ingredient`). The Stock Guard's "price typo → void and type it again" now cleans up
   completely.
3. **Salaries stopped on the 1st.** A month counted no staff cost until the owner pressed "copy last month's
   pay", so profit and break-even were wrong from the first of every month. A person still working here
   carries their last pay (up to a year back) into a month that has no entry for them; an entry always wins.
4. **The clean café's false cash alarm (golden checks red since 10 Nov).** The shortage floor (৳1,000) was
   for the whole period, so honest ±৳50 mistakes added up over a year until a clean cashier crossed it. The
   floor is now per week of the period; the weekly scans the product runs are unchanged.
5. **The salary-week golden check (red since 10 Nov)** expected 1.08 ± 0.05, but the seeded Dhanmondi
   orders really show 1.157 (the planted 8% plus day-to-day noise; the SQL was right). The manifest now
   records the lift each branch's orders really have, and the check is that the learned factor equals it.
6. **A leak nobody watched: orders left unpaid.** An order that went to the kitchen and was never paid nor
   cancelled stayed open for ever: the food left the shelf and no money was recorded (take the cash, leave
   the bill open). New zero-input detector `orders.left_unpaid`, in the weekly scans, by who took the order.
7. **The bazar list.** It ignored the ≈ estimate and took a never-counted item as an empty shelf, so a new
   restaurant was told to buy everything again; a list for today counted today twice; a list for a later day
   ignored what the days in between would use. See §3.
8. **The forecast's first weeks.** Days before a branch's first sale counted as zero sales: a new
   restaurant's first four weeks were forecast at 40–70% of the truth. They are now unknown, not zero. A day
   exactly a week ahead had no "same day last week" yet (today is not over); it now looks two weeks back.
9. **Managers could not "Tell Xedine".** The form showed for managers, but the calendar only lets the owner
   write, so their special days were refused. It now goes through `add_special_day` (§2.2).
10. **The bazar WhatsApp text** was composed in the screen's language, not the restaurant's
    (`getTranslations({ locale })` ignores the locale); it now uses `createTranslator`.

### 2. The day plan
1. **One routine, the same every day** (Plan → "Day plan", the page's first tab, today by default):
   *before you open* — party and pre-orders, use these first (newest lot out of date by two days after
   the day, or held), running low (under three days of cover), daily checks still due; *cooking and
   buying* — what might be busy (ranked, no counts), the bazar list's state (none → draft → approved →
   sent → checked); *before you close* (today only) — orders still unpaid, cash drawers still open, waste
   written, count day, tomorrow's list made. Each step ticks itself from the records (`metric_day_plan`)
   with its state in words and an icon (done, to do, look at this, at closing, good to know, nothing
   needed) and a link to where it is done; "N of M done" counts the steps a person acts on.
2. **"How busy will it be?"** on Tell Xedine: much busier (+30%), a bit busier (+15%), a bit quieter
   (−15%), much quieter (−30%), let Xedine work it out (the learned factor, as before), or closed (owner
   only). Stored as `calendar_events.expect_bps`; the forecast uses it for those days instead of what such
   days did before, because a new restaurant has no two past match days to learn from. Managers may tell
   about yesterday to two months ahead; the owner anything. *Confirm the four steps.*
3. **Party and pre-orders** (`planned_orders`, `planned_order_lines`): for whom, ready by, dishes and sizes
   in plates. Written only by the owner or the branch's manager through `save_planned_order` /
   `set_planned_order_status` (audited); everyone at the branch reads them. They are certain demand on top
   of the usual day — added to "what to cook" (shown exact: they are the restaurant's own numbers) and to
   the bazar list — and taken out of the history afterwards (spread over the day's dayparts) so the usual
   day of the weeks after does not carry a one-off wedding. *The restaurant rings each one through the till
   when it goes out*; one that was never rung would make the usual day look smaller. Titles can name a
   customer, so the assistant gets dishes and plates only (CLAUDE.md #8).

### 3. The bazar list, worked out again (`bazar_need`)
1. Stock is the count-based figure, else the ≈ estimate (bought − recipe use − waste since the first
   arrival, never below zero), marked ≈ on the list.
2. The buying period: a list for today needs only the rest of today plus the next `bazar_days − 1` days; a
   later list all of its `bazar_days` days. The stock at the start of the list's day is stock now, less the
   rest of today and the days in between, plus what lists already approved for those days will bring.
3. Usage = the usual day's dishes (the model while it beats naive, else last week × the day's "how busy")
   × portions per plate sold over the last 28 days (half plates take half) × recipe, plus party orders.
   Need = usage + safety stock − start stock − on the way, tuned, rounded up to the pack.
4. A person can add an item the list missed (`add_bazar_line`); making the list again keeps it, and it never
   tunes later suggestions.

## Alternatives considered
- **A separate recipe per size** — exact, but every dish's ingredients written twice; the share covers the
  usual half/full menu, and a size may still have its own recipe.
- **Re-costing every past sale whenever a price changes** — a snapshot is what was known at the sale; only a
  voided (wrong) purchase or a corrected size share rewrites them.
- **Numbers on the forecast and "what to cook"** — what a kitchen usually wants, but the founder chose ranks
  and "might" words; the party orders and the bazar list carry the numbers that are certain or needed.
- **Party orders as a till channel** — would keep them in sales, but not let the kitchen and the bazar plan
  for them in advance.

## Consequences
- Migrations `20261202000001_launch_audit.sql` and `20261202000002_day_plan.sql`; new tables
  `planned_orders`, `planned_order_lines`; columns `item_variants.portion_bps`, `calendar_events.expect_bps`,
  `bazar_list_lines.stock_estimated/planned_qty/added_by_hand`.
- `m_sold_for_stock`, `m_forecast` (adds `expect`), `metric_prep_plan` (adds `planned`) and `bazar_need`
  changed shape; their callers were updated with them.
- The golden checks' S13 also runs the unpaid-orders detector; the S10 manifest gains
  `salary_week_factor_realized`.
- **Revisit with the first restaurant:** the four "how busy" steps, the two-day "use first" horizon, the
  three-day "running low" line, and whether managers should record party orders for other branches.
