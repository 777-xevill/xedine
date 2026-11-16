import {
  Ban,
  CircleCheck,
  CircleDashed,
  Clapperboard,
  ImageIcon,
  Settings,
  Sparkles,
  Star,
  Wand2,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createTranslator } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { SocialStudio, type StudioDish, type StudioPosterText } from '@/components/social-studio';
import { SocialVideoStudio, type VideoStudioText } from '@/components/social-video-studio';
import { DishHqPhotoField } from '@/components/dish-hq-photo-field';
import { ActionForm } from '@/components/action-form';
import { saveSocialVideoSettingsAction } from '@/modules/social/actions';
import { OCCASIONS } from '@/modules/social/video-words';
import { MIN_VIDEO_PHOTO_PX } from '@/modules/social/video-rules';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert, Card, EmptyState, Hint, Label, PageTitle, Select } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatDhakaDateTime, formatNumber, type Locale } from '@/lib/i18n/format';
import { aiConfigured } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import { markSocialDishAction, skipSocialPostAction } from '@/modules/social/actions';
import { autopilotOrder, bestSellers, type DishCandidate } from '@/modules/social/schedule';
import type { SocialTone } from '@/modules/social/look';
import { PillNav } from '@/components/ui/pill-nav';
import { branchPricesByItem, posterPrice } from '@/modules/social/prices';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { getOrgContext } from '@/modules/tenancy/context';

/**
 * The poster's own words in one language (button labels, fallback lines), for the live preview. Read
 * straight from the catalogue, as the job does: the request's translator always follows the viewer's own
 * language, but a Bangla poster needs Bangla words even when the owner's screen is in English.
 */
function posterText(locale: Locale): StudioPosterText & { plusVat: string } {
  const t = createTranslator({
    locale,
    messages: locale === 'bn' ? bn : en,
    namespace: 'social.poster',
  });
  return {
    plusVat: t('plusVat'),
    cta: t('cta'),
    labels: {
      orderNow: t('labels.orderNow'),
      follow: t('labels.follow'),
      message: t('labels.message'),
      callUs: t('labels.callUs'),
    },
    defaults: {
      kicker: t('defaults.kicker'),
      tagline: t('defaults.tagline'),
      statusQ: t('defaults.statusQ'),
      statusA: t('defaults.statusA'),
      statusB: t('defaults.statusB'),
      statusC: t('defaults.statusC'),
      moodTop: t('defaults.moodTop'),
      moodBottom: t('defaults.moodBottom'),
    },
  };
}

/** The video's own words in one language (labels, defaults, greetings), for the live preview. */
function videoText(locale: Locale): VideoStudioText {
  const t = createTranslator({ locale, messages: locale === 'bn' ? bn : en, namespace: 'social' });
  return {
    labels: { or: t('video.or'), onlyAt: t('video.onlyAt'), now: t('video.now') },
    cta: t('poster.cta'),
    defaults: {
      hook: t('video.defaults.hook'),
      punch: t('video.defaults.punch'),
      question: t('video.defaults.question'),
      tagline: t('video.defaults.tagline'),
    },
    greetings: Object.fromEntries(
      OCCASIONS.filter((o) => o !== 'custom').map((o) => [o, t(`video.occasions.${o}`)]),
    ) as VideoStudioText['greetings'],
  };
}

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger'> = {
  planned: 'neutral',
  ready: 'info',
  publishing: 'info',
  posted: 'success',
  failed: 'danger',
  skipped: 'neutral',
};
const KNOWN_ERRORS = new Set([
  'no_dish_photos',
  'photo_not_food',
  'dish_photo_missing',
  'not_connected',
  'invented_number',
  'no_settings',
  'tiktok_reconnect',
  'photo_too_small',
]);

interface PostRow {
  id: string;
  menu_item_id: string | null;
  source: string;
  angle: string;
  format: 'image' | 'video';
  scheduled_at: string;
  status: string;
  headline: string | null;
  caption_bn: string | null;
  caption_en: string | null;
  poster_path: string | null;
  video_path: string | null;
  fb_id: string | null;
  ig_id: string | null;
  tiktok_id: string | null;
  error: string | null;
  media_cleared_at: string | null;
}

