# Xedine Vision AI — research and plan

- Date: 2026-11-09
- Status: proposal. Nothing here is built or accepted yet. ADR 0043 gets written once the decisions in §12 are made.
- How to read the claims: **Measured** = I ran it. **Sourced** = linked at the point of use. **Estimate** = my own arithmetic or judgement, with the assumption stated.

## 1. The short answer

**Worth building, and it can start at ৳0, but not as the product the name suggests.**

The strongest version does not try to make cameras "understand" everything. Xedine already knows every void, refund, discount, order and kitchen time. The camera only has to answer: *what was happening at that moment?* A foreign competitor has to integrate with someone else's POS to get that. Xedine owns it.

| # | Capability | Can we do it at ৳0? | How good will it be | Ships in |
| --- | --- | --- | --- | --- |
| 1 | Fraud & transaction alerts | Yes | **High** for "show me the clip of this void". **Medium** for "table occupied, no bill". **Not possible yet** for "cashier pocketed cash" | V1, V2 |
| 2 | Queue & customer flow | Yes | **Medium.** Good for trends and busy-hour patterns, not exact counts | V2 |
| 3 | Delivery & pickup | Yes | **Medium.** Rider waiting time works. Checking what is inside the bag does not | V2 |
| 4 | Kitchen intelligence | Partly | **High** for "someone was in the kitchen at 2 am". **Medium** for "station empty while tickets pile up". **Low** for gloves or hygiene without our own training data | V2, V5 |
| 5 | Daily profit-leak report | Yes | **High.** This is the existing morning brief with new evidence | V3 |
| 6 | AI CCTV search | Yes | **High** by bill or time. **Medium** by typed words | V1, V4 |

**Three findings that shaped this plan:**

1. **Free cloud AI cannot see the footage.** Google's terms for the free Gemini tier say ["Do not submit sensitive, confidential, or personal information to the Unpaid Services"](https://aistudio.google.com/docs/terms), and human reviewers may read what you send. Staff and customer faces are personal data. So the free design runs the vision AI on a computer inside the restaurant.
2. **The law is the biggest risk, not the technology.** The Personal Data Protection Act 2026 is new, and I found nothing that says how it treats CCTV (§8). Sell only after a lawyer has read §8.
3. **Most alerts will be false, even with a good model.** Say 1 table session in 200 is really unbilled, the detector catches 90% of those, and it wrongly flags 2% of honest ones. Then only about **1 alert in 5 is real** (0.45% ÷ (0.45% + 1.99%), illustrative figures). So Xedine must never say "theft". It says "worth checking" and shows the clip.

**What "free" really means:** ৳0 gets you through development and a pilot at one or two friendly restaurants. It is not free forever. Each restaurant needs a computer running on site, each install needs your time and travel, and free cloud tiers are too small for a real business (§7).

## 2. What I actually tested

A throwaway test on your PC (Ryzen 5 5600G, CPU only, GPU not used). The photos were shrunk to 640×360 at low JPEG quality to look like a DVR's low-quality stream. Scripts and results are in `E:\xedine-vision-spike\`, and the repo was not touched.

| Test (Measured) | Result |
| --- | --- |
| YOLOX-Nano person detector, 1 CPU core | **16.4 ms** per frame |
| YOLOX-Tiny, 1 core / 4 cores | 60.6 ms / 23.6 ms |
| YOLOX-S at 640 px, 1 core / 4 cores | 240.2 ms / 76.3 ms |
| CLIP image-to-search-index (compressed model, 4 cores) | 18.6 ms per frame |
| CLIP reading a typed search (4 cores) | 11.9 ms |
| Memory with the detector and CLIP loaded | about 390 MB |
| Decoding synthetic 640×360 video, 1 core | about 0.5 ms per frame |
| 15-second event clip at about 400 kbps, cut without re-encoding | **0.8 MB** |
| Typed search across 19 photos | Right photo first on **4 of 5** searches. It missed "a line of people waiting at a counter" |

**What this proves:** the AI is light enough. Four cameras at 2 frames per second gives 125 ms per frame, and Nano needs about 17 ms including decoding. Even on a PC 5× slower than yours (my assumption) it needs about 85 ms on one core.

