import 'server-only';
import { createTranslator } from 'next-intl';
import type { createServiceRoleClient } from '@/lib/db/service-role';
import { aiConfigured } from '@/lib/llm-gateway';
import { addDays, businessDate } from '@/lib/time/business-date';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { improveDishPhoto } from '../image-ai';
import {
  createInstagramContainer,
  instagramContainerStatus,
  MetaError,
  publishFacebookPhoto,
  publishFacebookReel,
  publishInstagramContainer,
} from '../meta';
import { dataUrl, renderPoster, renderReel, shrinkPhoto, withBrowser } from '../render';
import {
  refreshTikTokToken,
  startTikTokPost,
  TikTokError,
  tiktokPublishStatus,
  type TikTokMode,
} from '../tiktok';
import {
  angleForDay,
  designForDay,
  formatForDay,
  isPostingDay,
  pickDish,
  slotAt,
  type PostAngle,
  type SocialFormat,
} from '../schedule';
import type { PostContent } from '../templates';
import { checkDishPhoto, SOCIAL_POST_PROMPT, writeSocialPost } from '../writer';

/**
 * The social autopilot's 10-minute tick (ADR 0040), run by pg_cron through /api/jobs/social_tick:
 *
 *  1. plan     today's and tomorrow's autopilot post for every org with the switch on;
 *  2. make     posts due within 3 hours: pick the dish, check its photo, write the words, improve the
 *              picture, render the poster (and the reel) and store them;
 *  3. publish  posts whose time has come, to the connected Facebook Page, Instagram and TikTok
 *              (TikTok always gets the video; ADR 0041);
 *  4. clean    delete the media of posts that went out (or failed) 3+ days ago, so free storage never fills.
 *
 * Nothing waits for a person: the owner chose fully automatic posting. Every step is idempotent, so a
 * slow run or a double fire never posts twice (fb_id / ig_id are written as each platform succeeds).
 */
type Supabase = ReturnType<typeof createServiceRoleClient>;
type Daypart = 'breakfast' | 'lunch' | 'snacks' | 'dinner' | 'late';

const MEDIA_BUCKET = 'social-media';
const PHOTO_BUCKET = 'menu-photos';
const MAKE_AHEAD_MS = 3 * 60 * 60_000;
const KEEP_MEDIA_MS = 3 * 24 * 60 * 60_000;
const MAX_ATTEMPTS = 3;

interface Settings {
  org_id: string;
  autopilot: boolean;
  post_time: string;
  post_days: number[];
  format: SocialFormat;
  language: 'bn' | 'en' | 'both';
  tone: 'friendly' | 'premium' | 'fun';
  color_main: string;
  color_accent: string;
  logo_path: string | null;
  display_name: string | null;
  area: string | null;
  phone: string | null;
  never_item_ids: string[];
}

interface Post {
  id: string;
  org_id: string;
  menu_item_id: string | null;
  source: 'autopilot' | 'owner';
  angle: PostAngle;
  format: 'image' | 'video';
  plan_date: string;
  scheduled_at: string;
  status: string;
  own_text: string | null;
  caption_bn: string | null;
  caption_en: string | null;
  poster_path: string | null;
  video_path: string | null;
  ai_image_path: string | null;
  fb_id: string | null;
  ig_id: string | null;
  ig_container_id: string | null;
  tiktok_publish_id: string | null;
  tiktok_id: string | null;
  attempts: number;
}

const SETTINGS_COLUMNS =
  'org_id, autopilot, post_time, post_days, format, language, tone, color_main, color_accent, logo_path, display_name, area, phone, never_item_ids';
const POST_COLUMNS =
  'id, org_id, menu_item_id, source, angle, format, plan_date, scheduled_at, status, own_text, caption_bn, caption_en, poster_path, video_path, ai_image_path, fb_id, ig_id, ig_container_id, tiktok_publish_id, tiktok_id, attempts';

export interface TickResult {
  planned: number;
  made: number;
  published: number;
  failed: number;
  cleaned: number;
}

