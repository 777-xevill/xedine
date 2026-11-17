# The landing page's 3D day (ADR 0064)

One continuous scroll through one café, from dawn to night, guided by Xedine (the chef logo as a floating 3D
character with two mitten hands). Every moment: a time chip, one sentence, the real screen drawn live, and
Xedine pointing at it. The home page (`/`, since 2026-11-18; also at `/landing-preview/day`) (`?country=GB` shows another market's prices;
the live site reads the visitor's country from Cloudflare's `cf-ipcountry`). Words: `messages/*.json`
→ `landing3d.day`.

## The cast

| Who | Look | Holds |
|---|---|---|
| **Xedine** (the AI manager) | the chef logo: charcoal bell, chef hat with the yellow band, quote-mark eyes, silver cloche badge | waves, points |
| The owner ("you") | blue | a phone (morning brief, the offer, the chat), a mug |
| Shopper | green, white cap | a phone (Telegram), the shopping |
| Cook | orange, red bandana, white apron | a spatula |
| Waiter | navy, white collar, bow tie | a notepad |
| Cashier | rose, headset | — |
| Manager | violet, red lanyard and ID card | a phone (PIN approval, the complaint) |
| Guests | teal + scarf, lime + cap, pink + bow, light blue + beanie | a phone (table QR, the offer, a review), a card |

## The day (19 moments)

`story.ts` (BEATS) is the source; `features.test.ts` checks every feature appears and exists in the code.

| # | Time · place | What happens | Features |
|---|---|---|---|
| 1 | Dawn · the street | The sign says Xedine; Xedine waves from the door; the owner walks up with tea. | Bangla and English, any country |
| 2 | 7:00 · on the way in | The morning brief on the owner's phone: the dishes likely to sell best (never a count), rain, buns running out, the licence. | morning brief, today at a glance, weather |
| 3 | 7:30 · the back door | The shopper types the bazar on Telegram; the bot asks "is oat milk new?", saves a draft; the stock board fills, each item "lasts N days", Stock Guard is green. | bazar by chat, bazar, you approve, Stock Guard, stock |
| 4 | 8:00 · the kitchen | The food safety tablet: old milk written off, cream held so iced coffee leaves the till, today's checks, the licence reminder. | food safety, daily checks, licences |
| 5 | 8:30 · the staff door | The manager, waiter, cashier and shopper tap in on the tablet by the back door; private notes. | staff records, team, staff PINs |
| 6 | 9:00 · the office | The plan: a week of weather and holidays, tomorrow's likely best sellers, the bazar list, "send to the shopper". | plan, weather and calendar |
| 7 | 12:30 · table 4 | A guest's phone: the table QR menu with calories and protein, the allergy filter, member card, offer tick, a game. | table QR, food facts, member card, offers, table games |
| 8 | 12:35 · the till | The order: member card, code EID10, the tax by name, sent to the kitchen, then checkout in cash + card, offline, quick order. | till, member card, discount codes, tax, offline, quick order |
| 9 | 12:36 · the floor | The manager's phone: the PIN for a 30% discount, "recorded", today's sales, profit locked. | manager approvals, profit private, everything recorded, today |
| 10 | 12:37 · the kitchen screen | Tickets by table, what to cook and minutes waiting; the late one yellow and marked Ready; the new order arrives. | kitchen screen, staff PINs |
| 11 | 12:40 · storeroom | The scale shows 35 g of cheese (recipe 20 g); fries dropped by their carton, labelled; the stock bars fall, the loss and the waste lines, "no count needed". | dish ingredients, stock, every gram, waste, no counting |
| 12 | 15:00 · the counter | The poster screen: the real photo, cut out, the poster, "posted" with the Facebook, Instagram and TikTok logos, a 10 s video. | social autopilot, posters, short videos, TikTok |
| 13 | 16:00 · the quiet hour | The owner approves an offer for 4–6 pm (members who said yes, some kept out); a guest's phone gets the notification; a number deleted on request. | offers, customers, delete a number, you approve |
| 14 | 17:00 · the door | A guest's 5-star review goes to Google; the manager closes a complaint with its cause and fix. | reviews and complaints |
| 15 | 23:00 · closing | The till: cash should be / counted / short, today's sales, best sellers, the hourly chart. | till, sales charts, today |
| 16 | 23:10 · the office | Where money leaked (each with proof and what to do), the true profit, the most profitable dish; owner and accountant only. | leaks, costs, menu profit, profit private |
| 17 | 23:20 · above the city | Three branches ranked, a new one waiting for approval, food cost next to peers; then the globe with the ten markets. | branches, new branches, benchmarks, any country |
| 18 | Night · the office sofa | The owner's phone asks Xedine and gets an answer; on the page, five ready questions answered from the day's numbers, and a box to type your own. | ask Xedine, your rules, Bangla and English |
| 19 | Tomorrow · your café | Start free: Google, phone or email. Then the A–Z list of every feature. | sign-in, set-up, plans, switches, menu |

Not in the story because Xedine doesn't do it: ordering from the guest's own phone; a manager confirming each
order.

## The ready questions

