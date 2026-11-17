# ADR 0064 — The landing page as one 3D day in a café, guided by Xedine

Date: 2026-11-17 · Status: accepted (the founder) · Changes the landing page of ADR 0056 · Narrows ADR 0063 for
the 3D scene only

## Context

The founder: "transform our existing logo into a 3D character that can move its body parts … when visitors scroll
down, the character should travel through different 3D environments … a demo restaurant in 3D that shows the
complete restaurant workflow … showcase ALL [features] … make sure no feature is missed … real-time 3D, not
videos, static images or pre-rendered animations … one continuous, connected 3D story, with our Xedine character
present throughout." The story they described: a customer orders → the till → the manager → the kitchen → stock
goes down and waste is recorded → the owner ("YOU") asks "Where am I losing money?" and gets answers.

Asked plainly (with buttons), they chose:

- **Xedine** floats and glides with two small hands (no legs); its quote-mark eyes look at things, blink and
  smile. It is the AI manager that watches everything.
- **Everyone else** (customer, waiter, cashier, manager, cook, shopper, the owner) is a little blob like Xedine,
  each with their own item.
- **Real colours** in the 3D world: a real-looking café with wood, steel and real food.
- **A general café** (burgers, pizza, coffee), so visitors from all ten markets recognise it.
- **One day in the café**: morning, lunch rush, afternoon, night, then you. Their order story is the lunch rush.
- **Only what is real.** Ordering from the customer's own phone and a manager confirming each order are not in
  Xedine, so the story shows the waiter entering the order at the till and the manager approving a discount
  with their PIN.
- **The ending:** the visitor taps ready questions and Xedine answers, presented so people understand "you can
  use it like ChatGPT: a real personal AI agent for your restaurant".
- **Blender, not shapes in code:** "code doesn't look real". Use the Blender install and the Blender skills of
  the founder's Editing project (`E:\Editing`) **without changing anything in that folder**.

## Decision

1. **One world, one timeline.** The café is a single connected 3D place (street front, dining room, counter and
   till, kitchen, storeroom, office, then the city and the globe). The whole day is one Blender timeline: camera,
   characters and props. The page scrubs that timeline with the scroll, so there are no cuts and no separate
   sections. Everything is drawn live in the browser (three.js); no video, no pre-rendered frames.
2. **Live on top of the timeline:** Xedine's eyes follow the pointer or finger and whatever is tapped, it blinks
   and reacts; idle motion continues when the scroll stops; the devices in the café (till, kitchen screen, phones)
   show live miniatures of the real Xedine screens, not pictures.
3. **Easy to follow:** every beat has a time-of-day chip, one short sentence, the real screen, and Xedine
   pointing at it. The words are real HTML text in English and Bangla (Google reads them; the canvas is
   decoration), with a chapter rail and "skip to the end".
4. **Only real features.** Each beat is checked against the code before it goes in the story (docs/LANDING-3D.md
   lists them).