export async function runSocialTick(
  sb: Supabase,
  at: Date,
  budgetMs = 240_000,
): Promise<TickResult> {
  const started = at.getTime();
  // The job's own clock is fixed at `at`; elapsed real time is only used to stop before the platform's limit.
  const elapsed = (() => {
    const t0 = performance.now();
    return () => performance.now() - t0;
  })();
  const result: TickResult = { planned: 0, made: 0, published: 0, failed: 0, cleaned: 0 };

  result.planned = await planAhead(sb, at);
  // Publishing first: a post that is due must not wait behind a slow render.
  const pub = await publishDue(sb, at);
  result.published += pub.published;
  result.failed += pub.failed;

  const { data: due } = await sb
    .from('social_posts')
    .select(POST_COLUMNS)
    .eq('status', 'planned')
    .lte('scheduled_at', new Date(started + MAKE_AHEAD_MS).toISOString())
    .order('scheduled_at')
    .limit(6);
  for (const post of (due ?? []) as Post[]) {
    // A reel takes the longest; never start one in the last two minutes of the budget.
    if (elapsed() > budgetMs - 120_000) break;
    const ok = await makePost(sb, post, at);
    if (ok) result.made++;
    else result.failed++;
  }

  // Anything made in this run and already due goes out now rather than in 10 minutes.
  const again = await publishDue(sb, at);
  result.published += again.published;
  result.failed += again.failed;
  result.cleaned = await cleanMedia(sb, at);
  return result;
}

// ---------------------------------------------------------------------------------------------
// 1. Plan
// ---------------------------------------------------------------------------------------------

async function planAhead(sb: Supabase, at: Date): Promise<number> {
  const { data: rows, error } = await sb
    .from('social_settings')
    .select(SETTINGS_COLUMNS)
    .eq('autopilot', true);
  if (error) throw error;
  let planned = 0;
  for (const s of (rows ?? []) as Settings[]) {
    const today = businessDate(at, 0);
    const { data: existing } = await sb
      .from('social_posts')
      .select('plan_date')
      .eq('org_id', s.org_id)
      .eq('source', 'autopilot')
      .in('plan_date', [today, addDays(today, 1)]);
    const have = new Set((existing ?? []).map((r) => r.plan_date as string));
    const missing = [today, addDays(today, 1)].filter(
      (date) =>
        !have.has(date) &&
        isPostingDay(date, s.post_days) &&
        // Switched on after today's time has passed: start tomorrow rather than post late.
        slotAt(date, s.post_time).getTime() >= at.getTime() - 30 * 60_000,
    );
    if (missing.length === 0) continue;
    // The sales split is only read when a day still needs planning, not on every tick.
    const inputs = await growthInputs(sb, s.org_id, at);
    for (const date of missing) {
      const slot = slotAt(date, s.post_time);
      const { error: insertError } = await sb.from('social_posts').insert({
        org_id: s.org_id,
        source: 'autopilot',
        angle: angleForDay(date, {
          star: Boolean(inputs?.top_item_name),
          quietTime: Boolean(inputs?.weak_daypart && inputs.weak_daypart !== 'other'),
        }),
        format: formatForDay(s.format, date),
        plan_date: date,
        scheduled_at: slot.toISOString(),
      });
      if (!insertError) planned++;
      else if (insertError.code !== '23505') throw insertError; // 23505: already planned
    }
  }
  return planned;
}

interface GrowthInputs {
  top_item_name: string | null;
  weak_daypart: string | null;
}

