import { Gamepad2, IdCard, MessageSquareWarning, Star, UtensilsCrossed } from 'lucide-react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { DishMenu } from '@/components/dish-menu';
import { Mascot } from '@/components/games/mascot';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { OnceForm } from '@/components/once-form';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { formatBDT, formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { memberCardPath } from '@/modules/customers/member-card';
import { readMemberCard } from '@/modules/customers/member-card-view';
import { cardCookieName, isNumberedTable } from '@/modules/customers/table-qr';
import { parseGameNames } from '@/modules/games/catalog';
import { readTablePage } from '@/modules/customers/table-page-view';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const JOIN_MESSAGES = ['known', 'off', 'busy', 'invalid', 'failed', 'gone'] as const;
type JoinMessage = (typeof JOIN_MESSAGES)[number];

/**
 * The customer's table page (ADR 0045): opened by scanning the QR code on the table, with the phone camera,
 * no app and no account. One page: become a member (or see your card), the menu at this branch's prices,
 * a review on Google, and the private complaint box.
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
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4 py-10">
        <div className="self-end">
          <LocaleSwitcher />
        </div>
        <div className="glass rounded-sheet p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight">{t('goneTitle')}</h1>
          <p className="mt-2 text-secondary">{t('goneBody')}</p>
        </div>
      </div>
    );
  }

  // The card this phone joined with before (a cookie per restaurant); a reset or switched-off card is ignored.
  const saved = jar.get(cardCookieName(page.org_id))?.value;
  const card = page.member_on && saved ? await readMemberCard(saved) : null;
  const join = (JOIN_MESSAGES as readonly string[]).includes(sp.join ?? '')
    ? (sp.join as JoinMessage)
    : null;
  const tableName = isNumberedTable(page.table)
    ? t('tableN', { n: formatNumber(Number(page.table), loc) })
    : page.table;
  const complaintHref = `/c/${page.complaint_token}`;

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
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{page.restaurant}</p>
          <p className="truncate text-sm text-secondary">
            {page.branch} · {tableName}
          </p>
        </div>
        <LocaleSwitcher />
      </header>

      <section className="glass rounded-sheet p-5 sm:p-6">
        <h1 className="text-2xl font-extrabold tracking-tight">
          {t('welcome', { restaurant: page.restaurant })}
        </h1>
        <p className="mt-1 text-secondary">{t('welcomeBody', { table: tableName })}</p>
        <nav aria-label={t('shortcuts')} className="mt-4 grid grid-cols-2 gap-2">
          {shortcuts.map(({ href, icon: Icon, label }) => (
            <a
              key={href}
              href={href}
              className="glass-tile flex min-h-14 items-center gap-2 rounded-input px-3 py-2 text-sm font-semibold"
            >
              <Icon aria-hidden className="size-5 shrink-0 text-purple" />
              {label}
            </a>
          ))}
        </nav>
      </section>

      {page.games_on ? (
        <a href={gamesHref} className="glass flex items-center gap-4 rounded-sheet p-4 sm:p-5">
          <Mascot mood="cheer" className="size-20 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-xl font-bold">{t('gamesTitle')}</span>
            <span className="block text-sm text-secondary">
              {t('gamesBody', { host: hostName })}
            </span>
            <span className="mt-2 inline-flex min-h-10 items-center rounded-full bg-action px-4 text-sm font-semibold text-on-action">
              {t('gamesPlay')}
            </span>
          </span>
        </a>
      ) : null}

      {page.member_on ? (
        <section id="join" className="glass scroll-mt-4 rounded-sheet p-5 sm:p-6">
          {card ? (
            <>
              <p className="text-xs font-semibold tracking-wider text-secondary uppercase">
                {t('yourCard')}
              </p>
              <p className="mt-1 text-xl font-bold">{card.name ?? t('member')}</p>
              <p className="mt-3 text-4xl font-extrabold tracking-tight tabular-nums">
                {t('points', { n: formatNumber(card.points, loc) })}
              </p>
              <p className="text-sm text-secondary">
                {t('worth', { amount: formatBDT(card.points_worth_poisha, loc) })}
              </p>
              <a
                href={memberCardPath(saved!)}
                className="mt-4 inline-flex min-h-11 items-center rounded-full bg-action px-5 text-sm font-semibold text-on-action"
              >
                {t('openCard')}
              </a>
              <p className="mt-2 text-xs text-secondary">{t('showAtCounter')}</p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold">{t('joinTitle')}</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {page.discount_bps !== null ? (
                  <li className="font-semibold text-success">
                    {t('joinDiscount', { percent: formatBps(page.discount_bps, loc) })}
                  </li>
                ) : null}
                {page.earn_points && page.earn_every_poisha && page.point_value_poisha ? (
                  <li>
                    {t('joinPoints', {
                      points: formatNumber(page.earn_points, loc),
                      every: formatBDT(page.earn_every_poisha, loc, { poisha: 'never' }),
                      worth: formatBDT(page.point_value_poisha, loc),
                    })}
                  </li>
                ) : null}
                <li>{t('joinNoApp')}</li>
              </ul>
              {join ? (
                <p
                  role="status"
                  className="mt-3 rounded-input border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
                >
                  {t(`join.${join}`)}
                </p>
              ) : null}
              <OnceForm method="post" action="/api/webhooks/join" className="mt-4 space-y-3">
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
                  <Label htmlFor="j-phone">{t('phone')}</Label>
                  <Input
                    id="j-phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    required
                    maxLength={30}
                    autoComplete="tel"
                    placeholder="01XXXXXXXXX"
                  />
                </div>
                <div>
                  <Label htmlFor="j-name">{t('name')}</Label>
                  <Input id="j-name" name="name" maxLength={120} autoComplete="name" />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="offers" className="mt-1" />
                  {t('offers')}
                </label>
                <Button type="submit" className="w-full">
                  {t('joinButton')}
                </Button>
                <p className="text-xs text-secondary">{t('joinPrivacy')}</p>
              </OnceForm>
            </>
          )}
        </section>
      ) : null}

      <section id="review" className="glass scroll-mt-4 rounded-sheet p-5 sm:p-6">
        <h2 className="text-xl font-bold">{t('reviewTitle')}</h2>
        <div className="mt-3 grid gap-2">
          {page.google_review_url ? (
            <a
              href={page.google_review_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-action px-5 text-sm font-semibold text-on-action"
            >
              <Star aria-hidden className="size-4" />
              {t('reviewGoogle')}
            </a>
          ) : null}
          <a
            href={complaintHref}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-semibold"
          >
            <MessageSquareWarning aria-hidden className="size-4" />
            {t('reviewPrivate')}
          </a>
        </div>
        <p className="mt-2 text-xs text-secondary">{t('reviewPrivateHint')}</p>
      </section>

      <section id="menu" className="scroll-mt-4 space-y-4">
        <h2 className="px-1 text-xl font-bold">{t('menuTitle')}</h2>
        {page.menu.length === 0 ? (
          <p className="glass rounded-sheet p-5 text-sm text-secondary">{t('menuEmpty')}</p>
        ) : (
          <DishMenu dishes={page.menu} locale={loc} otherLabel={t('otherDishes')} />
        )}
        <p className="px-1 text-xs text-secondary">{t('menuNote')}</p>
      </section>

      <footer className="mt-auto space-y-1 pt-4 text-xs text-secondary">
        {page.address ? <p>{page.address}</p> : null}
        <p>{t('footer')}</p>
      </footer>
    </div>
  );
}
