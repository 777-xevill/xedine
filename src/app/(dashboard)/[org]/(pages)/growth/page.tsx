import { Clapperboard, ImageIcon, Settings, Sparkles } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { SocialStudio, type StudioDish, type StudioPosterText } from '@/components/social-studio';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert, Card, CardTitle, EmptyState, Hint, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatDhakaDateTime, type Locale } from '@/lib/i18n/format';
import { aiConfigured } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import { skipSocialPostAction } from '@/modules/social/actions';
import { branchPricesByItem, posterPrice } from '@/modules/social/prices';
import { getOrgContext } from '@/modules/tenancy/context';

/** The poster's own words in one language (button labels, fallback lines), for the live preview. */
async function posterText(locale: Locale): Promise<StudioPosterText & { plusVat: string }> {
  const t = await getTranslations({ locale, namespace: 'social.poster' });
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
export default async function GrowthPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('manager')) notFound();
  const [t, locale] = await Promise.all([getTranslations('social.growth'), getLocale()]);
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
    posterBn,
    posterEn,
  ] = await Promise.all([
    supabase
      .from('social_settings')
      .select(
        'autopilot, post_time, language, color_main, color_accent, logo_path, display_name, area, phone, show_price',
      )
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
    supabase.from('social_accounts').select('platform, name').eq('org_id', ctx.org.id),
    supabase
      .from('menu_items')
      .select('id, name, name_bn, photo_path, description, base_price_poisha')
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
      .select('menu_item_id, source_path, cutout_path, cutout_usable, studio_path, studio_usable')
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
    posterText('bn'),
    posterText('en'),
  ]);
  // The poster's colours and contact live in social_settings; the owner's first visit makes the row (the
  // database holds the default colours), a manager waits for the owner.
  let look = settings;
  if (!look && ctx.isOwner) {
    await supabase.from('social_settings').insert({ org_id: ctx.org.id });
    ({ data: look } = await supabase
      .from('social_settings')
      .select(
        'autopilot, post_time, language, color_main, color_accent, logo_path, display_name, area, phone, show_price',
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
      },
    ]),
  );
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
    const current = a && a.source_path === d.photo_path ? a : null;
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
      photoUrl: mediaUrl('menu-photos', d.photo_path as string),
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
                {KNOWN_ERRORS.has(p.error) ? t(`errors.${p.error}`) : t('errors.other')}
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

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {!aiConfigured() ? (
        <Alert tone="warning" className="mb-6">
          {t('aiNotConfigured')}
        </Alert>
      ) : null}

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles aria-hidden className="size-5 text-purple" />
              <span className="text-lg font-bold">
                {settings?.autopilot ? t('autopilotOn') : t('autopilotOff')}
              </span>
            </div>
            <p className="text-sm text-secondary">
              {settings?.autopilot
                ? t('autopilotOnBody', { time: String(settings.post_time).slice(0, 5) })
                : t('autopilotOffBody')}
            </p>
            <p className="text-sm text-secondary">
              {fb
                ? t('connectedTo', { page: fb.name as string, ig: ig ? `@${ig.name}` : '—' })
                : t('notConnected')}
            </p>
            <p className="text-sm text-secondary">{t('photoCount', { count: dishes.length })}</p>
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

      <Card className="mb-6">
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <Sparkles aria-hidden className="size-5 text-purple" />
            {t('makeTitle')}
          </span>
        </CardTitle>
        <p className="-mt-2 mb-4 text-sm text-secondary">{t('makeBody')}</p>
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
          />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-bold">{t('upcoming')}</h2>
          {(upcoming ?? []).length === 0 ? (
            <EmptyState title={t('noUpcoming')} body={t('noUpcomingBody')} />
          ) : (
            <div className="space-y-3">
              {((upcoming ?? []) as PostRow[]).map((p) => card(p, p.status !== 'publishing'))}
            </div>
          )}
        </section>
        <section>
          <h2 className="mb-3 text-lg font-bold">{t('past')}</h2>
          {(past ?? []).length === 0 ? (
            <EmptyState title={t('noPast')} />
          ) : (
            <div className="space-y-3">
              {((past ?? []) as PostRow[]).map((p) => card(p, false))}
            </div>
          )}
        </section>
      </div>
      <Hint className="mt-6">{t('footnote', { at: formatDhakaDateTime(at, loc) })}</Hint>
    </>
  );
}
