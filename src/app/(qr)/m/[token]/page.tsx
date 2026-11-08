import type { Metadata } from 'next';
import Image from 'next/image';
import { getLocale, getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { QrCode } from '@/components/qr-code';
import { PillNav } from '@/components/ui/pill-nav';
import { publicEnv } from '@/lib/env';
import {
  formatBDT,
  formatBps,
  formatDhakaDate,
  formatNumber,
  type Locale,
} from '@/lib/i18n/format';
import { memberCardUrl } from '@/modules/customers/member-card';
import { dishPhotoUrl, readMemberCard } from '@/modules/customers/member-card-view';

// A personal page: never in search results, never cached between customers.
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TABS = ['bills', 'points', 'menu'] as const;

/**
 * The customer's member card (ADR 0041): opened from the QR the till shows or the receipt prints. It
 * only reads: points and what they are worth, the member discount, past bills, points history and the
 * menu. The QR on the card is what the cashier scans next time.
 */
export default async function MemberCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ tab?: string }>;
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

  const money = (p: number) => formatBDT(p, loc);
  const date = (iso: string) => formatDhakaDate(new Date(iso), loc);
  const link = memberCardUrl(publicEnv().NEXT_PUBLIC_SITE_URL, token);
  const categories = [...new Set(card.menu.map((m) => m.cat))];

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <p className="truncate text-lg font-bold">{card.restaurant}</p>
        <LocaleSwitcher />
      </header>

      <section className="glass rounded-sheet p-5 sm:p-6" aria-labelledby="mc-title">
        <p id="mc-title" className="text-xs font-semibold tracking-wider text-secondary uppercase">
          {t('memberCard')}
        </p>
        <p className="mt-1 text-xl font-bold">{card.name ?? t('member')}</p>
        <p className="text-sm text-secondary tabular-nums">
          {card.phone} · {t('since', { date: date(`${card.member_since}T12:00:00+06:00`) })}
        </p>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-secondary">{t('points')}</p>
            <p className="text-5xl font-extrabold tracking-tight tabular-nums">
              {formatNumber(card.points, loc)}
            </p>
            <p className="text-sm text-secondary">
              {t('worth', { amount: money(card.points_worth_poisha) })}
            </p>
          </div>
          <div className="rounded-input bg-surface p-2">
            <QrCode value={link} label={t('qrLabel')} className="size-32" />
          </div>
        </div>
        <p className="mt-3 text-sm font-medium">{t('showAtCounter')}</p>
        {card.discount_bps !== null ? (
          <p className="mt-3 rounded-input border border-success/40 bg-success/10 px-3 py-2 text-sm font-semibold">
            {t('discount', { percent: formatBps(card.discount_bps, loc) })}
          </p>
        ) : null}
        <p className="mt-3 text-xs text-secondary">
          {t('rules', {
            points: formatNumber(card.earn_points, loc),
            every: formatBDT(card.earn_every_poisha, loc, { poisha: 'never' }),
            worth: money(card.point_value_poisha),
            min: formatNumber(card.min_redeem_points, loc),
          })}
        </p>
      </section>

      <PillNav
        label={t('sections')}
        items={TABS.map((x) => ({
          href: `/m/${token}?tab=${x}`,
          label: t(`tabs.${x}`),
          active: x === tab,
        }))}
      />

      {tab === 'bills' ? (
        <section className="glass rounded-sheet p-4 sm:p-5">
          {card.orders.length === 0 ? (
            <p className="text-sm text-secondary">{t('noBills')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {card.orders.map((o) => (
                <li key={o.placed_at} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">{date(o.placed_at)}</p>
                    <p className="font-semibold tabular-nums">{money(o.total_poisha)}</p>
                  </div>
                  <p className="text-sm text-secondary">
                    {o.items.map((i) => `${formatNumber(i.quantity, loc)} × ${i.name}`).join(', ')}
                  </p>
                  <p className="text-xs text-secondary">
                    {o.branch}
                    {o.points > 0
                      ? ` · ${t('earned', { points: formatNumber(o.points, loc) })}`
                      : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'points' ? (
        <section className="glass rounded-sheet p-4 sm:p-5">
          {card.history.length === 0 ? (
            <p className="text-sm text-secondary">{t('noPoints')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {card.history.map((h) => (
                <li key={`${h.created_at}-${h.kind}`} className="flex justify-between gap-3 py-2.5">
                  <span>
                    <span className="block font-medium">{t(`kind.${h.kind}`)}</span>
                    <span className="block text-xs text-secondary">{date(h.created_at)}</span>
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${h.points > 0 ? 'text-success' : 'text-danger'}`}
                  >
                    {h.points > 0 ? '+' : '−'}
                    {formatNumber(Math.abs(h.points), loc)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'menu' ? (
        <section className="space-y-4">
          {categories.map((cat) => {
            const items = card.menu.filter((m) => m.cat === cat);
            const first = items[0]!;
            const title = loc === 'bn' && first.cat_bn ? first.cat_bn : cat || t('otherDishes');
            return (
              <div key={cat} className="glass rounded-sheet p-4 sm:p-5">
                <h2 className="mb-2 text-lg font-bold">{title}</h2>
                <ul className="divide-y divide-line">
                  {items.map((m) => (
                    <li
                      key={`${m.name}-${m.price_poisha}`}
                      className="flex items-center gap-3 py-2.5"
                    >
                      {m.photo_path ? (
                        <span className="relative size-14 shrink-0 overflow-hidden rounded-input">
                          <Image
                            src={dishPhotoUrl(m.photo_path)}
                            alt=""
                            fill
                            unoptimized
                            sizes="56px"
                            className="object-cover"
                          />
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {loc === 'bn' && m.name_bn ? m.name_bn : m.name}
                        </span>
                        {m.description ? (
                          <span className="block truncate text-xs text-secondary">
                            {m.description}
                          </span>
                        ) : null}
                      </span>
                      <span className="font-semibold tabular-nums">{money(m.price_poisha)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <p className="text-xs text-secondary">{t('menuNote')}</p>
        </section>
      ) : null}

      {card.branches.length > 0 ? (
        <section className="text-sm text-secondary">
          <p className="font-medium text-foreground">{t('visitUs')}</p>
          <ul>
            {card.branches.map((b) => (
              <li key={b.name}>
                {b.name}
                {b.address || b.area ? ` — ${[b.address, b.area].filter(Boolean).join(', ')}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-auto space-y-1 pt-4 text-xs text-secondary">
        <p>{t('readOnly')}</p>
        <p>{t('saveHint')}</p>
      </footer>
    </div>
  );
}
