import { BadgePercent, Coins, Link2Off, MapPin, PenLine, ReceiptText, Ticket } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { getLocale, getTranslations } from 'next-intl/server';
import { DishMenu } from '@/components/dish-menu';
import { QrCode } from '@/components/qr-code';
import { PillNav } from '@/components/ui/pill-nav';
import { RollingFigure } from '@/components/ui/rolling-figure';
import { publicEnv } from '@/lib/env';
import { formatMoney, formatBps, formatDate, formatNumber, type Locale } from '@/lib/i18n/format';
import { memberCardUrl } from '@/modules/customers/member-card';
import { readMemberCard } from '@/modules/customers/member-card-view';
import { CustomerBar } from '../../customer-bar';
import { PassTilt } from '../../pass-tilt';
import { SuccessMark } from '../../success-mark';

// A personal page: never in search results, never cached between customers.
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TABS = ['bills', 'points', 'menu'] as const;

/** Points history: an icon for each kind of change, next to its words. */
const KIND_ICON = { earn: Coins, redeem: Ticket, adjust: PenLine } as const;

/**
 * The customer's member card (ADR 0042): opened from the QR the till shows or the receipt prints. It
 * only reads: points and what they are worth, the member discount, past bills, points history and the
 * menu. The QR on the card is what the cashier scans next time. Drawn as a gold wallet pass (ADR 0063).
 */
