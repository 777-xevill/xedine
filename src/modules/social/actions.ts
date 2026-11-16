'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { aiConfigured } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import { businessDate } from '@/lib/time/business-date';
import { LookSchema, type Look } from '@/modules/social/look';
import { slotAt } from '@/modules/social/schedule';
import { pingAdmin } from '@/lib/messaging/admin-ping';
import { connectPendingPage } from '@/modules/social/connect';
import { normalizeFacebookLink } from '@/modules/social/facebook-link';
import {
  ApprovedWordsSchema,
  type ApprovedWords,
  type SocialWords,
  SocialWordsSchema,
} from '@/modules/social/words';
import { VideoLookSchema, VIDEO_KINDS, type VideoLook } from '@/modules/social/video-look';
import {
  ApprovedVideoWordsSchema,
  type ApprovedVideoWords,
  OCCASIONS,
  VideoWordsSchema,
  type AiVideoWords,
} from '@/modules/social/video-words';
import { writeSocialPost, writeSocialVideo } from '@/modules/social/writer';
import { getOrgContext } from '@/modules/tenancy/context';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Social autopilot settings and the owner's own posts (ADR 0040). Settings are the owner's; adding or
 * skipping a post is open to managers too. Publishing itself only ever happens in the job.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const HEX = /^#[0-9a-fA-F]{6}$/;
const refresh = (slug: string) => {
  revalidatePath(`/${slug}/settings/social`);
  revalidatePath(`/${slug}/growth`);
};
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

export async function saveSocialSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      autopilot: z.literal('on').optional(),
      postTime: z.string().regex(/^\d{2}:\d{2}$/),
      format: z.enum(['mix', 'image', 'video']),
      language: z.enum(['bn', 'en', 'both']),
      tone: z.enum(['friendly', 'premium', 'fun']),
      colorMain: z.string().regex(HEX),
      colorAccent: z.string().regex(HEX),
      displayName: optional(60),
      area: optional(80),
      phone: optional(30),
      showPrice: z.literal('on').optional(),
    })
    .safeParse(Object.fromEntries(formData));
  const days = formData
    .getAll('days')
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (!parsed.success || days.length === 0) return { error: 'invalidInput' };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('social_settings').upsert({
    org_id: d.orgId,
    autopilot: d.autopilot === 'on',
    post_time: d.postTime,
    post_days: [...new Set(days)].sort(),
    format: d.format,
    language: d.language,
    tone: d.tone,
    color_main: d.colorMain,
    color_accent: d.colorAccent,
    display_name: d.displayName,
    area: d.area,
    phone: d.phone,
    show_price: d.showPrice === 'on',
  });
  if (error) return { error: mapDbError(error) };
  refresh(d.orgSlug);
  return { ok: true };
}

