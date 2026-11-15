# ADR 0057 — Creative posters: dish cut-outs, ten designs and a live preview on Growth

- Date: 2026-11-15
- Status: accepted (built at the founder's request; amends ADR 0040 §2–§3 and §8)

## Context
The founder shared eight restaurant posters as the bar ("What's your status? ○ Single ○ Taken ✓ Hungry",
"What's your M🍝🍛D today?", a giant sideways LEMONADE, an Instagram-post frame the plate breaks out of, a
playful teal split, a "NEW RELEASE" menu, a phone the biryani bursts out of, a slanted "WE'RE LAUNCHING!"
band) and asked for image generation "like ChatGPT and Higgsfield", free, using open packages where they help.
ADR 0040's posters cropped the dish into a circle on one of four fixed layouts; nothing like the references.

Free options checked on 2026-11-15:
- **Cloudflare Workers AI** (10,000 neurons/day, no card) is still the only real free image API. FLUX.2 [klein]
  4B edits a photo for ~110 neurons at 1024×1024 (~90 a day); FLUX.1 [schnell] draws from text for ~58.
  FLUX.2 [dev], FLUX.2 [klein] 9B and Leonardo Phoenix / Lucid Origin cost 1,400–2,800+ neurons an image:
  three or fewer a day.
- The Gemini API's free tier no longer covers images; Hugging Face gives free accounts no inference
  credits; Puter.js's "free Nano Banana" bills the end user's own account from a browser, which a job cannot
  use; Pollinations was already rejected (ADR 0040).
- The repo is public, so GitHub Actions runners (4 vCPU, 16 GB) are free. Open models can run there on the CPU.
  For cut-outs: BiRefNet-lite (MIT) works; ISNet is AGPL and BRIA RMBG is non-commercial, so both are out.

## Decision
1. **Dish cut-outs on the CPU, free.** The social job lifts each dish (with its plate, bowl or glass) off its
   menu photo with BiRefNet-lite through `@huggingface/transformers` (onnxruntime-node). The result is a
   trimmed transparent WebP in `social-media/{org}/art/{item}/…`, recorded in `social_dish_art` and made once
   per photo (a new photo makes new art and removes the old files). It is **usable** when the whole dish is in
   the frame: 6–90% of the photo, touching at most 10% of its edge. A close-up whose plate runs off the frame is
   shown as the real photo, in a round plate or a framed card. ~12 s a photo on a laptop, less on the runner;
   the ~214 MB model is cached between runs (`actions/cache`, `SOCIAL_MODEL_DIR`).
2. **The AI studio plate** (ADR 0040's FLUX.2 [klein] step) now asks for the whole plate on a plain light-grey
   background at 1024×1024, and is then cut out the same way. It is made only for the dish about to be posted;
   an unusable one is retried after a week; a used-up quota is not remembered, so the next post tries again.
   The studio plate is stored with the dish's art, not with the post.
3. **Ten designs**, each after one reference, without copying it: `status` (checklist joke), `mood` (dishes as
   the O's of MOOD/FOOD/GOOD, English only), `giant` (sideways dish name), `band` (slanted launch band), `split`
   (playful colour, leaves, phone number), `frame` (Instagram card over the dish's own blurred photo, plate
   breaking out), `menu` (two or three dishes with prices), `breakout` (the restaurant's profile on a phone,
   the dish bursting through torn paper), `centre` (spotlight with price tag), `minimal` (premium serif).
   Every Latin display face is paired with a Bangla face (Anek Bangla, Hind Siliguri, Noto Serif Bengali,
   Baloo Da 2); headlines shrink themselves to fit; hand-drawn doodles are inline SVG. The image model still
   never draws words (ADR 0040 §3).
4. **Which design.** The owner's choice for their own post; otherwise the autopilot takes turns through the
   designs the owner allows (`social_settings.designs`, Settings → Social), led by the tone (fun → status,
   split, mood…; premium → minimal, frame, menu…), skipping the last three posts' designs and the ones the
   restaurant cannot fill (MOOD needs English, a menu needs two dishes). Designs that show more dishes take the
   ones posted longest ago that passed the photo check.
5. **Words.** One AI call (prompt `social_post` v2) fills every line any design may draw, in both languages,
   so switching designs needs no new call. The number check is unchanged (CLAUDE.md #1). One language per
   poster: "Bangla + English" alternates day by day (the caption still carries both).
6. **Prices from the menu, never from the AI.** A poster may print the menu price (shared formatter, Bangla
   digits in Bangla, "+VAT" when menu prices exclude VAT) only when every branch sells the dish at that price.
   The owner can switch prices off (`social_settings.show_price`, default on).
7. **The photo check is kept per photo** (`social_dish_art.photo_check`), so each photo costs one vision call,
   and extra dishes on a menu poster are checked too.
8. **Make a post on Growth is a live preview.** The owner picks the dish (and the other dishes for menu-style
   designs), sees that dish in every design (small live previews), types what the post is about and taps
   "Write the words for me", changes any line, then posts now or later. The preview is the real poster: the
   same templates run in a sandboxed iframe (`sandbox="allow-scripts"`, its own script only fits headlines).
   The owner's choice travels in `social_posts.template`, `design_words` (with the previewed language) and
   `extra_item_ids` through `request_social_post` (new optional arguments; the six-argument call still works).
   AI words shown in the preview carry the AI-draft badge; the owner approves them by posting (CLAUDE.md #4).
   The autopilot itself stays fully automatic (ADR 0040 §1).
9. **Art is made ahead.** With time left in a tick, the job cuts out dishes that have no art yet (no AI calls),
   so the preview shows them lifted off their photos within minutes of a photo being added.

## Alternatives considered
- **An AI that draws the whole poster, words included** (the ChatGPT / Nano Banana way): not free, garbles
  Bangla, and invents food the restaurant does not serve.
- **Satori or another non-browser renderer**: does not shape Bangla conjuncts (ADR 0040).
- **Cutting out in the owner's browser**: the model is 100–214 MB, too heavy for a phone on mobile data.
- **rembg (Python) on the runner**: the same model, but a second language and toolchain in the repo.
- **AI-drawn floating ingredients** (FLUX.1 [schnell] props, cut out): cheap, but unreviewed pictures could
  show ingredients a dish does not have. Left out; the designs use drawn sparkles, leaves and steam.
- **Full AI scenes from the owner's idea** (rainy window, Eid table) with FLUX.2 [klein]: possible within the
  quota but slow to preview (the job, not the browser, makes them). Next step if the founder wants it.

## Consequences
- New: table `social_dish_art`; `social_posts.design_words`, `social_posts.extra_item_ids` and a check on
  `template`; `social_settings.designs`, `social_settings.show_price`; `request_social_post` with `p_design`,
  `p_words`, `p_extra_items` (migration `20261120000001_social_creative.sql`).
- New dependency `@huggingface/transformers` 4.3.2 (Apache-2.0, Hugging Face, released 2026-10-27), which
  brings `onnxruntime-node` (MIT, Microsoft) and `sharp`. Their install scripts stay denied in
  `pnpm-workspace.yaml` (CPU binaries ship inside the package). Only the job and `scripts/` load it; the web
  app must never import `src/modules/social/cutout.ts` or `jobs/` (a Worker cannot load native modules).
- On a laptop, ONNX Runtime's memory arena and pre-planned memory are switched off, so the 1024×1024 model fits
  in a few GB.
- `pnpm social:preview cutout|posters … [--reel]` draws every design from local photos (needs `CHROME_PATH`).
- Storage: ~50–150 KB of art per dish, kept while the dish keeps its photo.
- Gaps: the Growth preview has not been tried in a browser against the live database (it needs this
  migration applied); AI scenes, festival designs (Eid, Pohela Boishakh) and video are not built (the founder
  will discuss video next).