export default async function MemberCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ tab?: string; welcome?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const [t, locale] = await Promise.all([getTranslations('memberCard'), getLocale()]);
  const loc = locale as Locale;
  const card = await readMemberCard(token);
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'bills';

  if (!card) {
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

  // The restaurant's own money and clock (ADR 0062).
  const cur = card.currency ?? 'BDT';
  const tz = card.timezone ?? 'Asia/Dhaka';
  const money = (p: number) => formatMoney(p, loc, cur);
  const date = (iso: string) => formatDate(new Date(iso), loc, tz);
  const link = memberCardUrl(publicEnv().NEXT_PUBLIC_SITE_URL, token);

  return (
    <div className="cust-page mx-auto flex min-h-dvh max-w-xl flex-col gap-5 px-4 pb-8">
      <CustomerBar fold>
        <p className="truncate text-[0.9375rem] font-semibold">{card.restaurant}</p>
      </CustomerBar>

      {sp.welcome === '1' ? (
        <div role="status" className="cust-note cust-note--calm">
          <SuccessMark small />
          <p className="font-medium">{t('welcome')}</p>
        </div>
      ) : null}

      <section aria-labelledby="mc-title" className="pt-1">
        <PassTilt className="cust-pass p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2.5">
              <Image
                src="/brand/logo-chef-192.png"
                alt=""
                width={34}
                height={34}
                className="cust-pass-logo"
              />
              <span className="truncate text-[0.9375rem] font-bold tracking-tight">
                {card.restaurant}
              </span>
            </span>
            <p id="mc-title" className="cust-pass-label shrink-0">
              {t('memberCard')}
            </p>
          </div>

          <div className="mt-7">
            <p className="cust-pass-label">{t('points')}</p>
            <p className="cust-pass-figure mt-1.5">
              <RollingFigure value={formatNumber(card.points, loc)} />
            </p>
            <p className="cust-pass-soft mt-1 text-sm font-semibold">
              {t('worth', { amount: money(card.points_worth_poisha) })}
            </p>
          </div>

          <div aria-hidden className="cust-pass-rule my-5" />

          <p className="text-lg leading-tight font-bold">{card.name ?? t('member')}</p>
          <p className="cust-pass-soft mt-1 text-[0.8125rem] font-medium tabular-nums">
            {card.phone} ·{' '}
            {t('since', {
              date: formatDate(new Date(`${card.member_since}T12:00:00Z`), loc, 'UTC'),
            })}
          </p>
          {card.discount_bps !== null ? (
            <p className="cust-pass-chip mt-4">
              <BadgePercent aria-hidden className="size-4" />
              {t('discount', { percent: formatBps(card.discount_bps, loc) })}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col items-center gap-3">
            <div className="cust-qr">
              <QrCode value={link} label={t('qrLabel')} className="size-40" />
            </div>
            <p className="max-w-[17rem] text-center text-[0.8125rem] leading-snug font-semibold">
              {t('showAtCounter')}
            </p>
          </div>
        </PassTilt>
        <p className="mt-3 px-1 text-xs leading-relaxed text-muted">
          {t('rules', {
            points: formatNumber(card.earn_points, loc),
            every: formatMoney(card.earn_every_poisha, loc, cur, { poisha: 'never' }),
            worth: money(card.point_value_poisha),
            min: formatNumber(card.min_redeem_points, loc),
          })}
        </p>
      </section>

      <PillNav
        className="cust-tabs"
        label={t('sections')}
        items={TABS.map((x) => ({
          href: `/m/${token}?tab=${x}`,
          label: t(`tabs.${x}`),
          active: x === tab,
        }))}
      />

      {tab === 'bills' ? (
        <section className="cust-card p-1.5">
          {card.orders.length === 0 ? (
            <p className="flex items-center gap-3 p-3.5 text-sm text-secondary">
              <span className="cust-icon cust-icon--sm">
                <ReceiptText aria-hidden className="size-[1.125rem]" />
              </span>
              {t('noBills')}
            </p>
          ) : (
            <ul className="cust-list cust-list--icons">
              {card.orders.map((o, i) => (
                <li
                  key={o.placed_at}
                  className="cust-rise flex gap-3 px-3 py-3.5"
                  style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
                >
                  <span className="cust-icon cust-icon--sm cust-icon--quiet">
                    <ReceiptText aria-hidden className="size-[1.125rem]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold">{date(o.placed_at)}</p>
                      <p className="cust-price">{money(o.total_poisha)}</p>
                    </div>
                    <p className="mt-0.5 text-sm leading-snug text-secondary">
                      {o.items
                        .map((i) => `${formatNumber(i.quantity, loc)} × ${i.name}`)
                        .join(', ')}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span>{o.branch}</span>
                      {o.points > 0 ? (
                        <span className="cust-facts">
                          <Coins aria-hidden />
                          {t('earned', { points: formatNumber(o.points, loc) })}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'points' ? (
        <section className="cust-card p-1.5">
          {card.history.length === 0 ? (
            <p className="flex items-center gap-3 p-3.5 text-sm text-secondary">
              <span className="cust-icon cust-icon--sm">
                <Coins aria-hidden className="size-[1.125rem]" />
              </span>
              {t('noPoints')}
            </p>
          ) : (
            <ul className="cust-list cust-list--icons">
              {card.history.map((h, i) => {
                const Icon = KIND_ICON[h.kind] ?? PenLine;
                return (
                  <li
                    key={`${h.created_at}-${h.kind}`}
                    className="cust-rise flex items-center gap-3 px-3 py-3"
                    style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
                  >
                    <span className="cust-icon cust-icon--sm cust-icon--quiet">
                      <Icon aria-hidden className="size-[1.125rem]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t(`kind.${h.kind}`)}</span>
                      <span className="block text-xs text-muted">{date(h.created_at)}</span>
                    </span>
                    <span
                      className={`text-lg font-bold tabular-nums ${h.points > 0 ? 'text-success' : 'text-danger'}`}
                    >
                      {h.points > 0 ? '+' : '−'}
                      {formatNumber(Math.abs(h.points), loc)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'menu' ? (
        <section className="space-y-5">
          <DishMenu
            dishes={card.menu}
            locale={loc}
            currency={cur}
            otherLabel={t('otherDishes')}
            navLabel={t('tabs.menu')}
          />
          <p className="px-1 text-xs text-muted">{t('menuNote')}</p>
        </section>
      ) : null}

      {card.branches.length > 0 ? (
        <section className="cust-card p-4">
          <p className="flex items-center gap-2 font-semibold">
            <MapPin aria-hidden className="size-4 text-brand-yellow" />
            {t('visitUs')}
          </p>
          <ul className="mt-2.5 space-y-1.5 text-sm text-secondary">
            {card.branches.map((b) => (
              <li key={b.name}>
                <span className="font-medium text-foreground">{b.name}</span>
                {b.address || b.area ? ` — ${[b.address, b.area].filter(Boolean).join(', ')}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="cust-foot space-y-1">
        <p>{t('readOnly')}</p>
        <p>{t('saveHint')}</p>
      </footer>
    </div>
  );
}