async function growthInputs(sb: Supabase, orgId: string, at: Date): Promise<GrowthInputs | null> {
  const { data } = await sb.rpc('metric_growth_inputs', {
    p_org: orgId,
    p_branch: null,
    p_now: at.toISOString(),
  });
  return ((data ?? []) as GrowthInputs[])[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// 2. Make
// ---------------------------------------------------------------------------------------------

async function fail(sb: Supabase, post: Post, message: string, final = false): Promise<false> {
  const attempts = post.attempts + 1;
  await sb
    .from('social_posts')
    .update({
      attempts,
      error: message.slice(0, 500),
      status: final || attempts >= MAX_ATTEMPTS ? 'failed' : post.status,
    })
    .eq('id', post.id);
  return false;
}

async function makePost(sb: Supabase, post: Post, at: Date): Promise<boolean> {
  try {
    const [{ data: settingsRow }, { data: org }, { data: profile }, { data: tiktok }] =
      await Promise.all([
        sb.from('social_settings').select(SETTINGS_COLUMNS).eq('org_id', post.org_id).maybeSingle(),
        sb.from('organizations').select('name').eq('id', post.org_id).single(),
        sb.from('org_profile').select('area, city').eq('org_id', post.org_id).maybeSingle(),
        sb
          .from('social_accounts')
          .select('id')
          .eq('org_id', post.org_id)
          .eq('platform', 'tiktok')
          .maybeSingle(),
      ]);
    // request_social_post creates the row for an owner's post; an autopilot post only exists with one.
    if (!settingsRow) return fail(sb, post, 'no_settings', true);
    const s = settingsRow as Settings;
    // Switched off after this day was planned: the owner's own posts still go, the autopilot's don't.
    if (post.source === 'autopilot' && !s.autopilot) {
      await sb.from('social_posts').update({ status: 'skipped' }).eq('id', post.id);
      return true;
    }
    const restaurant = s.display_name || (org?.name as string) || '';
    const area = s.area || [profile?.area, profile?.city].filter(Boolean).join(', ') || null;
    const locale = s.language === 'en' ? 'en' : 'bn';
    const t = createTranslator({
      locale,
      messages: locale === 'bn' ? bn : en,
      namespace: 'social.poster',
    });

    // The dishes this post may show: active, with a photo, not on the owner's "never" list.
    const { data: items } = await sb
      .from('menu_items')
      .select('id, name, name_bn, photo_path')
      .eq('org_id', post.org_id)
      .eq('is_active', true)
      .not('photo_path', 'is', null);
    const allowed = (
      (items ?? []) as {
        id: string;
        name: string;
        name_bn: string | null;
        photo_path: string;
      }[]
    ).filter((i) => post.source === 'owner' || !s.never_item_ids.includes(i.id));
    if (allowed.length === 0) return fail(sb, post, 'no_dish_photos', true);

    const { data: history } = await sb
      .from('social_posts')
      .select('menu_item_id, scheduled_at')
      .eq('org_id', post.org_id)
      .in('status', ['ready', 'publishing', 'posted'])
      .not('menu_item_id', 'is', null)
      .order('scheduled_at', { ascending: false })
      .limit(200);
    const last = new Map<string, string>();
    for (const h of (history ?? []) as { menu_item_id: string; scheduled_at: string }[])
      if (!last.has(h.menu_item_id)) last.set(h.menu_item_id, h.scheduled_at);
    const lastPostedId = ((history ?? [])[0] as { menu_item_id?: string } | undefined)
      ?.menu_item_id;

    const inputs =
      post.angle === 'star' || post.angle === 'quiet_time'
        ? await growthInputs(sb, post.org_id, at)
        : null;
    let angle = post.angle;
    const candidates: typeof allowed = [];
    if (angle === 'own') {
      const own = allowed.find((i) => i.id === post.menu_item_id);
      if (!own) return fail(sb, post, 'dish_photo_missing', true);
      candidates.push(own);
    } else {
      if (angle === 'star') {
        const star = allowed.find((i) => i.name === inputs?.top_item_name);
        if (star) candidates.push(star);
        else angle = 'spotlight';
      }
      const rest = allowed.filter((i) => !candidates.includes(i));
      // Up to three tries: a photo that is not food (or too blurry) moves on to the next dish.
      for (let n = 0; n < 3 && rest.length > 0; n++) {
        const pick = pickDish(
          rest.map((i) => ({ id: i.id, name: i.name, lastPostedAt: last.get(i.id) ?? null })),
          lastPostedId,
        );
        if (!pick) break;
        candidates.push(
          rest.splice(
            rest.findIndex((i) => i.id === pick.id),
            1,
          )[0]!,
        );
      }
    }

    return await withBrowser(async (browser) => {
      let chosen: (typeof allowed)[number] | null = null;
      let photo: { bytes: Uint8Array; mime: string } | null = null;
      let small: Uint8Array | null = null;
      for (const item of candidates) {
        const { data: blob } = await sb.storage.from(PHOTO_BUCKET).download(item.photo_path);
        if (!blob) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mime = blob.type || 'image/webp';
        const reference = await shrinkPhoto(browser, bytes, mime, 500);
        if (aiConfigured()) {
          const verdict = await checkDishPhoto({
            orgId: post.org_id,
            dish: item.name,
            jpeg: reference,
          });
          if (verdict !== 'ok') continue;
        }
        chosen = item;
        photo = { bytes, mime };
        small = reference;
        break;
      }
      // The same photos would fail the same way again, so this is final.
      if (!chosen || !photo || !small) return fail(sb, post, 'photo_not_food', true);

      const daypart = angle === 'quiet_time' && inputs?.weak_daypart ? inputs.weak_daypart : null;
      const fact =
        angle === 'star'
          ? `${chosen.name} is one of the most ordered dishes at this restaurant this month.`
          : angle === 'quiet_time' && daypart
            ? `${daypartLabel(daypart)} is the quietest time of day here; invite guests to come at ${daypartLabel(daypart)} for ${chosen.name}.`
            : angle === 'own'
              ? `The owner wants to tell people about ${chosen.name}.`
              : `A spotlight on ${chosen.name} from the menu.`;

      const words = await writeSocialPost({
        orgId: post.org_id,
        restaurant,
        dish: chosen.name,
        fact,
        ownNote: post.own_text,
        tone: s.tone,
        area,
      });

      const folder = `${post.org_id}/${post.id}`;
      let picture = dataUrl(photo.bytes, photo.mime);
      let aiPath: string | null = null;
      try {
        const improved = await improveDishPhoto({
          reference: small,
          dish: chosen.name,
          colour: s.color_main,
          seed: Number.parseInt(post.id.slice(0, 8), 16) % 1_000_000,
        });
        if (improved) {
          picture = dataUrl(improved, 'image/jpeg');
          aiPath = `${folder}/dish.jpg`;
          await upload(sb, aiPath, improved, 'image/jpeg');
        }
      } catch {
        // The free image quota can run out for the day; the real photo is still a good post.
      }

      let logoUrl: string | null = null;
      if (s.logo_path) {
        const { data: logo } = await sb.storage.from(PHOTO_BUCKET).download(s.logo_path);
        if (logo)
          logoUrl = dataUrl(new Uint8Array(await logo.arrayBuffer()), logo.type || 'image/webp');
      }

      const content: PostContent = {
        design: designForDay(post.plan_date, post.source === 'owner' ? 1 : 0),
        hook: s.language === 'en' ? words.hook_en : words.hook_bn,
        headline: s.language === 'bn' ? words.headline_bn : words.headline_en,
        tagline: s.language === 'en' ? words.tagline_en : words.tagline_bn,
        cta: t('cta'),
        badge:
          angle === 'star'
            ? t('badgeStar')
            : daypart
              ? t('badgeDaypart', { daypart: t(`dayparts.${daypart as Daypart}`) })
              : null,
        restaurant,
        area,
        phone: s.phone,
        colorMain: s.color_main,
        colorAccent: s.color_accent,
        imageUrl: picture,
        logoUrl,
      };
      const posterPath = `${folder}/poster.jpg`;
      await upload(sb, posterPath, await renderPoster(browser, content), 'image/jpeg');
      let videoPath: string | null = null;
      // TikTok takes only video, so a poster day still gets a reel when TikTok is connected.
      if (post.format === 'video' || tiktok) {
        videoPath = `${folder}/reel.mp4`;
        await upload(sb, videoPath, await renderReel(browser, content), 'video/mp4');
      }

      const { error } = await sb
        .from('social_posts')
        .update({
          status: 'ready',
          menu_item_id: chosen.id,
          angle,
          fact,
          headline: content.headline,
          tagline: content.tagline,
          caption_bn: words.caption_bn,
          caption_en: words.caption_en,
          template: content.design,
          ai_image_path: aiPath,
          poster_path: posterPath,
          video_path: videoPath,
          model: words.model,
          prompt_version: `${SOCIAL_POST_PROMPT.key}@${words.promptVersion}`,
          error: null,
        })
        .eq('id', post.id)
        .eq('status', 'planned');
      if (error) throw error;
      return true;
    });
  } catch (e) {
    return fail(sb, post, e instanceof Error ? e.message : 'make_failed');
  }
}

/** The org_settings dayparts (tenancy migration), in words the caption writer can use. */
function daypartLabel(key: string): string {
  const labels: Record<string, string> = {
    breakfast: 'breakfast (6am to 11am)',
    lunch: 'lunch (11am to 4pm)',
    snacks: 'snack time (4pm to 7pm)',
    dinner: 'dinner (7pm to 11pm)',
    late: 'late night (after 11pm)',
  };
  return labels[key] ?? key;
}

async function upload(sb: Supabase, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await sb.storage
    .from(MEDIA_BUCKET)
    .upload(path, bytes, { contentType, upsert: true, cacheControl: '3600' });
  if (error) throw error;
}

function publicUrl(sb: Supabase, path: string): string {
  return sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------------------------------------------
// 3. Publish
// ---------------------------------------------------------------------------------------------

interface Account {
  id: string;
  platform: 'facebook' | 'instagram' | 'tiktok';
  external_id: string;
  token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

interface TokenRow {
  account_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

async function accountsFor(sb: Supabase, orgId: string): Promise<Account[]> {
  const { data: accounts } = await sb
    .from('social_accounts')
    .select('id, platform, external_id')
    .eq('org_id', orgId);
  if (!accounts?.length) return [];
  const { data: tokens } = await sb
    .from('social_tokens')
    .select('account_id, access_token, refresh_token, expires_at')
    .eq('org_id', orgId);
  const byId = new Map(((tokens ?? []) as TokenRow[]).map((t) => [t.account_id, t]));
  return (accounts as { id: string; platform: Account['platform']; external_id: string }[])
    .filter((a) => byId.has(a.id))
    .map((a) => {
      const t = byId.get(a.id)!;
      return {
        ...a,
        token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: t.expires_at,
      };
    });
}

/** TikTok access tokens live 24 hours: renew one that ends within 10 minutes, and keep the new pair. */
async function freshTikTokToken(
  sb: Supabase,
  orgId: string,
  account: Account,
  at: Date,
): Promise<string> {
  if (account.expires_at && Date.parse(account.expires_at) - at.getTime() > 10 * 60_000)
    return account.token;
  if (!account.refresh_token) throw new TikTokError('tiktok_reconnect', null);
  // A refused refresh (revoked, or unused for a year) only heals by connecting again: say so on Growth.
  const tokens = await refreshTikTokToken(account.refresh_token, at).catch((e: unknown) => {
    throw e instanceof TikTokError && e.code ? new TikTokError('tiktok_reconnect', e.code) : e;
  });
  const { error } = await sb
    .from('social_tokens')
    .update({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt.toISOString(),
      updated_at: at.toISOString(),
    })
    .eq('org_id', orgId)
    .eq('account_id', account.id);
  if (error) throw error;
  return tokens.accessToken;
}

export function captionFor(
  language: 'bn' | 'en' | 'both',
  bnText: string | null,
  enText: string | null,
): string {
  if (language === 'bn') return bnText ?? enText ?? '';
  if (language === 'en') return enText ?? bnText ?? '';
  return [bnText, enText].filter(Boolean).join('\n\n');
}

async function publishDue(sb: Supabase, at: Date): Promise<{ published: number; failed: number }> {
  const { data } = await sb
    .from('social_posts')
    .select(POST_COLUMNS)
    .in('status', ['ready', 'publishing'])
    .lte('scheduled_at', at.toISOString())
    .order('scheduled_at')
    .limit(20);
  let published = 0;
  let failed = 0;
  for (const post of (data ?? []) as Post[]) {
    const outcome = await publishOne(sb, post, at);
    if (outcome === 'posted') published++;
    if (outcome === 'failed') failed++;
  }
  return { published, failed };
}

async function publishOne(
  sb: Supabase,
  post: Post,
  at: Date,
): Promise<'posted' | 'waiting' | 'failed'> {
  const accounts = await accountsFor(sb, post.org_id);
  if (accounts.length === 0) {
    // Nothing connected: keep it on the Growth page to download for 2 days, then give up.
    if (at.getTime() - Date.parse(post.scheduled_at) > 2 * 24 * 60 * 60_000) {
      await fail(sb, post, 'not_connected', true);
      return 'failed';
    }
    return 'waiting';
  }
  const { data: settings } = await sb
    .from('social_settings')
    .select('language, autopilot, tiktok_mode')
    .eq('org_id', post.org_id)
    .maybeSingle();
  if (post.source === 'autopilot' && !settings?.autopilot && post.status === 'ready') {
    await sb.from('social_posts').update({ status: 'skipped' }).eq('id', post.id);
    return 'waiting';
  }
  const caption = captionFor(
    (settings?.language as 'bn' | 'en' | 'both' | undefined) ?? 'both',
    post.caption_bn,
    post.caption_en,
  );
  const media = post.format === 'video' && post.video_path ? post.video_path : post.poster_path;
  if (!media) {
    await fail(sb, post, 'no_media', true);
    return 'failed';
  }
  const url = publicUrl(sb, media);
  const isVideo = media === post.video_path;
  const patch: Partial<Post> & { status?: string; posted_at?: string; error?: string | null } = {};
  let waiting = false;
  try {
    const fb = accounts.find((a) => a.platform === 'facebook');
    if (fb && !post.fb_id) {
      patch.fb_id = isVideo
        ? await publishFacebookReel(fb.external_id, fb.token, url, caption)
        : await publishFacebookPhoto(fb.external_id, fb.token, url, caption);
      await sb.from('social_posts').update({ fb_id: patch.fb_id }).eq('id', post.id);
    }
    const ig = accounts.find((a) => a.platform === 'instagram');
    if (ig && !post.ig_id) {
      let container = post.ig_container_id;
      if (!container) {
        container = await createInstagramContainer(
          ig.external_id,
          ig.token,
          isVideo ? { videoUrl: url } : { imageUrl: url },
          caption,
        );
        await sb.from('social_posts').update({ ig_container_id: container }).eq('id', post.id);
      }
      const status = await instagramContainerStatus(container, ig.token);
      if (status === 'FINISHED') {
        patch.ig_id = await publishInstagramContainer(ig.external_id, ig.token, container);
      } else if (status === 'ERROR' || status === 'EXPIRED') {
        throw new MetaError(`instagram ${status.toLowerCase()}`, null);
      } else waiting = true; // Instagram is still processing the reel: the next tick publishes it.
    }
    // TikTok takes the reel only; a post made before TikTok was connected has none and skips it.
    const tk = accounts.find((a) => a.platform === 'tiktok');
    if (tk && !post.tiktok_id && post.video_path) {
      const token = await freshTikTokToken(sb, post.org_id, tk, at);
      let publishId = post.tiktok_publish_id;
      if (!publishId) {
        const { data: blob } = await sb.storage.from(MEDIA_BUCKET).download(post.video_path);
        if (!blob) throw new TikTokError('video_missing', null);
        publishId = await startTikTokPost(
          token,
          (settings?.tiktok_mode as TikTokMode | undefined) ?? 'draft',
          new Uint8Array(await blob.arrayBuffer()),
          caption,
        );
        await sb.from('social_posts').update({ tiktok_publish_id: publishId }).eq('id', post.id);
      }
      const progress = await tiktokPublishStatus(token, publishId);
      if (progress.state === 'done') patch.tiktok_id = progress.postId;
      else if (progress.state === 'failed') {
        // Start over on the next try rather than polling a dead upload.
        await sb.from('social_posts').update({ tiktok_publish_id: null }).eq('id', post.id);
        throw new TikTokError(`tiktok ${progress.reason}`, null);
      } else waiting = true; // TikTok is still processing the video: the next tick checks again.
    }
    if (waiting) {
      await sb
        .from('social_posts')
        .update({ ...patch, status: 'publishing' })
        .eq('id', post.id);
      return 'waiting';
    }
    await sb
      .from('social_posts')
      .update({ ...patch, status: 'posted', posted_at: at.toISOString(), error: null })
      .eq('id', post.id);
    return 'posted';
  } catch (e) {
    if (Object.keys(patch).length) await sb.from('social_posts').update(patch).eq('id', post.id);
    await fail(sb, { ...post, ...patch }, e instanceof Error ? e.message : 'publish_failed');
    return post.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'waiting';
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Clean
// ---------------------------------------------------------------------------------------------

async function cleanMedia(sb: Supabase, at: Date): Promise<number> {
  const before = new Date(at.getTime() - KEEP_MEDIA_MS).toISOString();
  const { data } = await sb
    .from('social_posts')
    .select('id, ai_image_path, poster_path, video_path')
    .in('status', ['posted', 'failed', 'skipped'])
    .is('media_cleared_at', null)
    .lte('scheduled_at', before)
    .limit(50);
  let cleaned = 0;
  for (const p of (data ?? []) as {
    id: string;
    ai_image_path: string | null;
    poster_path: string | null;
    video_path: string | null;
  }[]) {
    const paths = [p.ai_image_path, p.poster_path, p.video_path].filter((x): x is string => !!x);
    if (paths.length) await sb.storage.from(MEDIA_BUCKET).remove(paths);
    await sb.from('social_posts').update({ media_cleared_at: at.toISOString() }).eq('id', p.id);
    cleaned++;
  }
  return cleaned;
}
