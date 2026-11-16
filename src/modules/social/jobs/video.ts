import 'server-only';
import { rm } from 'node:fs/promises';
import { createTranslator } from 'next-intl';
import type { createServiceRoleClient } from '@/lib/db/service-role';
import { aiConfigured } from '@/lib/llm-gateway';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { BD_CALENDAR } from '@/modules/forecasting/outlook';
import { seedOf, type SocialTone } from '../look';
import { dataUrl, renderVideo, shrinkPhoto, withBrowser } from '../render';
import {
  autopilotOrder,
  type AutopilotVideoKind,
  bestSellers,
  dayNumber,
  type DishCandidate,
  KIND_DISHES,
  kindForDishes,
  occasionForDay,
  partnersFor,
  videoKindFor,
  voiceFor,
} from '../schedule';
import { type Mood, pickTrack, scoreVideo, speak, voiceFile } from '../sound';
import type { VideoContent, VideoDish } from '../video';
import { resolveVideoLook, type VideoKind, VideoLookSchema } from '../video-look';
import {
  type AiVideoWords,
  type ApprovedVideoWords,
  ApprovedVideoWordsSchema,
  type Occasion,
  OCCASION_THEME,
  occasionOfCalendarKey,
  OCCASIONS,
  videoWordsFor,
} from '../video-words';
import { MIN_VIDEO_PHOTO_PX } from '../video-rules';
import { agreedPoisha, posterPrice } from '../prices';
import { ApprovedWordsSchema, posterLang } from '../words';
import { checkDishPhoto, SOCIAL_VIDEO_PROMPT, writeSocialVideo } from '../writer';
import {
  type ArtRow,
  artRows,
  bestCut,
  downloadPhoto,
  menuPrices,
  type Photo,
  prepareDish,
} from './art';

/**
 * Makes one short video post (ADR 0061): the autopilot's (slot 1–5, or the daily post on a video day) or
 * the owner's / a manager's own from Growth. Picks the dishes (the owner's, else the autopilot's turn and the
 * dishes customers order with it), checks each photo (food, and big enough for a video), greets a special
 * day, writes the words, reads the hook aloud on some videos, draws every frame, lays music and sounds
 * under it and stores the MP4 and its cover. Publishing is the tick's usual step.
 */
type Supabase = ReturnType<typeof createServiceRoleClient>;

const MEDIA_BUCKET = 'social-media';
/** The longest reading the hook can hold (its 4.8 s, less the 0.3 s start and a breath at the end). */
const MAX_VOICE_S = 4.1;

export interface VideoPostRow {
  id: string;
  org_id: string;
  menu_item_id: string | null;
  extra_item_ids: string[] | null;
  source: 'autopilot' | 'owner';
  angle: string;
  plan_date: string;
  slot: number;
  own_text: string | null;
  design_words: unknown;
  video_kind: string | null;
  video_spec: unknown;
  occasion: string | null;
  occasion_text: string | null;
  offer_poisha: number | null;
  attempts: number;
  status: string;
}

export const VIDEO_POST_COLUMNS =
  'id, org_id, menu_item_id, extra_item_ids, source, angle, plan_date, slot, own_text, design_words, video_kind, video_spec, occasion, occasion_text, offer_poisha, attempts, status';

interface VideoSettings {
  autopilot: boolean;
  language: 'bn' | 'en' | 'both';
  tone: SocialTone;
  color_main: string;
  color_accent: string;
  logo_path: string | null;
  display_name: string | null;
  area: string | null;
  phone: string | null;
  never_item_ids: string[];
  post_item_ids: string[];
  show_price: boolean;
  voice_share: 'none' | 'half' | 'all';
  voice_gender: 'female' | 'male';
  greetings: boolean;
}
const SETTINGS =
  'autopilot, language, tone, color_main, color_accent, logo_path, display_name, area, phone, never_item_ids, post_item_ids, show_price, voice_share, voice_gender, greetings';

interface Dish {
  id: string;
  name: string;
  name_bn: string | null;
  photo_path: string;
  description: string | null;
  base_price_poisha: number;
}

class VideoFail extends Error {
  constructor(
    message: string,
    readonly final: boolean,
  ) {
    super(message);
  }
}

