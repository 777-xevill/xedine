import { Camera, Clapperboard, Share2 } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { SettingsNav } from '@/components/settings-nav';
import { SocialLogoField } from '@/components/social-logo-field';
import { StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardTitle,
  Hint,
  Input,
  Label,
  PageTitle,
  Select,
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { pendingPageNames } from '@/modules/social/connect';
import { imageAiConfigured } from '@/modules/social/image-ai';
import { now } from '@/lib/time/clock';
import { metaConfigured } from '@/modules/social/meta';
import { tiktokConfigured } from '@/modules/social/tiktok';
import {
  disconnectSocialAction,
  pickSocialPageAction,
  saveSocialSettingsAction,
  saveTikTokModeAction,
} from '@/modules/social/actions';
import { getOrgContext } from '@/modules/tenancy/context';

const NOTICES = {
  connected: 'success',
  pick: 'info',
  cancelled: 'warning',
  no_pages: 'warning',
  failed: 'danger',
  wrong_user: 'danger',
  not_owner: 'danger',
  not_configured: 'warning',
} as const;
type Notice = keyof typeof NOTICES;
const TIKTOK_NOTICES = {
  connected: 'success',
  cancelled: 'warning',
  failed: 'danger',
  wrong_user: 'danger',
  not_owner: 'danger',
  not_configured: 'warning',
} as const;
type TikTokNotice = keyof typeof TIKTOK_NOTICES;

/**
 * Settings → Social (ADR 0040, 0041): connect the Facebook Page, Instagram and TikTok, then set the autopilot
 * once — when to post, the restaurant's colours and logo, and dishes never to post. After that Xedine
 * posts by itself every day, even when nobody opens the app.
 */
export default async function SocialSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ meta?: string; tiktok?: string }>;
}) {
  const [{ org }, { meta, tiktok }] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();
  const [t, tw] = await Promise.all([
    getTranslations('social.settings'),
    getTranslations('weekdays'),
  ]);
  const supabase = await createClient();
  const columns =
    'autopilot, post_time, post_days, format, language, tone, color_main, color_accent, logo_path, display_name, area, phone, never_item_ids, tiktok_mode';
  // The first visit makes the row, so the form starts from the database defaults (colours included).
  const read = () =>
    supabase.from('social_settings').select(columns).eq('org_id', ctx.org.id).maybeSingle();
  let { data: s } = await read();
  if (!s) {
    await supabase.from('social_settings').insert({ org_id: ctx.org.id });
    ({ data: s } = await read());
  }
  const [{ data: accounts }, { data: items }] = await Promise.all([
    supabase.from('social_accounts').select('platform, name').eq('org_id', ctx.org.id),
    supabase
      .from('menu_items')
      .select('id, name, name_bn, photo_path')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('name'),
  ]);
  const notice = meta && meta in NOTICES ? (meta as Notice) : null;
  const tiktokNotice = tiktok && tiktok in TIKTOK_NOTICES ? (tiktok as TikTokNotice) : null;

  // Pages Facebook offered, by name only: the tokens stay server-side.
  let pages: { id: string; name: string; igName: string | null }[] = [];
  if (notice === 'pick') pages = await pendingPageNames(ctx.org.id, ctx.user.id, now());

  const fb = (accounts ?? []).find((a) => a.platform === 'facebook');
  const ig = (accounts ?? []).find((a) => a.platform === 'instagram');
  const tk = (accounts ?? []).find((a) => a.platform === 'tiktok');
  const dishes = items ?? [];
  const withPhoto = dishes.filter((d) => d.photo_path);
  const days: number[] = (s?.post_days as number[] | undefined) ?? [0, 1, 2, 3, 4, 5, 6];
  const never = new Set((s?.never_item_ids as string[] | undefined) ?? []);
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );

  return (
    <>
      <SettingsNav ctx={ctx} current="social" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {notice ? (
        <Alert tone={NOTICES[notice]} className="mb-6">
          {t(`notice.${notice}`)}
        </Alert>
      ) : null}
      {tiktokNotice ? (
        <Alert tone={TIKTOK_NOTICES[tiktokNotice]} className="mb-6">
          {t(`tiktokNotice.${tiktokNotice}`)}
        </Alert>
      ) : null}

      <Card>
        <CardTitle>{t('connectTitle')}</CardTitle>
        <p className="-mt-2 mb-4 max-w-2xl text-sm text-secondary">{t('connectBody')}</p>
        {fb ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <Share2 aria-hidden className="size-4" />
                <span className="text-secondary">{t('facebookPage')}</span>
                <span className="font-semibold">{fb.name}</span>
                <StatusBadge tone="success">{t('connected')}</StatusBadge>
              </li>
              <li className="flex items-center gap-2">
                <Camera aria-hidden className="size-4" />
                <span className="text-secondary">{t('instagram')}</span>
                {ig ? (
                  <>
                    <span className="font-semibold">{`@${ig.name}`}</span>
                    <StatusBadge tone="success">{t('connected')}</StatusBadge>
                  </>
                ) : (
                  <span className="text-secondary">{t('noInstagram')}</span>
                )}
              </li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/social/meta/start?org=${ctx.org.slug}`}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                {t('reconnect')}
              </a>
              <form action={disconnectSocialAction}>
                {hidden}
                <input type="hidden" name="platform" value="meta" />
                <Button type="submit" variant="ghost" size="sm">
                  {t('disconnect')}
                </Button>
              </form>
            </div>
          </div>
        ) : metaConfigured() ? (
          <a
            href={`/api/social/meta/start?org=${ctx.org.slug}`}
            className={buttonVariants({ variant: 'primary' })}
          >
            <Share2 aria-hidden className="size-4" />
            {t('connect')}
          </a>
        ) : (
          <Alert tone="warning">{t('metaNotConfigured')}</Alert>
        )}
        {pages.length > 0 ? (
          <ActionForm
            action={pickSocialPageAction}
            successKey="social.settings.notice.connected"
            className="mt-4 space-y-2 border-t border-line pt-4"
          >
            <input type="hidden" name="orgSlug" value={ctx.org.slug} />
            <p className="text-sm font-semibold">{t('pickPage')}</p>
            {pages.map((p, i) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="pageId"
                  value={p.id}
                  defaultChecked={i === 0}
                  className="size-4 accent-purple"
                />
                <span className="font-semibold">{p.name}</span>
                <span className="text-secondary">
                  {p.igName ? `@${p.igName}` : t('noInstagramShort')}
                </span>
              </label>
            ))}
            <Button type="submit" size="sm">
              {t('usePage')}
            </Button>
          </ActionForm>
        ) : null}
      </Card>

      <Card className="mt-6">
        <CardTitle>{t('tiktokTitle')}</CardTitle>
        <p className="-mt-2 mb-4 max-w-2xl text-sm text-secondary">{t('tiktokBody')}</p>
        {tk ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm">
              <Clapperboard aria-hidden className="size-4" />
              <span className="text-secondary">{t('tiktokAccount')}</span>
              <span className="font-semibold">{tk.name}</span>
              <StatusBadge tone="success">{t('connected')}</StatusBadge>
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/social/tiktok/start?org=${ctx.org.slug}`}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                {t('tiktokReconnect')}
              </a>
              <form action={disconnectSocialAction}>
                {hidden}
                <input type="hidden" name="platform" value="tiktok" />
                <Button type="submit" variant="ghost" size="sm">
                  {t('disconnect')}
                </Button>
              </form>
            </div>
          </div>
        ) : tiktokConfigured() ? (
          <a
            href={`/api/social/tiktok/start?org=${ctx.org.slug}`}
            className={buttonVariants({ variant: 'primary' })}
          >
            <Clapperboard aria-hidden className="size-4" />
            {t('tiktokConnect')}
          </a>
        ) : (
          <Alert tone="warning">{t('tiktokNotConfigured')}</Alert>
        )}
        <ActionForm
          action={saveTikTokModeAction}
          successKey="common.saved"
          className="mt-4 space-y-3 border-t border-line pt-4"
        >
          {hidden}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">{t('tiktokMode')}</legend>
            {(['draft', 'direct'] as const).map((m) => (
              <label key={m} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="tiktokMode"
                  value={m}
                  defaultChecked={(s?.tiktok_mode ?? 'draft') === m}
                  className="mt-0.5 size-4 accent-purple"
                />
                <span>
                  <span className="block font-semibold">{t(`tiktokModes.${m}`)}</span>
                  <span className="text-secondary">{t(`tiktokModeHints.${m}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" size="sm">
            {t('save')}
          </Button>
        </ActionForm>
      </Card>

      <Card className="mt-6">
        <CardTitle>{t('photosTitle')}</CardTitle>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Camera aria-hidden className="size-4" />
          {t('photosCount', { have: withPhoto.length, total: dishes.length })}
          <Link href={`/${ctx.org.slug}/menu`} className="font-medium text-primary underline">
            {t('photosLink')}
          </Link>
        </p>
        <Hint className="mt-2">{imageAiConfigured() ? t('photosAiOn') : t('photosAiOff')}</Hint>
      </Card>

      <Card className="mt-6">
        <CardTitle>{t('autopilotTitle')}</CardTitle>
        <ActionForm
          action={saveSocialSettingsAction}
          successKey="common.saved"
          className="grid gap-4 sm:grid-cols-2"
        >
          {hidden}
          <label className="flex items-start gap-3 rounded-input border border-line p-3 sm:col-span-2">
            <input
              type="checkbox"
              name="autopilot"
              defaultChecked={Boolean(s?.autopilot)}
              className="mt-1 size-5 accent-purple"
            />
            <span>
              <span className="block font-semibold">{t('autopilotOn')}</span>
              <span className="text-sm text-secondary">{t('autopilotOnHint')}</span>
            </span>
          </label>
          <div>
            <Label htmlFor="so-time">{t('postTime')}</Label>
            <Input
              id="so-time"
              name="postTime"
              type="time"
              required
              defaultValue={String(s?.post_time ?? '13:00').slice(0, 5)}
            />
          </div>
          <div>
            <Label htmlFor="so-format">{t('format')}</Label>
            <Select id="so-format" name="format" defaultValue={s?.format ?? 'mix'}>
              {(['mix', 'image', 'video'] as const).map((f) => (
                <option key={f} value={f}>
                  {t(`formats.${f}`)}
                </option>
              ))}
            </Select>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-semibold">{t('days')}</legend>
            <div className="flex flex-wrap gap-3">
              {[6, 0, 1, 2, 3, 4, 5].map((d) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="days"
                    value={d}
                    defaultChecked={days.includes(d)}
                    className="size-4 accent-purple"
                  />
                  {tw(String(d))}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <Label htmlFor="so-lang">{t('language')}</Label>
            <Select id="so-lang" name="language" defaultValue={s?.language ?? 'both'}>
              {(['both', 'bn', 'en'] as const).map((l) => (
                <option key={l} value={l}>
                  {t(`languages.${l}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="so-tone">{t('tone')}</Label>
            <Select id="so-tone" name="tone" defaultValue={s?.tone ?? 'friendly'}>
              {(['friendly', 'premium', 'fun'] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`tones.${x}`)}
                </option>
              ))}
            </Select>
          </div>

          <h3 className="mt-2 font-semibold sm:col-span-2">{t('lookTitle')}</h3>
          <div className="flex items-end gap-4">
            <div>
              <Label htmlFor="so-main">{t('colorMain')}</Label>
              <input
                id="so-main"
                name="colorMain"
                type="color"
                defaultValue={s?.color_main ?? undefined}
                className="h-11 w-20 cursor-pointer rounded-input border border-line bg-surface"
              />
            </div>
            <div>
              <Label htmlFor="so-accent">{t('colorAccent')}</Label>
              <input
                id="so-accent"
                name="colorAccent"
                type="color"
                defaultValue={s?.color_accent ?? undefined}
                className="h-11 w-20 cursor-pointer rounded-input border border-line bg-surface"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="so-name">{t('displayName')}</Label>
            <Input
              id="so-name"
              name="displayName"
              maxLength={60}
              placeholder={ctx.org.name}
              defaultValue={s?.display_name ?? ''}
            />
          </div>
          <div>
            <Label htmlFor="so-area">{t('area')}</Label>
            <Input id="so-area" name="area" maxLength={80} defaultValue={s?.area ?? ''} />
          </div>
          <div>
            <Label htmlFor="so-phone">{t('phone')}</Label>
            <Input
              id="so-phone"
              name="phone"
              inputMode="tel"
              maxLength={30}
              defaultValue={s?.phone ?? ''}
            />
          </div>

          {withPhoto.length > 0 ? (
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-semibold">{t('never')}</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {withPhoto.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="never"
                      value={d.id}
                      defaultChecked={never.has(d.id)}
                      className="size-4 accent-purple"
                    />
                    {d.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit">{t('save')}</Button>
          </div>
        </ActionForm>
      </Card>

      <Card className="mt-6">
        <CardTitle>{t('logoTitle')}</CardTitle>
        <p className="-mt-2 mb-4 text-sm text-secondary">{t('logoBody')}</p>
        <SocialLogoField
          orgId={ctx.org.id}
          orgSlug={ctx.org.slug}
          logoPath={(s?.logo_path as string | null | undefined) ?? null}
        />
      </Card>
    </>
  );
}