5. **Numbers.** The story runs on one small demo ledger (menu prices, recipes, the day's orders) and every
   number on screen and in the answers is computed from it, unit-tested. Prices follow the visitor's country
   (one of the ten markets, from the Cloudflare country header; Bangladesh by default) in that currency.
6. **Colours:** the 3D world uses real-world colours, set in the 3D files, not in code. Xedine keeps the logo's
   colours (charcoal body, the yellow band, white eyes, the silver cloche). Every page element over the 3D (text,
   buttons, chips, the chat) stays grey, silver and yellow (ADR 0063).
7. **Tools:** Blender 5.2 LTS from `E:\Editing\apps\blender`, run headless by the scripts in
   `scripts/landing-3d/` with its own settings folder (nothing written to `E:\Editing`); work files in the
   ignored `.cache/landing-3d/`; free assets only (CC0 Poly Haven, Blender-made, or the local image-to-3D).
   Web: `three`, `@react-three/fiber` 9 (supports React 19.3), `@react-three/drei`,
   `@react-three/postprocessing`, `lenis`; `@gltf-transform/cli` compresses the files.
8. **Phones first:** the same story on phones, with lighter textures and effects chosen automatically. Budget:
   first screen under 2.5 MB, the whole day under 15 MB loaded room by room, 60 fps on a laptop and 30 fps or
   better on a mid-range Android phone. Reduced motion shows still chapter views and no camera flight.
9. **Approvals before it goes live:** (a) Xedine's look, (b) one café corner's look, (c) the whole day on a
   hidden preview page; only then does it replace the landing page.

## Consequences

- The landing page's current sections (features, social, how it works, countries) become scenes in the day;
  the sign-up call to action stays on the first screen and the last.
- A bigger first download than today's page; the first screen appears before the 3D finishes loading.
- 3D work files are rebuilt from the scripts, so the café can change by editing a script and running it again.

## Amendments (2026-11-17)

- **Approvals.** (a) Xedine's look: given, after the logo's extra left "sweep" line was removed. (b) The café
  corner: given, with one request, "use our name any place like board xedine so that people can see our name":
  the name is now on the shop sign (lit at night), the awning's edge, the shop window, both chalk boards, the
  menu board and the header of every screen. Still no other brand, word or alcohol anywhere in the 3D world.
  (c) The whole day is built and waits for approval on the hidden page `/landing-preview/day`.
- **How the day is built (refines decision 1).** The world is modelled and lit in Blender (`world.py`) and its
  light baked twice, day and night (`bake.py`); the page blends the two with the clock. The day's timeline (the
  camera's path, where every person stands and what they hold, what each screen shows) is written in code
  (`src/components/landing-3d/story.ts`) and played live by the scroll, not as a Blender animation: it is far
  easier to change, much lighter to download, and every screen stays the real UI drawn live. It is still one
  continuous flight: the camera passes through doorways and the shop window, Xedine leads the way between
  moments, and the clock and the light follow the day.
- **Every feature, checked.** `features.ts` lists all 56 features with the code file that is each one;
  `features.test.ts` fails if a feature's file is gone, if a feature appears in no moment, if a moment shows a
  feature that isn't listed, or if a word is missing in Bangla or English. The A–Z list after the story names
  them all, each with a link back to where it appeared.
- **Numbers.** `story-ledger.ts` holds the demo café's day (menu in the ten markets' currencies, recipes, the
  day's plates, the bazar, waste, the extra cheese, cash, costs); every figure on a screen and in the chat's
  answers is computed from it (`story-ledger.test.ts`). The tax on the bill is named for the visitor's country
  (VAT, GST, sales tax) at an illustrative 5%: in Xedine the rate is always the owner's own (ADR 0005).
- **Not used:** `@react-three/postprocessing` and `lenis` (decision 7): the baked light needs no post effects
  and the page scrolls natively. The people are a separate file (`cast.py`, 0.8 MB) moved live by the page.
- **Size, measured:** the whole day is 6.5 MB (budget 15 MB); the first screen (the street, Xedine, the
  reflections) about 1.4 MB (budget 2.5 MB).
- **Reduced motion:** each moment is shown at its settled view with no flight between them and no lean with
  the pointer.

## Amendments (2026-11-17, the founder's review of the day)

The founder watched the whole day and asked for 23 changes. What changed, and the rules it set:

- **No promised dish counts.** The morning brief and the plan show the dishes that will **likely sell best**
  (today: latte, burger; tomorrow: latte, burger, fries, from `FORECAST_TOMORROW`), never "about N dishes".
  The chat's "What should I buy tomorrow?" answer names the likely best sellers too.
- **Screens say what they are.** Every screen's header shows Xedine's chef logo (`/brand/logo-chef-192.png`),
  not an emoji. The till shows **Checkout** above **Sent to the kitchen** (the real till's words), then the
  cash and card split and "Paid". Kitchen tickets read as table, what to cook and minutes waiting, with "Late"
  on a yellow ticket and "New" on the one that arrives; no order numbers. The manager's phone is a clear
  discount request (who asks, the table, 30%, the PIN, approved once, recorded). The poster screen shows the
  **Facebook, Instagram and TikTok logos** where Xedine posts (the founder's request: the only brands in the
  world, and only on that screen). The owner's phone at night is a real chat: a question and its answer.
- **Everyone whole, nobody popping in.** A moment's people, and anyone at work behind them, are either whole
  in the picture (head to floor, clear of the card) or not in it; nobody stands in front of anyone; every
  close look makes its screen or phone big enough to read, on a wide screen and on an upright phone. People
  appear and leave only where the camera cannot see them. `framing.test.ts` checks all of this for every key of
  every moment, on both screens.
- **Following Xedine from room to room.** Between moments the camera holds, turns to Xedine, and follows it a
  couple of metres behind through the doors (or the office window) to the next room; within a room Xedine
  glides to its next place. The way between moments takes 42% of a moment's scroll (was 28%), and each view
  holds for half the way to the next, so wherever the scroll stops the picture is settled.
- **Phones held from below.** The hand holds the phone from below and behind, so no mitten covers a screen,
  and a close look aims at the real phone.
- **The world, fixed and rebuilt.** Models from the asset library ignored their turn angle (glTF imports use
  quaternion rotation): every chair, the desk, the sofa and the stools now face the way they were placed. The
  desk stands along the alley wall with the lamp on it; the clipboard hangs flat (laid down, it poked through
  the office wall as a stray black line); the till moved to the counter's open end, so the cashier stands in
  full view; the safety tablet, staff tablet, kitchen screen and office monitor are larger; the tables' QR
  cards are larger and drawn sharp on the page; the office window opens (two casements, blinds up) as Xedine
  flies out to the city; the dropped fries lie by their red carton, leave no baked shadow, and carry a label.
- **More staff signing in.** The manager, waiter, cashier and shopper stand together at the attendance tablet.

## Amendments (2026-11-18, the founder's second look)

- **Chairs face their tables.** The dining chairs stood back to front (the scan's seat faces the other way
  after the rotation fix), so a backrest poked through each tabletop. They now face the table, pulled out
  0.75 m (corner table) and 0.68 m (window tables, so the window-side chair stays inside the wall); the guests
  sit on them.
- **The flight to the city is smooth.** The road out of the office window now spreads by distance and climbs
  through three more points, so the camera rises evenly; Xedine flies out through the window, stops above the
  street and the camera climbs past it (no turning back, no snapping down).
- **Every branch in view above the city.** The other two branches and the waiting one stand closer, above the
  roofs, inside the wide view on a wide screen and an upright phone.
- **The guest's offer phone says it all at once.** The notification ("A quiet-hour offer for you"), the offer
  (15% off every pizza, 4–6 pm, show the member card at the till), why it came (they said yes on the table
  QR), no WhatsApp or SMS, and "Open my member card", all shown the moment the phone is seen.
- **Approval 3** (the whole day): given by the founder on 2026-11-18 ("all ok", push and deploy). It goes
  live at `/landing-preview/day`; replacing the landing page (step 4) is still a separate request.