async function fail(
  sb: Supabase,
  post: VideoPostRow,
  message: string,
  final: boolean,
): Promise<false> {
  const attempts = post.attempts + 1;
  await sb
    .from('social_posts')
    .update({
      attempts,
      error: message.slice(0, 500),
      status: final || attempts >= 3 ? 'failed' : post.status,
    })
    .eq('id', post.id);
  return false;
}

/** Moods for the music: the special day first, then the restaurant's tone. */
function moodsFor(tone: SocialTone, occasion: Occasion | null, kind: VideoKind): Mood[] {
  const day: Mood[] = occasion ? ['festive', 'warm'] : [];
  const byTone: Record<SocialTone, Mood[]> = {
    friendly: ['warm', 'upbeat', 'chill'],
    premium: ['cinematic', 'chill', 'warm'],
    fun: ['upbeat', 'playful', 'festive'],
  };
  const byKind: Mood[] = kind === 'versus' || kind === 'combo' ? ['playful'] : [];
  return [...day, ...byKind, ...byTone[tone]];
}

/** The festival on this day of the restaurant's own calendar (a deleted one is not greeted). */
async function festivalOn(sb: Supabase, orgId: string, date: string): Promise<Occasion | null> {
  const { data } = await sb
    .from('calendar_events')
    .select('kind, starts_on, ends_on')
    .eq('org_id', orgId)
    .lte('starts_on', date)
    .gte('ends_on', date);
  for (const e of (data ?? []) as { kind: string; starts_on: string; ends_on: string }[]) {
    const known = BD_CALENDAR.find(
      (c) => c.kind === e.kind && c.starts_on <= date && c.ends_on >= date,
    );
    const occasion = known ? occasionOfCalendarKey(known.key) : null;
    if (occasion) return occasion;
  }
  return null;
}

/** Width and height of a photo, measured in the browser. */
async function photoSize(
  browser: Parameters<Parameters<typeof withBrowser>[0]>[0],
  photo: Photo,
): Promise<{ width: number; height: number }> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return { width: img.naturalWidth, height: img.naturalHeight };
      },
      dataUrl(photo.bytes, photo.mime),
    );
  } finally {
    await page.close();
  }
}

export async function makeVideoPost(sb: Supabase, post: VideoPostRow, at: Date): Promise<boolean> {
  try {
    return await make(sb, post, at);
  } catch (e) {
    if (e instanceof VideoFail) return fail(sb, post, e.message, e.final);
    return fail(sb, post, e instanceof Error ? e.message : 'video_failed', false);
  }
}

