import {
  BadgePercent,
  ChevronRight,
  Coins,
  Gamepad2,
  IdCard,
  Info,
  Link2Off,
  Lock,
  MapPin,
  MessageSquareWarning,
  Smartphone,
  Star,
  TriangleAlert,
  UtensilsCrossed,
} from 'lucide-react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Image from 'next/image';
import { getLocale, getTranslations } from 'next-intl/server';
import { Mascot } from '@/components/games/mascot';
import { NotifyOffersField } from '@/components/notify-offers-field';
import { OnceForm } from '@/components/once-form';
import { TableMenu, type TableDish } from '@/components/table-menu';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { RollingFigure } from '@/components/ui/rolling-figure';
import { formatMoney, formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { aiConfigured } from '@/lib/llm-gateway';
import { vapidPublicKey } from '@/modules/customers/jobs/push';
import { memberCardPath } from '@/modules/customers/member-card';
import { dishPhotoUrl, readMemberCard } from '@/modules/customers/member-card-view';
import { cardCookieName, isNumberedTable } from '@/modules/customers/table-qr';
import { parseGameNames } from '@/modules/games/catalog';
import { readTablePage } from '@/modules/customers/table-page-view';
import { CustomerBar } from '../../customer-bar';
import { PassTilt } from '../../pass-tilt';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const JOIN_MESSAGES = ['known', 'off', 'busy', 'invalid', 'failed', 'gone'] as const;
type JoinMessage = (typeof JOIN_MESSAGES)[number];

/**
 * The customer's table page (ADR 0045): opened by scanning the QR code on the table, with the phone camera,
 * no app and no account. One page: become a member (or see your card), the menu at this branch's prices,
 * a review on Google, and the private complaint box. ADR 0063: a large welcome over big glass tiles, a top
 * bar that frosts as the page scrolls, the card as a gold pass.
 */
export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ join?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const [t, locale, page, jar] = await Promise.all([
    getTranslations('tablePage'),
    getLocale(),
    readTablePage(token),
    cookies(),
  ]);
  const loc = locale as Locale;

  if (!page) {
    return (
      <div className="cust-page mx-auto flex min-h-dvh max-w-xl flex-col px-4">
        <CustomerBar />
        <main className="flex flex-1 flex-col justify-center py-10">
          <section className="cust-card cust-state">
            <span className="cust-alert">
              <Link2Off aria-hidden />
            </span>
            <h1 className="cust-title mt-5">{t('goneTitle')}</h1>
            <p className="mt-2 max-w-sm text-secondary">{t('goneBody')}</p>
          </section>
        </main>
      </div>
    );
  }

  // The restaurant's own money (ADR 0062).
  const cur = page.currency;
  // The card this phone joined with before (a cookie per restaurant); a reset or switched-off card is ignored.
  const saved = jar.get(cardCookieName(page.org_id))?.value;
  const card = page.member_on && saved ? await readMemberCard(saved) : null;
  // Only a visitor who can still join needs the key that lets their phone get offer notifications (ADR 0048).
  const pushKey = page.member_on && !card ? await vapidPublicKey() : null;
  const join = (JOIN_MESSAGES as readonly string[]).includes(sp.join ?? '')
    ? (sp.join as JoinMessage)
    : null;
  const tableName = isNumberedTable(page.table)
    ? t('tableN', { n: formatNumber(Number(page.table), loc) })
    : page.table;
  const complaintHref = `/c/${page.complaint_token}`;
  // The menu with each dish's approved food facts (ADR 0049); photo links are made here, on the server.
  const dishes: TableDish[] = page.menu.map((m) => ({
    ...m,
    photoUrl: m.photo_path ? dishPhotoUrl(m.photo_path) : null,
  }));

  const gamesHref = `/t/${token}/games`;
  const hostName = parseGameNames(page.game_names).host ?? t('hostName');
  const shortcuts = [
    ...(page.games_on ? [{ href: gamesHref, icon: Gamepad2, label: t('goGames') }] : []),
    { href: '#menu', icon: UtensilsCrossed, label: t('goMenu') },
    ...(page.member_on ? [{ href: '#join', icon: IdCard, label: t('goMember') }] : []),
    ...(page.google_review_url ? [{ href: '#review', icon: Star, label: t('goReview') }] : []),
    { href: complaintHref, icon: MessageSquareWarning, label: t('goComplaint') },
  ];

  return (
    <div className="cust-page mx-auto flex min-h-dvh max-w-xl flex-col gap-5 px-4 pb-8">
      <CustomerBar fold>
        <p className="truncate text-[0.9375rem] leading-tight font-semibold">{page.restaurant}</p>
        <p className="truncate text-xs text-muted">
          {page.branch} · {tableName}
        </p>
      </CustomerBar>

      <section className="pt-2">
        <p className="cust-eyebrow">
          <MapPin aria-hidden className="size-3.5" />
          <span className="truncate">
            {page.branch} · {tableName}
          </span>
        </p>
        <h1 className="cust-display mt-2.5">{t('welcome', { restaurant: page.restaurant })}</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-secondary">
          {t('welcomeBody', { table: tableName })}
        </p>
        <nav aria-label={t('shortcuts')} className="cust-tiles mt-6">
          {shortcuts.map(({ href, icon: Icon, label }, i) => (
            <a
              key={href}
              href={href}
              className="cust-tile"
              style={{ '--i': i } as React.CSSProperties}
            >
              <span className="cust-icon">
                <Icon aria-hidden className="size-[1.375rem]" />
              </span>
              <span className="min-w-0">{label}</span>
              <ChevronRight aria-hidden className="cust-tile-go" />
            </a>
          ))}
        </nav>
      </section>

      {page.games_on ? (
        <a href={gamesHref} className="cust-feature">
          <Mascot mood="cheer" className="size-[5.25rem] shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-lg leading-tight font-bold tracking-tight">
              {t('gamesTitle')}
            </span>
            <span className="mt-1 block text-sm leading-snug text-secondary">
              {t('gamesBody', { host: hostName })}
            </span>
            <span className="cust-cta mt-3">
              {t('gamesPlay')}
              <ChevronRight aria-hidden className="size-4" />
            </span>
          </span>
        </a>
      ) : null}

      {page.member_on ? (
        <section id="join" className="scroll-mt-20">
          {card ? (
            <>
              <PassTilt className="cust-pass p-5">
                <div className="flex items-center gap-2.5">
                  <Image
                    src="/brand/logo-chef-192.png"
                    alt=""
                    width={30}
                    height={30}
                    className="cust-pass-logo"
                  />
                  <p className="cust-pass-label min-w-0 truncate">{t('yourCard')}</p>
                </div>
                <p className="mt-5 text-lg leading-tight font-bold">{card.name ?? t('member')}</p>
                <p className="cust-pass-figure cust-pass-figure--md mt-1.5">
                  <RollingFigure value={t('points', { n: formatNumber(card.points, loc) })} />
                </p>
                <p className="cust-pass-soft mt-1 text-sm font-semibold">
                  {t('worth', { amount: formatMoney(card.points_worth_poisha, loc, cur) })}
                </p>
                <a href={memberCardPath(saved!)} className="cust-cta cust-cta--ink mt-5">
                  {t('openCard')}
                  <ChevronRight aria-hidden className="size-4" />
                </a>
              </PassTilt>
              <p className="mt-2.5 px-1 text-xs text-muted">{t('showAtCounter')}</p>
            </>
          ) : (
            <div className="cust-card p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="cust-icon">
                  <IdCard aria-hidden className="size-[1.375rem]" />
                </span>
                <h2 className="cust-h2 min-w-0">{t('joinTitle')}</h2>
              </div>
              <ul className="mt-4 space-y-2.5 text-[0.9375rem] leading-snug">
                {page.discount_bps !== null ? (
                  <li className="flex items-start gap-2.5 font-semibold text-foreground">
                    <BadgePercent
                      aria-hidden
                      className="mt-px size-[1.125rem] shrink-0 text-brand-yellow"
                    />
                    {t('joinDiscount', { percent: formatBps(page.discount_bps, loc) })}
                  </li>
                ) : null}
                {page.earn_points && page.earn_every_poisha && page.point_value_poisha ? (
                  <li className="flex items-start gap-2.5 text-secondary">
                    <Coins
                      aria-hidden
                      className="mt-px size-[1.125rem] shrink-0 text-brand-yellow"
                    />
                    {t('joinPoints', {
                      points: formatNumber(page.earn_points, loc),
                      every: formatMoney(page.earn_every_poisha, loc, cur, { poisha: 'never' }),
                      worth: formatMoney(page.point_value_poisha, loc, cur),
                    })}
                  </li>
                ) : null}
                <li className="flex items-start gap-2.5 text-secondary">
                  <Smartphone
                    aria-hidden
                    className="mt-px size-[1.125rem] shrink-0 text-brand-yellow"
                  />
                  {t('joinNoApp')}
                </li>
              </ul>
              {join ? (
                <p role="status" className="cust-note cust-note--warn mt-4">
                  {join === 'known' || join === 'off' ? (
                    <Info aria-hidden />
                  ) : (
                    <TriangleAlert aria-hidden />
                  )}
                  {t(`join.${join}`)}
                </p>
              ) : null}
              <OnceForm method="post" action="/api/webhooks/join" className="mt-5 space-y-4">
                <input type="hidden" name="token" value={token} />
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                  className="sr-only"
                />
                <div>
                  <Label htmlFor="j-phone" className="cust-label">
                    {t('phone')}
                  </Label>
                  <Input
                    id="j-phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    required
                    maxLength={30}
                    autoComplete="tel"
                    placeholder="01XXXXXXXXX"
                    className="cust-field"
                  />
                </div>
                <div>
                  <Label htmlFor="j-name" className="cust-label">
                    {t('name')}
                  </Label>
                  <Input
                    id="j-name"
                    name="name"
                    maxLength={120}
                    autoComplete="name"
                    className="cust-field"
                  />
                </div>
                <NotifyOffersField publicKey={pushKey} />
                <Button type="submit" size="lg" className="w-full">
                  {t('joinButton')}
                </Button>
                <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                  <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {t('joinPrivacy')}
                </p>
              </OnceForm>
            </div>
          )}
        </section>
      ) : null}

      <section id="review" className="cust-card scroll-mt-20 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="cust-icon">
            <Star aria-hidden className="size-[1.375rem]" />
          </span>
          <h2 className="cust-h2 min-w-0">{t('reviewTitle')}</h2>
        </div>
        <div className="mt-4 grid gap-2.5">
          {page.google_review_url ? (
            <a
              href={page.google_review_url}
              target="_blank"
              rel="noreferrer"
              className="cust-cta cust-cta--block"
            >
              <Star aria-hidden className="size-4" />
              {t('reviewGoogle')}
            </a>
          ) : null}
          <a href={complaintHref} className="cust-cta cust-cta--ghost cust-cta--block">
            <MessageSquareWarning aria-hidden className="size-4" />
            {t('reviewPrivate')}
          </a>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">{t('reviewPrivateHint')}</p>
      </section>

      <section id="menu" className="scroll-mt-20 space-y-4">
        <h2 className="cust-h2 px-1 pt-2">{t('menuTitle')}</h2>
        {page.menu.length === 0 ? (
          <p className="cust-card p-5 text-sm text-secondary">{t('menuEmpty')}</p>
        ) : (
          <TableMenu
            currency={cur}
            dishes={dishes}
            token={token}
            aiOn={aiConfigured()}
            otherLabel={t('otherDishes')}
          />
        )}
        <p className="px-1 text-xs text-muted">{t('menuNote')}</p>
      </section>

      <footer className="cust-foot">
        {page.address ? <p>{page.address}</p> : null}
        <p>{t('footer')}</p>
      </footer>
    </div>
  );
}