/** The logo the client already uploaded to the org's folder in menu-photos (null removes it). */
export async function setSocialLogoAction(input: {
  orgId: string;
  orgSlug: string;
  path: string | null;
  colors?: { main: string; accent: string } | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = base
    .extend({
      colors: z
        .object({ main: z.string().regex(HEX), accent: z.string().regex(HEX) })
        .nullable()
        .optional(),
      path: z
        .string()
        .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png)$/)
        .nullable(),
    })
    .safeParse(input);
  if (!parsed.success || (parsed.data.path && !parsed.data.path.startsWith(parsed.data.orgId)))
    return { ok: false, error: 'invalidInput' };
  const supabase = await createClient();
  // A new logo brings its own two main colours (ADR 0061); the owner can still change them in Settings.
  const colors = parsed.data.path && parsed.data.colors ? parsed.data.colors : null;
  const { error } = await supabase.from('social_settings').upsert({
    org_id: parsed.data.orgId,
    logo_path: parsed.data.path,
    ...(colors ? { color_main: colors.main, color_accent: colors.accent } : {}),
  });
  if (error) return { ok: false, error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

/**
 * The owner's own post. From the Growth preview it also carries the design they picked, the words they
 * approved (as JSON) and up to three more dishes (`extra`), all optional (ADR 0057).
 */
export async function requestSocialPostAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      itemId: z.uuid(),
      format: z.enum(['image', 'video']),
      ownText: z.string().trim().max(300).optional(),
      when: z.enum(['now', 'later']),
      date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional(),
      time: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal('')]).optional(),
      spec: z.string().max(2000).optional(),
      words: z.string().max(8000).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const d = parsed.data;
  let look: Look | null = null;
  if (d.spec) {
    try {
      const checked = LookSchema.safeParse(JSON.parse(d.spec));
      if (!checked.success) return { error: 'invalidInput' };
      look = checked.data;
    } catch {
      return { error: 'invalidInput' };
    }
  }
  let words: ApprovedWords | null = null;
  if (d.words) {
    let json: unknown;
    try {
      json = JSON.parse(d.words);
    } catch {
      return { error: 'invalidInput' };
    }
    const checked = ApprovedWordsSchema.safeParse(json);
    if (!checked.success) return { error: 'invalidInput' };
    words = Object.keys(checked.data).length ? checked.data : null;
  }
  const extra = [
    ...new Set(formData.getAll('extra').filter((v): v is string => typeof v === 'string')),
  ];
  if (extra.length > 3 || !extra.every((v) => z.uuid().safeParse(v).success))
    return { error: 'invalidInput' };
  const at = now();
  let when = at;
  let planDate = businessDate(at, 0);
  if (d.when === 'later') {
    if (!d.date || !d.time) return { error: 'socialPickTime' };
    when = slotAt(d.date, d.time);
    planDate = d.date;
    if (when.getTime() < at.getTime()) return { error: 'socialPickTime' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_social_post', {
    p_org: d.orgId,
    p_item: d.itemId,
    p_format: d.format,
    p_own_text: d.ownText ?? '',
    p_when: when.toISOString(),
    p_plan_date: planDate,
    p_design: look?.layout ?? null,
    p_spec: look,
    p_words: words,
    p_extra_items: extra.filter((id) => id !== d.itemId),
  });
  if (error) return { error: mapDbError(error) };
  refresh(d.orgSlug);
  return { ok: true };
}

/**
 * "Write the words for me" in the Growth preview (ADR 0057): the AI writes every line a design may use,
 * about the dish and the owner's idea. Nothing is posted; the owner sees the words on the poster, can
 * change them, and only then posts. Numbers the AI makes up are refused (CLAUDE.md #1).
 */
export async function draftSocialWordsAction(input: {
  orgId: string;
  orgSlug: string;
  itemId: string;
  idea: string;
}): Promise<
  | { ok: true; words: SocialWords }
  | { ok: false; error: 'notAllowed' | 'aiOff' | 'number' | 'failed' }
