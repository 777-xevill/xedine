# ADR 0061 — Short videos: motion graphics from dish photos, free music, food sounds and a free AI voice

Date: 2026-11-16 · Status: accepted (founder's choices, asked one by one) · Builds on ADR 0040, 0044, 0057, 0058

## Context

The founder wants every restaurant's videos to look, sound and feel like the restaurant's own premium
brand, and sent 12 reference videos (Pinterest, motion-graphics food ads). Watched frame by frame, they share
one shape: a designed background, the dish cut out of its photo and moving on it, a hook line or question, two
or three dish moments, the logo at the end. The old reel (ADR 0040) was an 8-second silent slideshow of one
poster.

## Decision

**What a video is.** 1080×1920, 10–12 s: the hook (2.2 s, longer when spoken), one to three dish scenes, the
logo (2.3 s). Seven kinds, each fitting a number of dishes: *showcase* (1, big dish then close-up with price),
*offer* (1, the menu price crossed out and the owner's own offer price stamped in), *versus* ("this or that?",
2, names curved round the dishes and a big OR), *combo* ("1 is good, 2 is better", 2), *carousel* (3 cards
sliding into the middle), *ring* (plates turning on a ring, 3), *search* (the restaurant's name typed into a
search bar, then the cards, 2–3).

**Endless looks, like the posters (ADR 0058).** A video look = kind × colour scheme × typeface × backdrop ×
decorations × hook motion (pop, type, slam, split, rise) × dish entrance (rise, spin, drop, zoom, swing) × cut
(colour wipe, torn paper, circle iris, push, whip blur, flash) × stage (plain, diagonal split that swings at
every cut, wavy band, wooden table, torn paper band, spotlight) × ambient (drifting leaves, bokeh, sparkles) ×
steam × logo ending (reveal with a drawn ring, "Only at" stamp, card). Deterministic from a seed
(`video-look.ts`), so the Growth preview and the rendered video agree. Colours come from the restaurant's two
colours; **a new logo now fills those two colours by itself** (`logo-colors.ts`), and the owner can still change
them. No logo: the restaurant's name as a clean text badge.

**How it is drawn.** One HTML page with CSS animations at fixed times (`video.ts`, pure). The renderer pauses
every animation and steps it frame by frame at 30 fps in headless Chromium, then ffmpeg encodes H.264
(`render.ts`), as the reels did, so a slow machine makes the same video. No new dependency. Words are fitted to
their boxes with every animation at its end, so a word flying in is not measured as overflow.

**Sound** (`sound.ts`):
- *Music*: 25 tracks, each a 14 s excerpt, all **CC0 1.0** from the Free Music Archive (HoliznaCC0, Komiku,
  Loyalty Freak Music, Monplaisir), kept in `assets/social-music` with the source and licence of each in
  `library.json`; no credit needed. Picked by mood (special day → festive/warm; versus/combo → playful; tone:
  friendly → warm/upbeat/chill, premium → cinematic/chill, fun → upbeat/playful), varied by the post's seed and
  avoiding the last six tracks. The track id is kept on the post as the licence record. The moods are by the
  artists' own titles and genres: nobody at Xedine has listened to all of them yet. FreePD (the first choice)
  has closed.
- *Food and motion sounds*: a whoosh at each cut and dish entrance, a pop on labels, a stamp on slams and
  prices, sizzle under steam. **Synthesised by ffmpeg** (noise and tone generators), so they carry no licence.
- *Voice*: the hook (with the special day's greeting in front) read by Microsoft's free neural voices through
  the open-source `edge-tts` tool (Bangla: Nabanita / Pradeep; English: Ava / Andrew), the **founder's choice
  of the unofficial free way**: no account, no key, no cost, but Microsoft may stop it at any time. One retry;
  if it still fails, the video simply goes out with music only. The music ducks under the voice; a spoken
  video is 12 s and its hook stays as long as the voice. The owner or a manager sets how many videos speak:
  none, every other one (default) or all, and a woman's or a man's voice.

**Words.** The AI writes one set of lines for every kind (hook ≤ 6 words, spoken; punch; question; tagline;
captions in both languages) from one fact (best seller, "customers often order A with B", or the owner's own
note), checked by the numeric validator; an answer with a made-up number, or no AI at all, falls back to the
app's fixed lines. **A special day's greeting is fixed text from the translations** ("Eid Mubarak", "ঈদ মোবারক"),
never AI-written; a custom day is the owner's own words. Prices only from the menu and only when every branch
agrees (the poster rule); an offer price is the owner's own, below the menu price (checked in SQL).

**Special days.** Eid ul-Fitr, Eid ul-Adha, Ramadan, Iftar, Jummah, Pohela Boishakh, Victory Day, Independence
Day, New Year, Christmas, Durga Puja, Valentine's Day, Mother's Day, Weekend, or the owner's own words. Each has a
theme (Islamic: crescent moon, hanging lanterns, stars; Boishakh: red/white flowers; national: green/red;
festive: confetti; love: hearts) that dresses the whole video. The autopilot greets by itself when
`greetings` is on: a festival on the restaurant's own calendar (the BD calendar of ADR 0051, so a day the owner
deleted is not greeted; days of mourning — Ekushey, Ashura, Shab-e-Barat, Buddha Purnima, Miladunnabi, May Day —
get no food greeting), else Jummah on Fridays.

**Which dishes, like a person would.** The owner's or a manager's own video uses the dishes they picked. The
autopilot takes its usual turn (marked dishes, else best sellers, ADR 0058), a different dish for each slot of
the day, and puts it with the dishes customers most often order with it — **`growth.pairs`**, a new metric
(METRICS.md) — then the best sellers. The kinds take turns across days and slots; with fewer usable dishes the
kind steps down (carousel → versus → showcase).

**Photos.** Menu photos are shrunk to 640 px for the till (ADR 0031), so each dish may now have a
**high-quality photo for posts and videos** (`menu_items.hq_photo_path`, up to 1600 px, uploaded on Growth →
Video by the owner or a manager into the org's own `hq/` folder); posters and videos use it when there is one.
A photo whose short side is under 360 px (a tiny forwarded picture) is skipped and Growth lists it as "too small
for video"; the AI photo check (not food, too blurry) still applies.

**How many, and who.** `videos_per_day` 0–5 (default 1), besides the daily post, on posting days, at good times
(12:30, 19:30, 16:00, 21:00, 10:30 …) at least an hour from the daily post; one row per slot
(`social_posts.slot`, unique per org, day and slot). Posted by the autopilot like every post (ADR 0040: no
preview, the founder's choice). Video settings, making a video and adding a high-quality photo are open to the
**owner and managers** (the founder's choice), through audited RPCs; Growth gets a **Video** tab with the
settings, the studio (pick dishes, kind, special day, language, idea, AI words, offer price, another look, a
live preview that is the real video page playing in the browser) and the photo list.

**Every video opens differently** (added 2026-11-16, after the founder saw "Still thinking about lunch?" on
every sample). Each video draws a hook style from its seed: craving, meal moment, bold claim, invitation,
teaser, taste words, everyday mood, dare, POV (no dare or POV for a premium tone, POV only for fun; the meal
moment only when the posting time is known, named from the Dhaka hour: breakfast, lunch, evening snack,
dinner, late night). The AI gets the style (with an English and a Bangla example it must not copy) and the
restaurant's last 8 posts' headline and tagline, and may not name a mealtime outside the meal-moment style. A
hook word for word like a recent one is dropped for the app's fixed line in the same style. The fixed lines
(AI off or failed) are one per style and per meal moment, with four taglines and four questions taking turns.
"Write with AI" in the studio draws a new style on every press. Prompt `social_video` v2.

**Bangla is hand-written, not AI-written** (the founder's choice, same day: the free AI wrote odd Bangla such as
"একসাথে খেলে অপবাদ নেই", and the autopilot posts unread). `bangla-lines.ts` holds 208 hooks (by style, meal
moment and special day) plus taglines, questions, combo lines and captions, each tagged by tone, dish count,
and a sales fact ("সবাই এটাই অর্ডার করে" only for a real best seller, "এই জুটিই সবার পছন্দ" only for a real
pair). A Bangla video's screen lines, voice and Bangla caption are picked from these to match the video,
skipping the restaurant's recent lines; a special day's lines come on about two videos in three. Lines name a
dish only by its Bangla name and promise no price, delivery, hours, ingredients, heat or "best in town", so
they fit any dish. The AI is asked only for English, and for Bangla only when the owner wrote their own idea
(the lines cannot carry it; the studio shows those words for editing). Adding lines is editing that file.

## Consequences

- One video takes about 25 s to render on the founder's PC; the GitHub runner is slower. The tick never starts a
  video in the last two minutes of its budget and makes posts up to three hours ahead, so a handful of videos per
  tick keeps up with today's restaurants; many restaurants at five a day will need more runners.
- `edge-tts` is unofficial. When it breaks, videos keep going out with music only; the official Azure free
  tier (same voices, 0.5 M characters a month) is the way out.
- The music library is small and was chosen without listening. The founder should listen and drop any track
  that does not fit; adding a track is a file plus a line in `library.json`.
- Poster-day reels for TikTok (ADR 0041) still use the old 8-second reel; every post whose format is video now
  uses the new engine.