/**
 * Growth = the social autopilot (ADR 0040). Xedine plans, makes and publishes a Facebook/Instagram post
 * by itself every posting day; this page shows what is coming and what went out, lets the owner or a
 * manager add a post of their own, and skip one before it goes.
 */
const TABS = ['make', 'video', 'dishes', 'upcoming', 'posted'] as const;
type Tab = (typeof TABS)[number];

export default async function GrowthPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ org }, { tab: tabParam }] = await Promise.all([params, searchParams]);
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as Tab)
    : 'make';
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('manager')) notFound();
  const [t, tv, locale] = await Promise.all([
    getTranslations('social.growth'),
    getTranslations('social.video'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const at = now();
  const [
    { data: settings },
    { data: accounts },
    { data: items },
    { data: upcoming },
    { data: past },
    { data: arts },
    { data: branchPrices },
    { data: orgSettings },
    { data: profile },
    { data: qtyRows },
  ] = await Promise.all([
    supabase
      .from('social_settings')
      .select(
        'autopilot, post_time, language, tone, color_main, color_accent, logo_path, display_name, area, phone, show_price, post_item_ids, never_item_ids, videos_per_day, voice_share, voice_gender, greetings',
      )
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
    supabase.from('social_accounts').select('platform, name').eq('org_id', ctx.org.id),
    supabase
      .from('menu_items')
      .select('id, name, name_bn, photo_path, hq_photo_path, description, base_price_poisha')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .not('photo_path', 'is', null)
      .order('name'),
    supabase
      .from('social_posts')
      .select(
        'id, menu_item_id, source, angle, format, scheduled_at, status, headline, caption_bn, caption_en, poster_path, video_path, fb_id, ig_id, tiktok_id, error, media_cleared_at',
      )
      .eq('org_id', ctx.org.id)
      .in('status', ['planned', 'ready', 'publishing'])
      .order('scheduled_at')
      .limit(14),
    supabase
      .from('social_posts')
      .select(
        'id, menu_item_id, source, angle, format, scheduled_at, status, headline, caption_bn, caption_en, poster_path, video_path, fb_id, ig_id, tiktok_id, error, media_cleared_at',
      )
      .eq('org_id', ctx.org.id)
      .in('status', ['posted', 'failed', 'skipped'])
      .order('scheduled_at', { ascending: false })
      .limit(30),
    supabase
      .from('social_dish_art')
      .select(
        'menu_item_id, source_path, cutout_path, cutout_usable, studio_path, studio_usable, photo_width, photo_height',
      )
      .eq('org_id', ctx.org.id),
    supabase
      .from('branch_item_prices')
      .select('menu_item_id, price_poisha')
      .eq('org_id', ctx.org.id)
      .is('variant_id', null)
      .eq('is_available', true),
    supabase
      .from('org_settings')
      .select('price_includes_vat')
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
    supabase.from('org_profile').select('area, city').eq('org_id', ctx.org.id).maybeSingle(),
    // items.qty_sold over the last 30 days (METRICS.md): the autopilot posts what sells (ADR 0058).
    supabase.rpc('metric_item_qty', {
      p_org: ctx.org.id,
      p_branch: null,
      p_window: 'last_30d',
      p_now: at.toISOString(),
    }),
  ]);
  const posterBn = posterText('bn');
  const posterEn = posterText('en');
  // The poster's colours and contact live in social_settings; the owner's first visit makes the row (the
  // database holds the default colours), a manager waits for the owner.
  let look = settings;
  if (!look && ctx.isOwner) {
    await supabase.from('social_settings').insert({ org_id: ctx.org.id });
    ({ data: look } = await supabase
      .from('social_settings')
      .select(
        'autopilot, post_time, language, tone, color_main, color_accent, logo_path, display_name, area, phone, show_price, post_item_ids, never_item_ids, videos_per_day, voice_share, voice_gender, greetings',
      )
      .eq('org_id', ctx.org.id)
      .maybeSingle());
  }
  const dishes = items ?? [];
  const dishName = new Map(dishes.map((d) => [d.id as string, d.name as string]));
  const mediaUrl = (bucket: string, path: string) =>
    supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  // The live preview stands each dish the way the job will: its cut-out (the AI studio plate first).
  const artFor = new Map(
    (arts ?? []).map((a) => [
      a.menu_item_id as string,
      a as {
        source_path: string;
        cutout_path: string | null;
        cutout_usable: boolean;
        studio_path: string | null;
        studio_usable: boolean;
        photo_width: number | null;
        photo_height: number | null;
      },
    ]),
  );
  // The photo posts and videos use: the high-quality one when someone added it (ADR 0061).
  const socialPhoto = (d: { photo_path: unknown; hq_photo_path?: unknown }) =>
    ((d.hq_photo_path as string | null | undefined) ?? (d.photo_path as string)) as string;
  const perBranch = branchPricesByItem(
    (branchPrices ?? []) as { menu_item_id: string; price_poisha: number }[],
  );
  const vatIncluded = (orgSettings?.price_includes_vat as boolean | undefined) ?? true;
  const price = (d: { id: string; base_price_poisha: number }, locale: Locale) =>
    look?.show_price === false
      ? null
      : posterPrice(
          { basePoisha: Number(d.base_price_poisha), branchPoisha: perBranch.get(d.id) ?? [] },
          locale,
          { included: vatIncluded, plusVat: (locale === 'bn' ? posterBn : posterEn).plusVat },
        );
  const studioDishes: StudioDish[] = dishes.map((d) => {
    const a = artFor.get(d.id as string);
    const current = a && a.source_path === socialPhoto(d) ? a : null;
    const cut = current
      ? current.studio_usable && current.studio_path
        ? current.studio_path
        : current.cutout_usable && current.cutout_path
          ? current.cutout_path
          : null
      : null;
    return {
      id: d.id as string,
      name: d.name as string,
      nameBn: (d.name_bn as string | null) ?? null,
      photoUrl: mediaUrl('menu-photos', socialPhoto(d)),
      cutUrl: cut ? mediaUrl('social-media', cut) : null,
      pending: !current,
      price: {
        bn: price(d as { id: string; base_price_poisha: number }, 'bn'),
        en: price(d as { id: string; base_price_poisha: number }, 'en'),
      },
      note: ((d.description as string | null) ?? '').trim() || null,
    };
  });
  const fb = (accounts ?? []).find((a) => a.platform === 'facebook');
  const ig = (accounts ?? []).find((a) => a.platform === 'instagram');
  const media = (path: string | null) =>
    path ? supabase.storage.from('social-media').getPublicUrl(path).data.publicUrl : null;
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );

  const card = (p: PostRow, canSkip: boolean) => {
    const cleared = Boolean(p.media_cleared_at);
    const poster = cleared ? null : media(p.poster_path);
    // A poster day may carry a reel too, made only for TikTok (ADR 0041): show the poster there.
    const video = cleared || p.format !== 'video' ? null : media(p.video_path);
    const file = video ?? poster;
    return (
      <Card key={p.id} className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden rounded-input bg-surface-elevated sm:w-40">
            {video ? (
              <video
                src={video}
                poster={poster ?? undefined}
                controls
                playsInline
                preload="none"
                className="size-full object-cover"
              />
            ) : poster ? (
              <Image src={poster} alt="" fill unoptimized sizes="160px" className="object-cover" />
            ) : (
              <span className="absolute inset-0 grid place-items-center text-muted">
                {p.format === 'video' ? (
                  <Clapperboard aria-hidden className="size-7" />
                ) : (
                  <ImageIcon aria-hidden className="size-7" />
                )}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold tabular-nums">
                {formatDhakaDateTime(new Date(p.scheduled_at), loc)}
              </span>
              <StatusBadge tone={STATUS_TONE[p.status] ?? 'neutral'}>
                {t(`status.${p.status}`)}
              </StatusBadge>
              <Badge tone="neutral">{t(`formats.${p.format}`)}</Badge>
              {p.source === 'owner' ? <Badge tone="accent">{t('yourPost')}</Badge> : null}
            </div>
            <p className="text-sm text-secondary">
              {t(`angles.${p.angle}`)}
              {p.menu_item_id && dishName.get(p.menu_item_id)
                ? ` · ${dishName.get(p.menu_item_id)}`
                : ''}
            </p>
            {p.headline ? <p className="font-bold">{p.headline}</p> : null}
            {p.caption_bn || p.caption_en ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-secondary">{t('caption')}</summary>
                {p.caption_bn ? <p className="mt-2 whitespace-pre-line">{p.caption_bn}</p> : null}
                {p.caption_en ? <p className="mt-2 whitespace-pre-line">{p.caption_en}</p> : null}
              </details>
            ) : null}
            {p.status === 'failed' && p.error ? (
              <Alert tone="danger">
                {KNOWN_ERRORS.has(p.error.split(':')[0]!)
                  ? t(`errors.${p.error.split(':')[0]!}`)
                  : t('errors.other')}
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {p.fb_id ? (
                <a
                  href={`https://www.facebook.com/${p.fb_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-primary underline"
                >
                  {t('seeOnFacebook')}
                </a>
              ) : null}
              {p.ig_id ? <Badge tone="success">{t('onInstagram')}</Badge> : null}
              {p.tiktok_id ? (
                <Badge tone="success">
                  {p.tiktok_id.startsWith('inbox:') ? t('inTikTokInbox') : t('onTikTok')}
                </Badge>
              ) : null}
              {file ? (
                <a href={file} download className="text-sm font-medium text-primary underline">
                  {t('download')}
                </a>
              ) : null}
              {canSkip ? (
                <form action={skipSocialPostAction}>
                  {hidden}
                  <input type="hidden" name="postId" value={p.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    {t('skip')}
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        </div>
      </Card>
    );
  };

  // Which dishes the autopilot posts (ADR 0058): the marked ones, else the best sellers, taking turns.
  const marked = new Set(((look?.post_item_ids as string[] | undefined) ?? []).map(String));
  const never = new Set(((look?.never_item_ids as string[] | undefined) ?? []).map(String));
  const sold = new Map(
    ((qtyRows ?? []) as { menu_item_id: string | null; qty: number }[])
      .filter((r) => r.menu_item_id)
      .map((r) => [r.menu_item_id as string, Number(r.qty)]),
  );
  const lastPosted = new Map<string, string>();
  for (const p of (past ?? []) as PostRow[])
    if (p.status === 'posted' && p.menu_item_id && !lastPosted.has(p.menu_item_id))
      lastPosted.set(p.menu_item_id, p.scheduled_at);
  const candidates: DishCandidate[] = dishes
    .filter((d) => !never.has(d.id as string))
    .map((d) => ({
      id: d.id as string,
      name: d.name as string,
      sold: sold.get(d.id as string) ?? 0,
      lastPostedAt: lastPosted.get(d.id as string) ?? null,
    }));
  const top = bestSellers(candidates);
  const next = autopilotOrder(candidates, marked)[0] ?? null;
  const markedCount = candidates.filter((d) => marked.has(d.id)).length;
  const sortedDishes = [...dishes].sort(
    (a, b) =>
      (sold.get(b.id as string) ?? 0) - (sold.get(a.id as string) ?? 0) ||
      String(a.name).localeCompare(String(b.name)),
  );
  const tabHref = (k: Tab) => `/${ctx.org.slug}/growth?tab=${k}`;
  // A new restaurant's four steps, until all are done (owner only: the steps live on owner pages).
  const socialSetup = `/${ctx.org.slug}/settings/social`;
  const steps = [
    { key: 'photos', done: dishes.length > 0, href: `/${ctx.org.slug}/menu` },
    { key: 'look', done: Boolean(look?.logo_path || look?.phone), href: socialSetup },
    { key: 'connect', done: Boolean(fb), href: socialSetup },
    { key: 'autopilot', done: Boolean(look?.autopilot), href: socialSetup },
  ] as const;
  const stepsDone = steps.filter((s) => s.done).length;
  const markButton = (id: string, mark: 'post' | 'auto' | 'never', on: boolean) => (
    <form action={markSocialDishAction}>
      {hidden}
      <input type="hidden" name="itemId" value={id} />
      <input type="hidden" name="mark" value={mark} />
      <Button type="submit" size="sm" variant={on ? 'primary' : 'ghost'} aria-pressed={on}>
        {mark === 'post' ? (
          <Star aria-hidden className="size-4" />
        ) : mark === 'never' ? (
          <Ban aria-hidden className="size-4" />
        ) : (
          <Wand2 aria-hidden className="size-4" />
        )}
        {t(`marks.${mark}`)}
      </Button>
    </form>
  );

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {!aiConfigured() ? (
        <Alert tone="warning" className="mb-4">
          {t('aiNotConfigured')}
        </Alert>
      ) : null}

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="flex items-center gap-2 font-bold">
              <Sparkles aria-hidden className="size-5 text-purple" />
              {settings?.autopilot
                ? t('autopilotOnLine', { time: String(settings.post_time).slice(0, 5) })
                : t('autopilotOff')}
            </p>
            <p className="text-sm text-secondary">
              {fb
                ? t('connectedTo', { page: fb.name as string, ig: ig ? `@${ig.name}` : '—' })
                : t('notConnected')}
            </p>
            {settings?.autopilot && next ? (
              <p className="text-sm text-secondary">
                {t('nextUp', { dish: next.dish.name })} · {t(`reasons.${next.reason}`)}
              </p>
            ) : null}
          </div>
          {ctx.isOwner ? (
            <Link
              href={`/${ctx.org.slug}/settings/social`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <Settings aria-hidden className="size-4" />
              {t('setup')}
            </Link>
          ) : null}
        </div>
      </Card>

      {ctx.isOwner && stepsDone < steps.length ? (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-bold">{t('start.title')}</p>
            <p className="text-sm text-secondary tabular-nums">
              {t('start.progress', {
                done: formatNumber(stepsDone, loc),
                total: formatNumber(steps.length, loc),
              })}
            </p>
          </div>
          <ol className="space-y-3">
            {steps.map((s) => (
              <li key={s.key} className="flex items-start gap-3">
                {s.done ? (
                  <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <CircleDashed aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={s.done ? 'text-secondary line-through' : 'font-semibold'}>
                    {t(`start.${s.key}`)}
                  </p>
                  {s.done ? null : (
                    <p className="text-sm text-secondary">{t(`start.${s.key}Body`)}</p>
                  )}
                </div>
                {s.done ? null : (
                  <Link
                    href={s.href}
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    {t('start.open')}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <PillNav
        label={t('tabsLabel')}
        className="mb-4"
        items={TABS.map((k) => ({
          href: tabHref(k),
          active: tab === k,
          label:
            k === 'upcoming' && (upcoming ?? []).length
              ? `${t(`tabs.${k}`)} (${(upcoming ?? []).length})`
              : t(`tabs.${k}`),
        }))}
      />

      {tab === 'make' ? (
        <Card>
          <p className="mb-4 text-sm text-secondary">{t('makeBody')}</p>
          {dishes.length === 0 ? (
            <EmptyState title={t('noPhotos')} body={t('noPhotosBody')} />
          ) : !look ? (
            <EmptyState title={t('noLook')} body={t('noLookBody')} />
          ) : (
            <SocialStudio
              orgId={ctx.org.id}
              orgSlug={ctx.org.slug}
              dishes={studioDishes}
              brand={{
                restaurant: (look.display_name as string | null) || ctx.org.name,
                area:
                  (look.area as string | null) ||
                  [profile?.area, profile?.city].filter(Boolean).join(', ') ||
                  null,
                phone: (look.phone as string | null) ?? null,
                colorMain: look.color_main as string,
                colorAccent: look.color_accent as string,
                logoUrl: look.logo_path ? mediaUrl('menu-photos', look.logo_path as string) : null,
              }}
              language={(look.language as 'bn' | 'en' | 'both' | undefined) ?? 'both'}
              poster={{ bn: posterBn, en: posterEn }}
              aiOn={aiConfigured()}
              tone={((look.tone as SocialTone | undefined) ?? 'friendly') as SocialTone}
            />
          )}
        </Card>
      ) : null}

      {tab === 'video' ? (
        <div className="space-y-6">
          <Card>
            <p className="mb-1 font-semibold">{tv('settings.title')}</p>
            <p className="mb-4 text-sm text-secondary">{tv('settings.body')}</p>
            {!look ? (
              <EmptyState title={t('noLook')} body={t('noLookBody')} />
            ) : (
              <ActionForm
                action={saveSocialVideoSettingsAction}
                successKey="common.saved"
                className="grid gap-4 sm:grid-cols-3"
              >
                {hidden}
                <div>
                  <Label htmlFor="sv-per-day">{tv('settings.perDay')}</Label>
                  <Select
                    id="sv-per-day"
                    name="videosPerDay"
                    defaultValue={String(look.videos_per_day ?? 1)}
                  >
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {tv('settings.perDayN', { n })}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="sv-voice">{tv('settings.voice')}</Label>
                  <Select
                    id="sv-voice"
                    name="voiceShare"
                    defaultValue={(look.voice_share as string | undefined) ?? 'half'}
                  >
                    {(['none', 'half', 'all'] as const).map((v) => (
                      <option key={v} value={v}>
                        {tv(`settings.voiceShare.${v}`)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="sv-gender">{tv('settings.gender')}</Label>
                  <Select
                    id="sv-gender"
                    name="voiceGender"
                    defaultValue={(look.voice_gender as string | undefined) ?? 'female'}
                  >
                    <option value="female">{tv('settings.female')}</option>
                    <option value="male">{tv('settings.male')}</option>
                  </Select>
                </div>
                <label className="flex items-start gap-3 rounded-input border border-line p-3 sm:col-span-3">
                  <input
                    type="checkbox"
                    name="greetings"
                    defaultChecked={look.greetings !== false}
                    className="mt-1 size-5 accent-purple"
                  />
                  <span>
                    <span className="block font-semibold">{tv('settings.greetings')}</span>
                    <span className="text-sm text-secondary">{tv('settings.greetingsHint')}</span>
                  </span>
                </label>
                <div className="sm:col-span-3">
                  <Button type="submit">{tv('settings.save')}</Button>
                  <Hint className="mt-2">
                    {look.autopilot ? tv('settings.autopilotOn') : tv('settings.autopilotOff')}
                  </Hint>
                </div>
              </ActionForm>
            )}
          </Card>

          <Card>
            <p className="mb-1 font-semibold">{tv('make.title')}</p>
            <p className="mb-4 text-sm text-secondary">{tv('make.body')}</p>
            {dishes.length === 0 ? (
              <EmptyState title={t('noPhotos')} body={t('noPhotosBody')} />
            ) : !look ? (
              <EmptyState title={t('noLook')} body={t('noLookBody')} />
            ) : (
              <SocialVideoStudio
                orgId={ctx.org.id}
                orgSlug={ctx.org.slug}
                dishes={studioDishes}
                brand={{
                  restaurant: (look.display_name as string | null) || ctx.org.name,
                  area:
                    (look.area as string | null) ||
                    [profile?.area, profile?.city].filter(Boolean).join(', ') ||
                    null,
                  phone: (look.phone as string | null) ?? null,
                  colorMain: look.color_main as string,
                  colorAccent: look.color_accent as string,
                  logoUrl: look.logo_path
                    ? mediaUrl('menu-photos', look.logo_path as string)
                    : null,
                }}
                language={(look.language as 'bn' | 'en' | 'both' | undefined) ?? 'both'}
                text={{ bn: videoText('bn'), en: videoText('en') }}
                aiOn={aiConfigured()}
                tone={((look.tone as SocialTone | undefined) ?? 'friendly') as SocialTone}
              />
            )}
          </Card>

          <Card>
            <p className="mb-1 font-semibold">{tv('photos.title')}</p>
            <p className="mb-4 text-sm text-secondary">
              {tv('photos.body', { px: formatNumber(MIN_VIDEO_PHOTO_PX, loc) })}
            </p>
            {dishes.length === 0 ? (
              <EmptyState title={t('noPhotos')} body={t('noPhotosBody')} />
            ) : (
              <ul className="divide-y divide-line">
                {[...dishes]
                  .map((d) => {
                    const a = artFor.get(d.id as string);
                    const measured = a && a.source_path === socialPhoto(d) ? a : null;
                    const short =
                      measured?.photo_width && measured.photo_height
                        ? Math.min(measured.photo_width, measured.photo_height)
                        : null;
                    return { d, short, small: short !== null && short < MIN_VIDEO_PHOTO_PX };
                  })
                  .sort((x, y) => Number(y.small) - Number(x.small))
                  .map(({ d, short, small }) => (
                    <li key={d.id as string} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="relative size-14 shrink-0 overflow-hidden rounded-input bg-surface-elevated">
                        <Image
                          src={mediaUrl('menu-photos', socialPhoto(d))}
                          alt=""
                          fill
                          unoptimized
                          sizes="56px"
                          className="object-cover"
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">
                          {loc === 'bn' && d.name_bn ? (d.name_bn as string) : (d.name as string)}
                        </p>
                        <p className="flex flex-wrap items-center gap-1.5 text-sm text-secondary">
                          {small ? (
                            <Badge tone="danger">{tv('photos.tooSmall')}</Badge>
                          ) : d.hq_photo_path ? (
                            <Badge tone="success">{tv('photos.hq')}</Badge>
                          ) : (
                            <span>{tv('photos.menuPhoto')}</span>
                          )}
                          {short !== null ? (
                            <span className="tabular-nums">
                              {tv('photos.size', { px: formatNumber(short, loc) })}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <DishHqPhotoField
                        orgId={ctx.org.id}
                        orgSlug={ctx.org.slug}
                        itemId={d.id as string}
                        path={(d.hq_photo_path as string | null) ?? null}
                      />
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'dishes' ? (
        <Card>
          <p className="mb-1 font-semibold">
            {markedCount ? t('modeMarked', { count: markedCount }) : t('modeSales')}
          </p>
          <p className="mb-4 text-sm text-secondary">{t('dishesBody')}</p>
          {dishes.length === 0 ? (
            <EmptyState title={t('noPhotos')} body={t('noPhotosBody')} />
          ) : (
            <ul className="divide-y divide-line">
              {sortedDishes.map((d) => {
                const id = d.id as string;
                const mark = marked.has(id) ? 'post' : never.has(id) ? 'never' : 'auto';
                const studio = studioDishes.find((x) => x.id === id);
                return (
                  <li key={id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="relative size-14 shrink-0 overflow-hidden rounded-input bg-surface-elevated">
                      <Image
                        src={studio?.cutUrl ?? mediaUrl('menu-photos', d.photo_path as string)}
                        alt=""
                        fill
                        unoptimized
                        sizes="56px"
                        className={studio?.cutUrl ? 'object-contain' : 'object-cover'}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {loc === 'bn' && d.name_bn ? (d.name_bn as string) : (d.name as string)}
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5 text-sm text-secondary">
                        <span className="tabular-nums">
                          {t('sold30', { n: formatNumber(sold.get(id) ?? 0, loc) })}
                        </span>
                        {top.has(id) ? <Badge tone="success">{t('bestSeller')}</Badge> : null}
                        {next?.dish.id === id ? (
                          <Badge tone="accent">{t('nextBadge')}</Badge>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {markButton(id, 'post', mark === 'post')}
                      {markButton(id, 'auto', mark === 'auto')}
                      {markButton(id, 'never', mark === 'never')}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === 'upcoming' ? (
        (upcoming ?? []).length === 0 ? (
          <EmptyState title={t('noUpcoming')} body={t('noUpcomingBody')} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {((upcoming ?? []) as PostRow[]).map((p) => card(p, p.status !== 'publishing'))}
          </div>
        )
      ) : null}

      {tab === 'posted' ? (
        (past ?? []).length === 0 ? (
          <EmptyState title={t('noPast')} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {((past ?? []) as PostRow[]).map((p) => card(p, false))}
          </div>
        )
      ) : null}
      <Hint className="mt-6">{t('footnote', { at: formatDhakaDateTime(at, loc) })}</Hint>
    </>
  );
}