> {
  const parsed = base
    .extend({ itemId: z.uuid(), idea: z.string().trim().max(300) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'failed' };
  const d = parsed.data;
  const ctx = await getOrgContext(d.orgSlug);
  if (ctx.org.id !== d.orgId || (!ctx.roles.includes('owner') && !ctx.roles.includes('manager')))
    return { ok: false, error: 'notAllowed' };
  if (!aiConfigured()) return { ok: false, error: 'aiOff' };
  const supabase = await createClient();
  const [{ data: dish }, { data: settings }] = await Promise.all([
    supabase
      .from('menu_items')
      .select('name')
      .eq('org_id', d.orgId)
      .eq('id', d.itemId)
      .maybeSingle(),
    supabase
      .from('social_settings')
      .select('tone, display_name, area')
      .eq('org_id', d.orgId)
      .maybeSingle(),
  ]);
  if (!dish) return { ok: false, error: 'failed' };
  try {
    const written = await writeSocialPost({
      orgId: d.orgId,
      restaurant: (settings?.display_name as string | null) || ctx.org.name,
      dish: dish.name as string,
      fact: `The owner wants to tell people about ${dish.name as string}.`,
      ownNote: d.idea || null,
      tone: (settings?.tone as 'friendly' | 'premium' | 'fun' | undefined) ?? 'friendly',
      area: (settings?.area as string | null) ?? null,
    });
    // Only the words go back to the browser (the schema drops the model name and prompt version).
    return { ok: true, words: SocialWordsSchema.parse(written) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message === 'invented_number' ? 'number' : 'failed',
    };
  }
}

/** Owner or manager marks a dish for the autopilot: post (only marked dishes go), never, or auto (ADR 0058). */
export async function markSocialDishAction(formData: FormData): Promise<void> {
  const parsed = base
    .extend({ itemId: z.uuid(), mark: z.enum(['post', 'never', 'auto']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_social_dish', {
    p_org: parsed.data.orgId,
    p_item: parsed.data.itemId,
    p_mark: parsed.data.mark,
  });
  if (error) console.error('mark social dish', error.code);
  refresh(parsed.data.orgSlug);
}

export async function skipSocialPostAction(formData: FormData): Promise<void> {
  const parsed = base.extend({ postId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('skip_social_post', { p_post: parsed.data.postId });
  if (error) console.error('skip social post', error.code);
  refresh(parsed.data.orgSlug);
}

/**
 * Disconnect Facebook + Instagram (one connect covers both) or TikTok. The token rows go with the
 * accounts (foreign key cascade).
 */
export async function disconnectSocialAction(formData: FormData): Promise<void> {
  const parsed = base
    .extend({ platform: z.enum(['meta', 'tiktok']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('social_accounts')
    .delete()
    .eq('org_id', parsed.data.orgId)
    .in('platform', parsed.data.platform === 'tiktok' ? ['tiktok'] : ['facebook', 'instagram']);
  if (error) console.error('disconnect social', error.code);
  refresh(parsed.data.orgSlug);
}

/** How TikTok gets the video: to the owner's inbox to post with one tap, or posted directly. */
export async function saveTikTokModeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({ tiktokMode: z.enum(['draft', 'direct']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('social_settings')
    .upsert({ org_id: parsed.data.orgId, tiktok_mode: parsed.data.tiktokMode });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

/**
 * "Help me connect" (ADR 0059): the owner asks Xedine to connect Facebook for them — either they gave
 * Xedine's Facebook account access to their Page (`page_access`, Page link optional), or they send their
 * own profile link to be added as a Tester (`tester`). The operator gets a Telegram ping.
 */
export async function requestSocialConnectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({ way: z.enum(['page_access', 'tester']), link: z.string().max(400).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const d = parsed.data;
  const link = d.link?.trim() ? normalizeFacebookLink(d.link) : null;
  if (d.link?.trim() && !link) return { error: 'socialFacebookLink' };
  if (d.way === 'tester' && !link) return { error: 'socialFacebookLink' };
  const ctx = await getOrgContext(d.orgSlug);
  if (ctx.org.id !== d.orgId || !ctx.isOwner) return { error: 'notAllowed' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_social_connect', {
    p_org: d.orgId,
    p_way: d.way,
    p_link: link,
  });
  if (error) return { error: mapDbError(error) };
  await pingAdmin(
    `Facebook help: ${ctx.org.name} (${ctx.org.slug}) — ${
      d.way === 'page_access' ? 'gave Page access, connect it' : 'add as Tester'
    }${link ? `\n${link}` : ''}\nhttps://xedine.org/admin#facebook`,
  );
  refresh(d.orgSlug);
  return { ok: true };
}

export async function cancelSocialConnectAction(formData: FormData): Promise<void> {
  const parsed = base.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_social_connect', { p_org: parsed.data.orgId });
  if (error) console.error('cancel social connect', error.code);
  refresh(parsed.data.orgSlug);
}

/** Admin console: a Tester invite was sent (or a request is reopened / closed) (ADR 0059). */
export async function adminMarkSocialConnectAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ orgId: z.uuid(), status: z.enum(['waiting', 'invited', 'done']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_mark_social_connect', {
    p_org: parsed.data.orgId,
    p_status: parsed.data.status,
  });
  if (error) console.error('admin mark social connect', error.code);
  revalidatePath('/admin');
}

/** Admin console: the Page (of those the admin's Facebook offered) that belongs to this restaurant. */
export async function adminPickSocialPageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .object({ orgId: z.uuid(), pageId: z.string().regex(/^[0-9]{1,40}$/) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc('am_platform_admin');
  if (!user || isAdmin !== true) return { error: 'notAllowed' };
  const ok = await connectPendingPage(parsed.data.orgId, user.id, parsed.data.pageId, now());
  if (!ok) return { error: 'socialConnectExpired' };
  revalidatePath('/admin');
  return { ok: true };
}

/** The owner picks which of their Facebook Pages Xedine posts to (when Facebook offered several). */
export async function pickSocialPageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .object({ orgSlug: z.string().regex(SLUG), pageId: z.string().regex(/^[0-9]{1,40}$/) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const ctx = await getOrgContext(parsed.data.orgSlug);
  if (!ctx.isOwner) return { error: 'notAllowed' };
  const ok = await connectPendingPage(ctx.org.id, ctx.user.id, parsed.data.pageId, now());
  if (!ok) return { error: 'socialConnectExpired' };
  refresh(ctx.org.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Short videos (ADR 0061): owner and managers alike.
// ---------------------------------------------------------------------------------------------

/** How many videos a day, the AI voice and special-day greetings. */
export async function saveSocialVideoSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      videosPerDay: z.coerce.number().int().min(0).max(5),
      voiceShare: z.enum(['none', 'half', 'all']),
      voiceGender: z.enum(['female', 'male']),
      greetings: z.literal('on').optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_social_video_settings', {
    p_org: d.orgId,
    p_videos_per_day: d.videosPerDay,
    p_voice_share: d.voiceShare,
    p_voice_gender: d.voiceGender,
    p_greetings: d.greetings === 'on',
  });
  if (error) return { error: mapDbError(error) };
  refresh(d.orgSlug);
  return { ok: true };
}

/** The owner's or a manager's own video: 1–3 dishes, kind, special day, idea, offer price, look, words. */
export async function requestSocialVideoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      kind: z.union([z.enum(VIDEO_KINDS), z.literal('')]).optional(),
      occasion: z.union([z.enum(OCCASIONS), z.literal('')]).optional(),
      occasionText: z.string().trim().max(80).optional(),
      ownText: z.string().trim().max(300).optional(),
      offer: z.union([z.string().regex(/^\d{1,7}(\.\d{1,2})?$/), z.literal('')]).optional(),
      when: z.enum(['now', 'later']),
      date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional(),
      time: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal('')]).optional(),
      spec: z.string().max(2000).optional(),
      words: z.string().max(4000).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const d = parsed.data;
  const items = [
    ...new Set(formData.getAll('dish').filter((v): v is string => typeof v === 'string')),
  ];
  if (items.length < 1) return { error: 'socialVideoPickDish' };
  if (items.length > 3) return { error: 'socialVideoTooMany' };
  if (!items.every((v) => z.uuid().safeParse(v).success)) return { error: 'invalidInput' };
  let look: VideoLook | null = null;
  let words: ApprovedVideoWords | null = null;
  try {
    if (d.spec) {
      const checked = VideoLookSchema.safeParse(JSON.parse(d.spec));
      if (checked.success) look = checked.data;
    }
    if (d.words) {
      const checked = ApprovedVideoWordsSchema.safeParse(JSON.parse(d.words));
      if (!checked.success) return { error: 'invalidInput' };
      words = Object.keys(checked.data).length ? checked.data : null;
    }
  } catch {
    return { error: 'invalidInput' };
  }
  const kind = d.kind || null;
  if (look && kind && look.kind !== kind) look = null;
  const at = now();
  let when = at;
  let planDate = businessDate(at, 0);
  if (d.when === 'later') {
    if (!d.date || !d.time) return { error: 'socialPickTime' };
    when = slotAt(d.date, d.time);
    planDate = d.date;
    if (when.getTime() < at.getTime()) return { error: 'socialPickTime' };
  }
  const offer = kind === 'offer' && d.offer ? Math.round(Number(d.offer) * 100) : null;
  if (kind === 'offer' && !offer) return { error: 'socialOfferPrice' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_social_video', {
    p_org: d.orgId,
    p_items: items,
    p_kind: kind,
    p_occasion: d.occasion || null,
    p_occasion_text: d.occasionText || null,
    p_own_text: d.ownText ?? '',
    p_offer_poisha: offer,
    p_when: when.toISOString(),
    p_plan_date: planDate,
    p_words: words,
    p_spec: look,
  });
  if (error) {
    if (error.code === '23514') return { error: 'socialOfferPrice' };
    if (error.message.includes('number of dishes')) return { error: 'socialVideoKindCount' };
    if (error.message.includes('write the special day')) return { error: 'socialOccasionText' };
    return { error: mapDbError(error) };
  }
  refresh(d.orgSlug);
  return { ok: true };
}

/**
 * "Write the words for me" in the video preview: the AI writes the hook and lines for the dishes, kind and
 * special day picked. Nothing is posted; numbers the AI makes up are refused (CLAUDE.md #1).
 */
export async function draftSocialVideoWordsAction(input: {
  orgId: string;
  orgSlug: string;
  itemIds: string[];
  kind: string;
  occasion: string | null;
  idea: string;
}): Promise<
  | { ok: true; words: AiVideoWords }
  | { ok: false; error: 'notAllowed' | 'aiOff' | 'number' | 'failed' }
> {
  const parsed = base
    .extend({
      itemIds: z.array(z.uuid()).min(1).max(3),
      kind: z.enum(VIDEO_KINDS),
      occasion: z.string().trim().max(80).nullable(),
      idea: z.string().trim().max(300),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'failed' };
  const d = parsed.data;
  const ctx = await getOrgContext(d.orgSlug);
  if (ctx.org.id !== d.orgId || (!ctx.roles.includes('owner') && !ctx.roles.includes('manager')))
    return { ok: false, error: 'notAllowed' };
  if (!aiConfigured()) return { ok: false, error: 'aiOff' };
  const supabase = await createClient();
  const [{ data: dishes }, { data: settings }] = await Promise.all([
    supabase.from('menu_items').select('id, name').eq('org_id', d.orgId).in('id', d.itemIds),
    supabase
      .from('social_settings')
      .select('tone, display_name, area')
      .eq('org_id', d.orgId)
      .maybeSingle(),
  ]);
  const names = d.itemIds
    .map((id) => (dishes ?? []).find((x) => x.id === id)?.name as string | undefined)
    .filter((x): x is string => Boolean(x));
  if (names.length === 0) return { ok: false, error: 'failed' };
  try {
    const written = await writeSocialVideo({
      orgId: d.orgId,
      restaurant: (settings?.display_name as string | null) || ctx.org.name,
      dishes: names,
      kind: d.kind,
      fact: `The owner wants to tell people about ${names.join(' and ')}.`,
      occasion: d.occasion,
      ownNote: d.idea || null,
      tone: (settings?.tone as 'friendly' | 'premium' | 'fun' | undefined) ?? 'friendly',
      area: (settings?.area as string | null) ?? null,
    });
    return { ok: true, words: VideoWordsSchema.parse(written) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message === 'invented_number' ? 'number' : 'failed',
    };
  }
}

/** A dish's high-quality photo for posts and videos, already uploaded to <org>/hq/ (null removes it). */
export async function setDishHqPhotoAction(input: {
  orgId: string;
  orgSlug: string;
  itemId: string;
  path: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = base
    .extend({ itemId: z.uuid(), path: z.string().max(200).nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalidInput' };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_dish_hq_photo', {
    p_org: d.orgId,
    p_item: d.itemId,
    p_path: d.path,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  refresh(d.orgSlug);
  return { ok: true };
}