async function make(sb: Supabase, post: VideoPostRow, at: Date): Promise<boolean> {
  const [{ data: settingsRow }, { data: org }, { data: profile }] = await Promise.all([
    sb.from('social_settings').select(SETTINGS).eq('org_id', post.org_id).maybeSingle(),
    sb.from('organizations').select('name').eq('id', post.org_id).single(),
    sb.from('org_profile').select('area, city').eq('org_id', post.org_id).maybeSingle(),
  ]);
  if (!settingsRow) throw new VideoFail('no_settings', true);
  const s = settingsRow as VideoSettings;
  if (post.source === 'autopilot' && !s.autopilot) {
    await sb.from('social_posts').update({ status: 'skipped' }).eq('id', post.id);
    return true;
  }
  const restaurant = s.display_name || (org?.name as string) || '';
  const area = s.area || [profile?.area, profile?.city].filter(Boolean).join(', ') || null;
  const own = ownVideoWords(post.design_words);
  const lang = own?.lang ?? posterLang(s.language, dayNumber(post.plan_date) + post.slot);
  const t = createTranslator({
    locale: lang,
    messages: lang === 'bn' ? bn : en,
    namespace: 'social',
  });

  const { data: items } = await sb
    .from('menu_items')
    .select('id, name, name_bn, photo_path, hq_photo_path, description, base_price_poisha')
    .eq('org_id', post.org_id)
    .eq('is_active', true)
    .not('photo_path', 'is', null);
  // A dish's high-quality photo, when someone added one, is used instead of the small menu photo (ADR 0061).
  const all = ((items ?? []) as (Dish & { hq_photo_path: string | null })[]).map(
    ({ hq_photo_path, ...d }) => ({ ...d, photo_path: hq_photo_path ?? d.photo_path }),
  );
  const allowed = all.filter((i) => post.source === 'owner' || !s.never_item_ids.includes(i.id));
  if (allowed.length === 0) throw new VideoFail('no_dish_photos', true);

  // Sales: units of the last 30 days, when each dish was last posted, and what is ordered together.
  const [{ data: qty }, { data: history }, { data: pairRows }] = await Promise.all([
    sb.rpc('metric_item_qty', {
      p_org: post.org_id,
      p_branch: null,
      p_window: 'last_30d',
      p_now: at.toISOString(),
    }),
    sb
      .from('social_posts')
      .select('menu_item_id, extra_item_ids, scheduled_at, music')
      .eq('org_id', post.org_id)
      .in('status', ['ready', 'publishing', 'posted'])
      .order('scheduled_at', { ascending: false })
      .limit(200),
    // Partners of the owner's first dish or of any dish (the autopilot's main dish is chosen below).
    sb.rpc('metric_item_pairs', {
      p_org: post.org_id,
      p_now: at.toISOString(),
      p_item: post.source === 'owner' ? post.menu_item_id : null,
    }),
  ]);
  const sold = new Map(
    ((qty ?? []) as { menu_item_id: string | null; qty: number }[])
      .filter((r) => r.menu_item_id)
      .map((r) => [r.menu_item_id!, Number(r.qty)]),
  );
  const past = (history ?? []) as {
    menu_item_id: string | null;
    extra_item_ids: string[] | null;
    scheduled_at: string;
    music: string | null;
  }[];
  const last = new Map<string, string>();
  for (const h of past)
    for (const id of [h.menu_item_id, ...(h.extra_item_ids ?? [])])
      if (id && !last.has(id)) last.set(id, h.scheduled_at);
  const recentMusic = past
    .map((h) => h.music)
    .filter((m): m is string => Boolean(m))
    .slice(0, 6);
  const pairs = ((pairRows ?? []) as { item_a: string; item_b: string; orders: number }[]).map(
    (p) => ({
      ...p,
      orders: Number(p.orders),
    }),
  );
  const pool: DishCandidate[] = allowed.map((i) => ({
    id: i.id,
    name: i.name,
    sold: sold.get(i.id) ?? 0,
    lastPostedAt: last.get(i.id) ?? null,
  }));
  const top = bestSellers(pool);
  const arts = await artRows(
    sb,
    post.org_id,
    allowed.map((i) => i.id),
  );

  return withBrowser(async (browser) => {
    /** The dish's photo checked (food, big enough) and its cut-out made; null when it cannot be used. */
    const tooSmall: string[] = [];
    const ready = async (dish: Dish): Promise<{ dish: Dish; row: ArtRow; photo: Photo } | null> => {
      const photo = await downloadPhoto(sb, dish.photo_path);
      if (!photo) return null;
      // The size first: a photo too small for a video costs no AI check and no cut-out.
      const size = await photoSize(browser, photo);
      const tiny = Math.min(size.width, size.height) < MIN_VIDEO_PHOTO_PX;
      const small = await shrinkPhoto(browser, photo.bytes, photo.mime, 500);
      const row = await prepareDish(sb, post.org_id, dish, photo, at, {
        known: arts.get(dish.id),
        check:
          aiConfigured() && !tiny
            ? () => checkDishPhoto({ orgId: post.org_id, dish: dish.name, jpeg: small })
            : undefined,
        cut: !tiny,
      });
      await sb
        .from('social_dish_art')
        .update({ photo_width: size.width, photo_height: size.height })
        .eq('org_id', post.org_id)
        .eq('menu_item_id', dish.id);
      arts.set(dish.id, row);
      if (tiny) {
        tooSmall.push(dish.name);
        return null;
      }
      if (aiConfigured() && row.photo_check !== 'ok') return null;
      return { dish, row, photo };
    };

    // The dishes: the owner's, all of them usable, else the autopilot's turn and its partners.
    const picked: { dish: Dish; row: ArtRow; photo: Photo }[] = [];
    let kind: VideoKind;
    if (post.source === 'owner') {
      // A video holds three dishes at most (a video asked for from the poster studio may name four).
      const ids = [post.menu_item_id, ...(post.extra_item_ids ?? [])]
        .filter((x): x is string => !!x)
        .slice(0, 3);
      for (const id of ids) {
        const dish = all.find((d) => d.id === id);
        if (!dish) throw new VideoFail('dish_photo_missing', true);
        const r = await ready(dish);
        if (!r) throw new VideoFail(tooSmall.length ? 'photo_too_small' : 'photo_not_food', true);
        picked.push(r);
      }
      const asked = post.video_kind as VideoKind | null;
      kind =
        asked ?? (picked.length === 1 ? 'showcase' : picked.length === 2 ? 'versus' : 'carousel');
    } else {
      const planned: AutopilotVideoKind =
        (post.video_kind as AutopilotVideoKind | null) ?? videoKindFor(post.plan_date, post.slot);
      // The usual turn (ADR 0058), leaving out dishes another post of the same day already shows.
      const order = autopilotOrder(pool, new Set(s.post_item_ids ?? [])).map((o) => o.dish);
      const { data: sameDay } = await sb
        .from('social_posts')
        .select('menu_item_id, extra_item_ids')
        .eq('org_id', post.org_id)
        .eq('plan_date', post.plan_date)
        .neq('id', post.id)
        .in('status', ['ready', 'publishing', 'posted']);
      const today = new Set(
        ((sameDay ?? []) as { menu_item_id: string | null; extra_item_ids: string[] | null }[])
          .flatMap((r) => [r.menu_item_id, ...(r.extra_item_ids ?? [])])
          .filter((x): x is string => Boolean(x)),
      );
      const fresh = order.filter((d) => !today.has(d.id));
      const turn = fresh.length ? fresh : order;
      for (const cand of turn.slice(0, 4)) {
        const r = await ready(allowed.find((d) => d.id === cand.id)!);
        if (r) {
          picked.push(r);
          break;
        }
      }
      if (picked.length === 0)
        throw new VideoFail(tooSmall.length ? 'photo_too_small' : 'photo_not_food', true);
      const want = KIND_DISHES[planned] - 1;
      for (const id of partnersFor(picked[0]!.dish.id, pairs, pool, want + 3)) {
        if (picked.length > want) break;
        const r = await ready(allowed.find((d) => d.id === id)!);
        if (r) picked.push(r);
      }
      kind = kindForDishes(planned, picked.length);
    }
    const main = picked[0]!.dish;

    // The special day: the owner's choice, else the restaurant's calendar or Friday.
    let occasion: Occasion | null = null;
    if (post.occasion && (OCCASIONS as readonly string[]).includes(post.occasion))
      occasion = post.occasion as Occasion;
    else if (post.source === 'autopilot')
      occasion = occasionForDay(
        post.plan_date,
        s.greetings,
        await festivalOn(sb, post.org_id, post.plan_date),
      );
    const greeting =
      occasion === 'custom'
        ? (post.occasion_text ?? '').trim()
        : occasion
          ? t(`video.occasions.${occasion}`)
          : '';

    // The one fact the words may lean on (CLAUDE.md #1).
    const nameOf = (d: Dish) => (lang === 'bn' && d.name_bn?.trim() ? d.name_bn.trim() : d.name);
    const together =
      picked.length > 1 &&
      pairs.some(
        (p) =>
          [p.item_a, p.item_b].includes(main.id) &&
          [p.item_a, p.item_b].includes(picked[1]!.dish.id),
      );
    const fact = together
      ? `Customers here often order ${picked[0]!.dish.name} together with ${picked[1]!.dish.name}.`
      : top.has(main.id)
        ? `${main.name} is one of the most ordered dishes at this restaurant this month.`
        : post.source === 'owner'
          ? `The owner wants to tell people about ${picked.map((p) => p.dish.name).join(' and ')}.`
          : `A spotlight on ${picked.map((p) => p.dish.name).join(' and ')} from the menu.`;

    let ai: (AiVideoWords & { model: string; promptVersion: number }) | null = null;
    if (aiConfigured() && !(own?.hook && own?.tagline && own?.caption_bn && own?.caption_en)) {
      try {
        ai = await writeSocialVideo({
          orgId: post.org_id,
          restaurant,
          dishes: picked.map((p) => p.dish.name),
          kind,
          fact,
          occasion: greeting || null,
          ownNote: post.own_text,
          tone: s.tone,
          area,
        });
      } catch {
        // An answer with a made-up number (or none at all) falls back to the app's own fixed lines.
        ai = null;
      }
    }
    const words = videoWordsFor(
      lang,
      ai,
      own,
      {
        hook: t('video.defaults.hook'),
        punch: t('video.defaults.punch'),
        question: t('video.defaults.question'),
        tagline: t('video.defaults.tagline'),
      },
      t('poster.cta'),
    );

    // An offer is the owner's own price, shown only below the menu price every branch agrees on (the
    // poster rule); otherwise the video is a plain showcase and says no price it cannot stand behind.
    let offerText: { was: string; now: string } | null = null;
    if (kind === 'offer') {
      const [{ data: branchRows }, { data: orgSettings }] = await Promise.all([
        sb
          .from('branch_item_prices')
          .select('price_poisha')
          .eq('org_id', post.org_id)
          .eq('menu_item_id', main.id)
          .is('variant_id', null)
          .eq('is_available', true),
        sb
          .from('org_settings')
          .select('price_includes_vat')
          .eq('org_id', post.org_id)
          .maybeSingle(),
      ]);
      const input = {
        basePoisha: Number(main.base_price_poisha),
        branchPoisha: ((branchRows ?? []) as { price_poisha: number }[]).map((b) =>
          Number(b.price_poisha),
        ),
      };
      const agreed = agreedPoisha(input);
      const vat = {
        included: (orgSettings?.price_includes_vat as boolean | undefined) ?? true,
        plusVat: t('poster.plusVat'),
      };
      const offer = Number(post.offer_poisha ?? 0);
      if (agreed !== null && offer > 0 && offer < agreed) {
        offerText = {
          was: posterPrice(input, lang, vat)!,
          now: posterPrice({ basePoisha: offer, branchPoisha: [] }, lang, vat)!,
        };
      } else kind = 'showcase';
    }
    // Prices only from the menu, and only when every branch agrees (the poster rule).
    const prices = s.show_price
      ? await menuPrices(
          sb,
          post.org_id,
          picked.map((p) => p.dish),
          lang,
          t('poster.plusVat'),
        )
      : new Map<string, string | null>();
    const dishes: VideoDish[] = [];
    for (const [i, p] of picked.entries()) {
      const cut = await bestCut(sb, p.row);
      const photo = await shrinkPhoto(browser, p.photo.bytes, p.photo.mime, i === 0 ? 1400 : 900);
      const menuPrice = prices.get(p.dish.id) ?? null;
      const isOffer = i === 0 && offerText;
      dishes.push({
        name: nameOf(p.dish),
        cutUrl: cut ? dataUrl(cut, 'image/webp') : null,
        photoUrl: dataUrl(photo, 'image/jpeg'),
        price: isOffer ? offerText!.now : menuPrice,
        was: isOffer ? offerText!.was : null,
        note: p.dish.description?.trim() || null,
      });
    }
    let logoUrl: string | null = null;
    if (s.logo_path) {
      const logo = await downloadPhoto(sb, s.logo_path);
      if (logo) logoUrl = dataUrl(logo.bytes, logo.mime);
    }

    // The look: the one the owner previewed, else one from the post's own seed.
    const previewed = VideoLookSchema.safeParse(post.video_spec ?? undefined);
    const look =
      previewed.success && previewed.data.kind === kind
        ? previewed.data
        : resolveVideoLook(
            seedOf(`${post.org_id}:${post.id}`),
            { tone: s.tone, dishes: dishes.length, offer: kind === 'offer', hot: true },
            kind,
          );

    // The voice on some videos (the owner's setting), reading the hook; the hook stays on screen as long
    // as the voice needs.
    const wantVoice =
      post.source === 'owner'
        ? s.voice_share !== 'none'
        : voiceFor(s.voice_share, post.plan_date, post.slot);
    const voiceTmp = voiceFile();
    let voice = wantVoice
      ? await speak(
          greeting ? `${greeting}! ${words.hook}` : words.hook,
          lang,
          s.voice_gender,
          voiceTmp,
        )
      : null;
    // The hook holds at most 4.8 s: a longer reading drops the greeting, then the voice.
    if (voice && voice.seconds > MAX_VOICE_S && greeting)
      voice = await speak(words.hook, lang, s.voice_gender, voiceTmp);
    if (voice && voice.seconds > MAX_VOICE_S) voice = null;
    const content: VideoContent = {
      look,
      words,
      labels: { or: t('video.or'), onlyAt: t('video.onlyAt'), now: t('video.now') },
      restaurant,
      area,
      phone: s.phone,
      colorMain: s.color_main,
      colorAccent: s.color_accent,
      logoUrl,
      dishes,
      seconds: voice ? 12 : 11,
      hookSeconds: voice ? Math.max(2.2, voice.seconds + 0.7) : 2.2,
      occasion: occasion ? { greeting, theme: OCCASION_THEME[occasion] } : null,
    };
    const made = await renderVideo(browser, content);
    const track = await pickTrack(moodsFor(s.tone, occasion, kind), post.id, recentMusic);
    const mp4 = await scoreVideo(made.mp4, {
      seconds: made.plan.seconds,
      track,
      voice,
      voiceAt: 0.3,
      hits: made.plan.hits,
    }).finally(() => rm(voiceTmp, { force: true }));

    const folder = `${post.org_id}/${post.id}`;
    const videoPath = `${folder}/video.mp4`;
    const coverPath = `${folder}/cover.jpg`;
    await upload(sb, videoPath, mp4, 'video/mp4');
    await upload(sb, coverPath, made.cover, 'image/jpeg');

    const caption = (l: 'bn' | 'en') =>
      own?.[`caption_${l}`]?.trim() ||
      ai?.[`caption_${l}`]?.trim() ||
      createTranslator({ locale: l, messages: l === 'bn' ? bn : en, namespace: 'social.video' })(
        'defaults.caption',
        {
          restaurant,
          dishes: picked
            .map((p) =>
              l === 'bn' && p.dish.name_bn?.trim() ? p.dish.name_bn.trim() : p.dish.name,
            )
            .join(', '),
        },
      );
    const captionBn = s.language === 'en' ? null : caption('bn');
    const captionEn = s.language === 'bn' ? null : caption('en');
    const { error } = await sb
      .from('social_posts')
      .update({
        status: 'ready',
        format: 'video',
        menu_item_id: main.id,
        extra_item_ids: picked.slice(1).map((p) => p.dish.id),
        fact,
        headline: greeting || words.hook,
        tagline: words.tagline,
        caption_bn: captionBn ?? captionEn,
        caption_en: captionEn ?? captionBn,
        template: `video_${kind}`,
        video_kind: kind,
        video_spec: look,
        occasion,
        voice: Boolean(voice),
        music: track?.id ?? null,
        poster_path: coverPath,
        video_path: videoPath,
        model: ai?.model ?? (own ? 'owner' : 'fixed'),
        prompt_version: ai ? `${SOCIAL_VIDEO_PROMPT.key}@${ai.promptVersion}` : null,
        error: tooSmall.length ? `photo_too_small:${tooSmall.join(', ')}`.slice(0, 500) : null,
      })
      .eq('id', post.id)
      .eq('status', 'planned');
    if (error) throw error;
    return true;
  });
}

/**
 * The words the owner approved: the video studio's own, or (for a video asked for from the poster studio)
 * the poster's hook, tagline and captions in the poster's language.
 */
function ownVideoWords(raw: unknown): ApprovedVideoWords | null {
  const video = ApprovedVideoWordsSchema.safeParse(raw ?? undefined);
  if (video.success) return video.data;
  const poster = ApprovedWordsSchema.safeParse(raw ?? undefined);
  if (!poster.success) return null;
  const w = poster.data;
  const lang = w.poster_lang ?? 'bn';
  return {
    lang,
    hook: (lang === 'bn' ? w.hook_bn : w.hook_en) || undefined,
    tagline: (lang === 'bn' ? w.tagline_bn : w.tagline_en) || undefined,
    caption_bn: w.caption_bn || undefined,
    caption_en: w.caption_en || undefined,
  };
}

async function upload(sb: Supabase, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await sb.storage
    .from(MEDIA_BUCKET)
    .upload(path, bytes, { contentType, upsert: true, cacheControl: '3600' });
  if (error) throw error;
}
