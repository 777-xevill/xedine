import { Clapperboard, ImageIcon, Settings, Sparkles } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardTitle,
  EmptyState,
  Hint,
  Input,
  Label,
  PageTitle,
  Select,
  Textarea,
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatDhakaDateTime, type Locale } from '@/lib/i18n/format';
import { aiConfigured } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import { requestSocialPostAction, skipSocialPostAction } from '@/modules/social/actions';
import { getOrgContext } from '@/modules/tenancy/context';

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
  ] = await Promise.all([
    supabase
      .from('social_settings')
      .select('autopilot, post_time')
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
    supabase.from('social_accounts').select('platform, name').eq('org_id', ctx.org.id),
    supabase
      .from('menu_items')
      .select('id, name, photo_path')
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
  ]);
  const dishes = items ?? [];
  const dishName = new Map(dishes.map((d) => [d.id as string, d.name as string]));
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card className="self-start">
          <CardTitle>{t('makeTitle')}</CardTitle>
          <p className="-mt-2 mb-4 text-sm text-secondary">{t('makeBody')}</p>
          {dishes.length === 0 ? (
            <EmptyState title={t('noPhotos')} body={t('noPhotosBody')} />
          ) : (
            <ActionForm
              action={requestSocialPostAction}
              successKey="social.growth.requested"
              className="space-y-3"
            >
              {hidden}
              <div>
                <Label htmlFor="sp-item">{t('dish')}</Label>
                <Select id="sp-item" name="itemId" required>
                  {dishes.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="sp-format">{t('format')}</Label>
                <Select id="sp-format" name="format" defaultValue="image">
                  <option value="image">{t('formats.image')}</option>
                  <option value="video">{t('formats.video')}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="sp-text">{t('ownText')}</Label>
                <Textarea
                  id="sp-text"
                  name="ownText"
                  rows={3}
                  maxLength={300}
                  placeholder={t('ownTextExample')}
                />
              </div>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-semibold">{t('when')}</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="when"
                    value="now"
                    defaultChecked
                    className="size-4 accent-purple"
                  />
                  {t('whenNow')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="when" value="later" className="size-4 accent-purple" />
                  {t('whenLater')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Input name="date" type="date" aria-label={t('date')} />
                  <Input name="time" type="time" aria-label={t('time')} />
                </div>
              </fieldset>
              <Button type="submit">
                <Sparkles aria-hidden className="size-4" />
                {t('make')}
              </Button>
              <Hint>{t('makeHint')}</Hint>
            </ActionForm>
          )}
        </Card>

        <div className="space-y-6">
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
      </div>
      <Hint className="mt-6">{t('footnote', { at: formatDhakaDateTime(at, loc) })}</Hint>
    </>
  );
}