**What it does not prove:** accuracy on real restaurant footage. Those were 19 internet photos, some badly labelled, and I had no real DVR to connect to. I did not test a live camera connection, night or dim light, crowded rooms, or a weak POS PC. Phase V0 exists to test exactly those.

**Published evidence on accuracy is sobering.** A [2020 study on existing restaurant cameras](https://www.ieice.org/ken/paper/20201201nCBp/eng/) (older YOLOv3 + Deep SORT) reached 82.76% on quiet days and 66.17% overall when people were packed together. I found no independent false-alarm figure for detecting cash theft from CCTV.

## 3. The six capabilities

### 3.1 Fraud & transaction alerts

| Feature | How | Rating |
| --- | --- | --- |
| **Clip attached to every void, refund and discount** | The till event already exists. The site computer saves the 15 seconds around it. No AI needed | High, ships first |
| **Void after the food went out** | `void.after_kot` already exists. Add the clip | High |
| **Table occupied, no bill** | Person detected at table zone for over N minutes, with no open order on `dining_tables` | Medium, the best new leak detector here |
| **Counter visitors vs bills** | People served at the counter compared with the bills rung up, per hour | Medium, a trend only |
| **Manager approved, but no second person at the till** | One person in the till zone when a manager PIN was used (ADR 0014) | Medium, later |
| **Cash pocketed, or cash handed over without a bill** | Needs hands and notes visible, which ceiling CCTV rarely gives | **Do not promise** |

Xedine has no cash drawer signal, because it prints through the browser and never opens the drawer. "Drawer opened with no sale" cannot be built until a local print bridge exists.

### 3.2 Queue & customer flow

- Owner draws zones on a camera snapshot: door, queue, counter, tables.
- Measures people in queue, rough wait, busy hours, table turnover, and walk-ins compared with bills.
- Target: within ±1 person for queues of up to 6. Crowded rooms will be worse, so show a band ("around 8–12") and never a false exact number.
- No tracking of a person between visits, and no age or gender guessing.

### 3.3 Delivery & pickup

- **Rider waiting time:** time a person stays in the pickup zone, matched against the order's `ready` time.
- **Orders sitting ready too long:** needs a new "handed over" step on the till, because `order_status` stops at `ready → served → completed`. One tap, and the camera checks it.
- **foodpanda and Pathao bags:** brand colour is visible in sample photos, so possible later, but unproven.
- **Wrong or missing item in the bag:** Agot does this with [dedicated overhead kitchen cameras](https://techcrunch.com/2022/02/11/agot-ai-gives-restaurants-computer-vision-to-see-where-food-orders-go-wrong) and funded training. **Not for us.**

### 3.4 Kitchen intelligence

| Feature | Rating |
| --- | --- |
| Someone in the kitchen or store after closing, using the branch's closing hours | High, cheap and valuable |
| Station empty while `service.ticket_time` is climbing | Medium |
| End-of-day cleanliness check by photo, on tap | Medium, paid AI or manual look |
| Gloves, hair cover, handwashing ([Wobot sells this](https://help.wobot.ai/en/category/getting-started-gcytdj/)) | Low until we have our own labelled footage |
| Portion size, plate waste | No. Recipes and stock already cover this with better numbers |
| Fire or gas alarm | **Never.** Xedine must not become a safety system it cannot guarantee |

Kitchen cameras may simply not exist. Many restaurants point cameras at the till and door. I found no data on this for Bangladesh, so V0's site check matters.

### 3.5 Daily profit-leak report

The existing findings table, morning brief and Telegram/WhatsApp delivery, with camera evidence added. Example:

> **Worth checking today (3)**
> Table 6, 21:10: people seated 42 minutes, no bill. ▶ clip
> Void of ৳480 after the food left the kitchen, 22:05. ▶ clip
> Kitchen light activity 02:14 after closing. ▶ clip

**The money rule, so non-negotiable #1 stays true:**

- ৳ appears only on items tied to a till record (void ৳480), and only for `can_see_money` roles.
- Camera-only items show counts, never ৳, until the owner opens the clip and marks it **confirmed**. Only then does a metric function value it.
- The LLM receives finished metric results as text, never images. The numeric validator applies as usual.

### 3.6 AI CCTV search

| Level | Example | Needs AI? | Rating |
| --- | --- | --- | --- |
| 1. By record | Tap any bill or void, see the moment | No | High |
| 2. By filter | "Kitchen, after midnight, last 7 days" | Only the counts already collected | High |
| 3. By typed words | "Rider with a pink box" | Local CLIP | Medium |

CLIP understands English, so a Bangla or Banglish question gets translated first through the existing text-only gateway. [Frigate's docs](https://docs.frigate.video/configuration/semantic_search) warn that these scores are too inconsistent for automation, so typed search only ever finds footage. It never raises an alert.

## 4. Competitors

| Company | What it does | Price found | Lesson |
| --- | --- | --- | --- |
| [Solink](https://solink.com/solutions/full-service-restaurant) | Pairs POS voids/refunds with video, works with existing cameras | [From about $175/location/month](https://www.getapp.ca/software/113721/solink-loss-prevention-system) per third-party listings, about ৳21,000. Not confirmed by Solink, and [real quotes are custom](https://www.spot.ai/blog/solink-pricing-2026) | **Proof of the V1 idea.** Its signature feature needs no fancy AI |
| DTiQ | Video + POS loss prevention, claims 40,000+ locations | [None published](https://www.trustradius.com/products/dtiq-video-analytics/pricing) | Same category, mature |
| [Spot AI](https://www.spot.ai/blog/solink-pricing-2026) | AI layer over existing cameras | Tiered per camera, no figure found | Software-only is viable |
| [Wobot](https://yourstory.com/2019/10/foodtech-irctc-cultfit-clients-wobot-ai-detect-food-hygiene) (India) | Kitchen hygiene on existing CCTV | ₹250/camera/model/month **in 2019**, no current price | Closest regional price signal |
| [Agot](https://techcrunch.com/2022/02/11/agot-ai-gives-restaurants-computer-vision-to-see-where-food-orders-go-wrong) | Order accuracy with overhead kitchen cameras | None found | Press called it ["deeply unsettling"](https://thetakeout.com/startup-wrong-food-drive-thru-order-1847695904). Staff backlash is real |
| [Sigmind](https://solve.mit.edu/solutions/10355) (Dhaka) | Video analytics, face ID, retail counts. Self-reported, replaces the NVR box | None found | The only local player I found. Not restaurant-focused or tied to a POS |
| Presto Vision | Dining room analytics | None found | [Older coverage](https://thetakeout.com/outback-ai-nannycam-surveillance-presto-vision-1839103568), also drew a privacy backlash |

I could not verify Hoptix or PreciTaste. **I found no one in Bangladesh combining a POS and camera analytics at local prices,** but a search cannot prove there is none.

## 5. Tools: what to use at ৳0

| Job | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Person detection | **[YOLOX-Nano](https://github.com/Megvii-BaseDetection/YOLOX)** (Apache-2.0), then [RF-DETR Nano](https://github.com/roboflow/rf-detr) (Apache-2.0) if accuracy needs it | Free for commercial use. 16 ms measured | **Ultralytics YOLO:** [AGPL or paid licence](https://ultralytics.com/license), and they claim that covers models you train too |
| Running models | ONNX Runtime, CPU | Runs on an ordinary Windows PC. Installed cleanly in the test | |
| Video | ffmpeg | Already proven. Reads standard [Hikvision](https://nic.teamdynamix.com/TDClient/2965/ITPortal/KB/Article/137706/Hikvision-RTSP-setup) and [Dahua](https://monitoreal.com/?p=20929) streams | |
| Typed search | CLIP (MIT), local | 19 ms per frame, data stays on site | |
| Reference design | [Frigate](https://docs.frigate.video/frigate/hardware) (MIT) | Learn from it, including its [N100 timings](https://docs.frigate.video/frigate/hardware) (about 25–30 ms) | As the base: needs Linux, and restaurant PCs run Windows |
| On-tap AI look at one photo | Paid later, or [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/privacy/) | Cloudflare says it does not train on customer content. [10,000 free units a day](https://developers.cloudflare.com/workers-ai/platform/pricing/), about 500 photo checks a day **across all customers** (Estimate: Llama 3.2 Vision, 2,000 tokens in, 150 out) | **Gemini free tier:** its terms forbid personal data. Groq: free limits unverified, and vision models change often |
| Clip storage | [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/) | 10 GB free, no download fees | Cloudflare's CDN for video: [its terms restrict that](https://www.cloudflare.com/service-specific-terms-application-services/) on free plans |
| Reaching the site | **Outbound only** from the site computer | No router changes. Works behind shared ISP addresses | Port-forwarding the DVR: a security hole. Cloudflare Tunnel: not needed |

Paid fallback for AI looks: Gemini 2.5 Flash-Lite at [$0.10 per million input tokens](https://aistudio.google.com/docs/pricing), and paid-tier content is not used to improve Google's products. Twenty photos a day comes to well under ৳50 per branch per month (Estimate), but sending footage abroad still has to clear §8.

## 6. Architecture

```
 RESTAURANT (Bangladesh)                         XEDINE CLOUD (existing)
 Cameras → DVR (keeps the original footage)
            │ low-quality stream, local network only
            ▼
 Vision Box (a small program on a PC already on site)
   • motion check → person detector → zone counts
   • rolling 30-minute video buffer on disk
   • local search index (CLIP), never leaves the site
   • offline queue with idempotency keys
            │ outbound HTTPS only ───────────►  /api/vision/* (device token, ADR 0013 style)
            │   5-minute counts, events         vision_* tables (RLS) → metric functions
            │   a 15 s clip only when needed    private clips → owner, signed short-lived links
            ◄── polls: "cut this clip", "search" findings → morning brief → Telegram/WhatsApp
```

**Till event → clip:** the void is recorded → the cloud queues a clip request with the event time → the Box polls within 60 seconds → it cuts 15 seconds from its buffer → uploads → the clip is attached to the finding.

**Design choices that matter:**

- **Clock drift is the silent killer.** DVR and till clocks disagree. The Box uses its own recording, stamped with its own synced clock, so the DVR's clock stops mattering.
- **DVR passwords never leave the site.** They are encrypted with Windows' built-in protection on that PC.
- **Low-quality stream only** to save CPU and bandwidth. Bangladesh's [frequent load-shedding](https://www.dhakatribune.com/bangladesh/power-energy/408367/bangladesh%E2%80%99s-telecom-backbone-near-breaking-point) makes this offline design necessary: counts queue up and sync later, same pattern as the POS outbox.

**How it follows the Xedine rules:**

| Rule | How |
| --- | --- |
| #1 Numbers | Detector output is sensor data. Every displayed figure comes from a new `vision.*` metric in METRICS.md |
| #2 Tenancy | New tables `vision_boxes`, `vision_cameras`, `vision_zones`, `vision_counts_5m`, `vision_events`, `vision_clips`, `vision_requests`, all registered with the policy engine |
| #3 Time | The Box uses an injected clock. Business day and cutoff handled in the cloud |
| #4 Draft → approve | Alerts go only to the owner. Nothing is ever sent to staff automatically |
| #5 Audit | Every clip view, zone change, and switch on/off goes to `audit_log` |
| #6 i18n | All strings in `bn` and `en`. Words like "theft" are banned from copy |
| #8 PII | No faces stored as identity. Footage never enters LLM prompts |
| #10 Money | Till-linked ৳ stays in the money-gated findings tables |

**New, because managers might be the ones on camera:** clips are **owner-only by default**, and owner must opt in to share. Off by default as a Settings switch (ADR 0024). Switching on requires the owner to tick: staff informed, signs up, toilets and prayer or changing areas excluded.

**Repo:** `src/modules/vision` for cloud logic, `edge/vision-box/` (Python) for the site program.

**Gaps in today's code (checked):** no signed private-file links anywhere in `src/`; no "handed over" order state; no drawer signal; no on-site agent of any kind.

## 7. Costs

**Getting to a pilot (Estimate):**

| Item | Cost |
| --- | --- |
| Models, ffmpeg, runtime | ৳0 |
| Development on your PC | ৳0, but **your C: drive has only 0.8 GB free**. Work on E: |
| Test camera | ৳0: an old phone with a free IP-camera app |
| Site computer | ৳0 if the restaurant has a PC to spare |
| Clip storage | ৳0: 15 s × 20 a day × 14 days ≈ 224 MB per branch, so R2's free 10 GB fits roughly 40 branches |
| Counts in the database | About 14 MB per branch for 90 days (768 rows a day, assuming 200 bytes each). Check the shared database's current size first |
| AI wording of the report | Existing gateway, a few extra lines |
| **Total cash** | **৳0**, plus your transport to the restaurant |

**What stops being free:**

| When | What | Rough cost |
| --- | --- | --- |
| A restaurant has no spare PC | A small PC. A [MeLE N100 listing](https://www.bdstall.com/details/mele-quieter-4c-celeron-n100-12th-gen-mini-pc-153401/) showed ৳25,000, with no sellers listed, so treat as stale. Customer buys it | ৳25,000+ once |
| Paying customers | Supabase and Vercel paid plans, already expected in ADR 0008 | About ৳5,500/month total |
| Before selling | A lawyer's review of §8 | Ask for a favour or budget for it. **The one thing I would not skip** |
| More than about 40 branches | R2 beyond free | Trivial per branch |
| Every install | Your time: site check, drawing zones, fixing a DVR that won't connect | The real cost. Limits how many you can serve alone |

Heads-up on free plans: limits have changed repeatedly and sources disagree (blogs quote Supabase's free file storage as either 1 GB or 500 MB). Check the [live pricing page](https://supabase.com/pricing) before relying on any of them.

## 8. Law and privacy

**I am not a lawyer, and this is the weakest-sourced section.** I read the English text of the [2025 Ordinance](https://www.dpo-india.com/Resources/Privacy_Regulations_in_Asia_Pacific_Countries/Bangladesh-Personal-Data-Protection-Ordinance,2025(Ordinance.No.61-2025).pdf). It has since been replaced by the Personal Data Protection Act 2026 (Act 63, April 2026, per [Securiti](https://securiti.ai/bangladesh-personal-data-protection-act-overview/) and a [law journal article](https://doi.org/10.69971/lra.4.3.2026.195)), and I could not find an authentic text of the Act. All of this is `TODO(verify)`.

What the sources say:

- **It covers "monitoring"** of people in Bangladesh, even from abroad (Ordinance s.1).
- **"Facial images" are named as biometric data** (s.2(15)), and biometric data is sensitive, needing specific consent or another listed ground (s.7).
- **Consent is the main basis.** The list of alternatives (s.5(3)) includes contracts, legal claims and employment-law rights. **There is no general "legitimate business interest" ground**, which is what CCTV relies on in other countries.
- **Moving data abroad is restricted.** Sources disagree on how far the in-country copy rule reaches after the [February 2026 amendment](https://digitalpolicyalert.org/change/18757-personal-data-protection-amendment-ordinance-2026-ordinance-no-23-of-2026).
- **Fines reportedly reach ৳25–50 lakh,** per Securiti's summary.
- **The restaurant is the controller and Xedine the processor,** so a written contract is needed.
- **Nothing I found addresses CCTV specifically.** How a customer "consents" by walking past a sign is the biggest open question.

**The safe-by-design defaults:**

| Choice | Why |
| --- | --- |
| **No face recognition, ever.** Who did it comes from the till PIN | Avoids the most heavily regulated category and the worst backlash |
| Footage stays on the DVR and Box in Bangladesh | Only short evidence clips leave, and only when needed |
| 14-day clip retention, then automatic deletion | Storage limitation |
| Bangla signs at the entrance, supplied by Xedine | Common practice elsewhere. Whether a sign is enough here is unverified |
| Written notice signed by staff | Evidence of consent, where the burden of proof sits with the controller (s.5(4)) |
| No cameras analysed in toilets, prayer or changing areas | Dignity, and a hard block in setup |
| Alerts say "worth checking", with staff able to respond | No automatic punishment. Most alerts will be false (§1) |
| Option to blur faces in uploaded clips | Worth building if a lawyer says clips are biometric |

## 9. Business opportunity

- **Pitch:** "Your CCTV already records everything. Nobody watches it. Xedine shows you the 3 moments today that cost you money."
- **No new cameras:** this is what makes it sellable here.
- **Starting price to test (Estimate):** **৳1,500 per branch per month** as a Growth add-on, free during the pilot. ADR 0008's "2× value" rule means it must evidence ৳3,000 a month, which is 0.25% of a ৳12 lakh/month restaurant's sales.
- **Margin:** cloud cost per branch is close to zero at small scale. Support time is the true cost.
- **Stickiness:** every clip ties to Xedine till data, so a generic camera vendor can't copy it without also replacing the POS.
- **Land-and-expand:** a camera add-on can also bring in restaurants that came for the leak-catching and then adopt the POS. But V1 only works where Xedine's till is in use.

**What I could not find:** the number of restaurants in Bangladesh, how many have CCTV, or local theft rates. US figures exist ([56% of servers in one 1,049-location study](https://www.insurancejournal.com/magazines/mag-editorsnote/2019/10/07/544534.htm) committed identifiable theft at least once) but should not be quoted to Bangladeshi owners as local fact. Ask five owners instead. I have deliberately not invented a market size.

## 10. Build plan

Thin slices, each with its own migration, RLS, logic, UI and tests. Times assume you alone and are estimates.

| Phase | What ships | Time | Done when |
| --- | --- | --- | --- |
| **V0 Prove it** | No product code. Visit 3 restaurants, connect to their DVRs, and record 2 days at 1 site with written permission | 1–2 weeks | Gate below passes |
| **V1 Till → clip** | Vision Box, device pairing, clips on voids/refunds/discounts, tap-a-bill search, owner-only viewing, consent gate | 3–4 weeks | Clip shows the right moment within ±5 s in 19 of 20 checks. Zero clips cross tenants |
| **V2 Zones & counts** | Draw zones. People in queue, rider wait, table-no-bill, after-hours | 3–4 weeks | Planted scenarios recovered (below). Under 5 false alerts a day at the pilot |
| **V3 Report** | Camera evidence in findings and morning brief, `vision.*` metrics, assistant tools | 1–2 weeks | Golden-number AI evals pass |
| **V4 Typed search** | Local CLIP, Bangla translated first, optional on-tap photo check | 2–3 weeks | The right moment in the top 5 for 7 of 10 real questions |
| **V5 Kitchen extras** | Station-empty vs ticket time, then gloves/hygiene if there is labelled footage | Later | Only if owners ask |

**V0 go/no-go gate.** Stop or redesign if any fails:

1. The DVR stream is reachable at **2 of 3** sites. Cheap unbranded DVRs are the main unknown.
2. Person-in-zone is right **90%+** of the time on 200 hand-checked frames, including evening light.
3. Under **50%** of the spare PC's CPU with 4 cameras.
4. **At least 1 owner** says a clip showed something they would pay to know.
5. Owner and staff accept the notice without serious objection.

**Test oracle (matches the repo's rule):** extend the seed with fake detector event streams that have planted truth:

- V1: unbilled table session
- V2: after-hours presence
- V3: long rider wait
- V4: queue spike
- V5: a clean restaurant with no alerts (no false positives)
- V6: a void with a matching clip window

Real accuracy is checked separately against the hand-labelled V0 footage, which also becomes the regression set.

## 11. Main risks

| Risk | Chance | What to do |
| --- | --- | --- |
| Law turns out stricter than assumed | Medium | Local-first design, no faces, lawyer before selling |
| Staff feel spied on, or someone is wrongly accused | High if handled badly | Owner-only, "worth checking", signed notice, no staff rankings from camera |
| Too many false alarms, owner stops looking | High | Cap daily alerts, start with V1 where every alert is a real till event |
| Cheap DVRs won't connect | Medium | V0 finds out. Otherwise a supported-brands list |
| No spare PC on site | Medium | Lightweight V1 mode with no AI, or customer buys a small PC |
| Poor camera angle or dim light | High | Snapshot check during setup. Say honestly what each camera can do |
| Supporting installs eats all your time | High | Stay at 3–5 pilots until setup is self-serve |
| Distraction from selling the core product | Medium | Do V0, then decide. V0 costs no product code |

## 12. Decisions needed

1. **Scope:** start with V0 and V1 only (**recommended**), or go for all six at once?
2. **Face policy:** no face recognition ever (**recommended**)?
3. **Who sees clips:** owner-only by default (**recommended**), or managers too?
4. **Pilot:** which 3 restaurants can you visit, and is there one where Xedine's till is live?
5. **Legal:** who can review §8 before the first paid customer?