Where am I losing money? · Where is my stock being wasted? · What should I buy tomorrow? · Which dish makes me
the most profit? · How did today compare with last week? Each answer is a message whose numbers come from
`story-ledger.ts` (`useAnswers` in `story-text.ts`); a typed question gets "in your own café Xedine answers this
from your own numbers" and the way to start.

## Rebuild, in order

Blender is the founder's portable 5.2 LTS, used headless with its own settings folder, so nothing is written to
`E:\Editing`:

```
B="E:/Editing/apps/blender/blender.exe"; export BLENDER_USER_RESOURCES=E:/xedine.org/.cache/landing-3d/blender-user
```

| Step | Command | Makes |
|---|---|---|
| 1 | `python scripts/landing-3d/fetch_assets.py` | CC0 Poly Haven models and textures, the Inter font (OFL), once |
| 2 | `python scripts/landing-3d/make_textures.py` | chalk boards with the name, the awning's edge, the window lettering, the QR card, the checklist, the licence, the clock face, latte art |
| 3 | `"$B" -b --factory-startup -P scripts/landing-3d/xedine.py -- --export` | Xedine with its rig and moves (then `gltf-transform resample` + `meshopt` → `xedine.glb`) |
| 4 | `"$B" -b --factory-startup -P scripts/landing-3d/world.py -- [--render] [--night]` | the whole building and street (`world.blend`), test renders of each room |
| 5 | `"$B" -b --factory-startup .cache/landing-3d/world.blend -P scripts/landing-3d/bake.py -- --samples 192` | day atlases (in the zone files), night atlases (`night/*.webp`), 360° views (`env-*.jpg`), `world-<zone>-raw.glb` (~20 min on the RTX 3050); `-- --export-only` on `world-baked.blend` re-exports without baking |
| 5b | `... bake.py -- --samples 192 --only ca_dining,ca_floor --texture-limit 2048` | only the named atlases (day and night), reusing the saved bakes of the rest; for a small change on a machine short of memory (geometry elsewhere unchanged) |
| 6 | `"$B" -b --factory-startup -P scripts/landing-3d/cast.py -- [--render]` | the people and their props (`cast-raw.glb`) |
| 7 | `node scripts/landing-3d/pack.mjs` | `public/landing/3d/world-{st,ca,ki,sr,of}.glb`, `cast.glb` (dedup, prune, meshopt) |

After any rebuild, set `LANDING_3D_VERSION` in `asset-version.ts` to the hash `asset-version.test.ts` prints: the files are cached for a year under that version.

`land.png` (the globe's land) is drawn from Natural Earth's public-domain 110 m land.

## How the page draws it

| Part | File |
|---|---|
| The page (the scroll, the moment's card, the chat, the A–Z list) | `day-story.tsx`, route `src/app/landing-preview/day/page.tsx` |
| The 3D stage (camera, light by time of day, Xedine leading the way) | `day-stage.tsx`, `timeline.ts` |
| The building: baked surfaces unlit, blending day and night maps; glass, plants, the sign's letters, lamp glows, the clock's hands live | `world.tsx` (zones load one by one, the street first) |
| The screens (till, kitchen screen, food safety, stock board, attendance, office monitor, poster, scale, phones) drawn on canvases in the app's grey, silver and yellow | `screens.ts`; words and numbers ready in `story-text.ts` |
| The people: glide, float, blink, look at you, hold props; phones turn toward you | `cast.tsx` |
| The night city (windows lit) and the globe with the ten markets | `city.tsx` |
| The demo café's numbers | `story-ledger.ts` (+ test) |
| Everyone whole in every view, nobody popping in, Xedine in view between rooms, screens readable (wide and upright phone) | `framing.test.ts` |
| Every feature and the code that is it | `features.ts` (+ test) |

Sizes: the whole day 6.6 MB; the first picture (street + Xedine) 1.3 MB, preloaded from the HTML; the other rooms load one by one after it.

## How a moment is filmed (the founder's rules, 2026-11-17)

- A moment opens on a wide view: its people whole, head to floor, clear of the card, and Xedine with them.
  Its close look (a screen or a phone) arrives early (the beat's `pace`) and holds while the screen plays.
- Every view holds for half the way to the next one, so wherever the scroll stops the picture is settled.
- Between rooms the camera holds, turns to Xedine and follows it about two metres behind through the doors (or
  the office window, which opens for the flight to the city). Within a room (`hop`) Xedine glides to its next
  place while the camera turns.
- People appear and leave only where the camera cannot see them (`showingSpans` in `timeline.ts`).
- A phone is held from below and behind, so no hand covers its screen; a close look aims at the real phone.
- `framing.test.ts` checks every key of every moment on a wide screen and an upright phone: nobody cut by
  the picture or hidden behind someone, Xedine in view from room to room, nobody popping in or out in view,
  every close look big enough to read. Free assets only: Poly Haven (CC0), Inter (OFL),
Natural Earth (public domain). The only name in the world is Xedine.

## Approvals

1. Xedine's look: **given**.
2. The café corner: **given** (with "show our name on the boards": done).
3. The whole day on `/landing-preview/day`: **given** (2026-11-18).
4. It replaces the landing page: **done** (2026-11-18).
