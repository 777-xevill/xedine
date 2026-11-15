'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { aiConfigured } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import { businessDate } from '@/lib/time/business-date';
import { LookSchema, type Look } from '@/modules/social/look';
import { slotAt } from '@/modules/social/schedule';
import { connectPendingPage } from '@/modules/social/connect';
import {
  ApprovedWordsSchema,
  type ApprovedWords,
  type SocialWords,
  SocialWordsSchema,
} from '@/modules/social/words';
import { writeSocialPost } from '@/modules/social/writer';
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = base
    .extend({
      path: z
        .string()
        .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png)$/)
        .nullable(),
    })
    .safeParse(input);
  if (!parsed.success || (parsed.data.path && !parsed.data.path.startsWith(parsed.data.orgId)))
    return { ok: false, error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('social_settings')
    .upsert({ org_id: parsed.data.orgId, logo_path: parsed.data.path });
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
