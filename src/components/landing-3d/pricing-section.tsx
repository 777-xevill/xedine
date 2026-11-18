'use client';

import { Check, ChevronDown, X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  memo,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  formatMoney,
  formatNumber,
  isLocale,
  type Locale,
} from '@/lib/i18n/format';
import { LEGAL_CONTACT } from '@/lib/contact';
import { cn } from '@/lib/utils';
import {
  limitOf,
  PARTNER,
  PLAN_ROWS,
  PLANS,
  TRIAL_DAYS,
  YEARLY_OFF_PERCENT,
  yearlyMonthly,
  type Limit,
} from './pricing';

/** How tall a plan's list is before "See more" (about seven rows). */
const CLOSED_PX = 286;
/** Rows from here on are under the fold: they come in one by one when it opens. */
const LATE_FROM = 7;

type Variant = 'plain' | 'featured' | 'gold';

/**
 * The home page's pricing, between the 3D day and the A–Z list (the founder's reference, 2026-11-18): a huge
 * word behind three clean glass cards in one row — Starter ($19), Pro ($27, the plan Xedine sells: first on a
 * phone, the yellow button and a light running round its edge) and Partner ($250, the most powerful: a sliding
 * gold ring). Each card: its name, the price, a line, a list of ticks and crosses, the button at the bottom. The
 * lists fold under "See more" and open together, so the rows line up.
 */
export const PricingSection = memo(function PricingSection() {
  const t = useTranslations('landing3d.day.pricing');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const n = (v: number) => formatNumber(v, locale);
  const [open, setOpen] = useState(false);
  const [yearly, setYearly] = useState(false);
  // The price a month, and what the year comes to when paid yearly (25% off, every plan).
  const priceOf = (minor: number, currency: string) => {
    const month = yearly ? yearlyMonthly(minor) : minor;
    return {
      price: formatMoney(month, locale, currency),
      billing: yearly
        ? t('billedYear', { total: formatMoney(month * 12, locale, currency) })
        : t('billedMonth'),
    };
  };
  const toggle = () => setOpen((o) => !o);
  const days = n(TRIAL_DAYS);
  const badge = (limit: Limit) =>
    limit === 'unlimited'
      ? t('unlimited')
      : t(limit.per === 'day' ? 'perDay' : 'perWeek', { n: n(limit.n) });
  const counts = {
    films: n(PARTNER.filmsPerMonth),
    reels: n(PARTNER.reelsPerMonth),
    n: n(PARTNER.deepAiPerWeek),
  };

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="relative overflow-hidden bg-background px-4 pt-14 pb-16 sm:px-8 sm:pt-20 sm:pb-24"
    >
      {/* The big word: the cards cover its lower half and blur it, like frosted glass. */}
      <p
        aria-hidden
        className="pointer-events-none mx-auto text-center text-[25vw] leading-[0.8] font-bold tracking-[-0.05em] text-[var(--brand-silver)] select-none sm:text-[11rem] lg:text-[13rem]"
      >
        {t('title')}
      </p>
      <div className="relative mx-auto -mt-[9vw] max-w-6xl sm:-mt-20 lg:-mt-24">
        <h2 id="pricing-title" className="sr-only">
          {t('title')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.code}
              variant={plan.featured ? 'featured' : 'plain'}
              name={t(`plans.${plan.code}.name`)}
              badge={plan.featured ? t('badge') : undefined}
              {...priceOf(plan.minor, plan.currency)}
              body={t(`plans.${plan.code}.body`)}
              open={open}
              onToggle={toggle}
              rows={PLAN_ROWS.map((r) => {
                const has = !plan.without.has(r.id);
                const limit = limitOf(plan, r.id);
                return {
                  key: r.id,
                  has,
                  text: t(`rows.${r.id}`),
                  tag: has ? (r.soon ? t('soon') : limit && badge(limit)) : undefined,
                };
              })}
              action={
                <Link
                  href="/sign-up"
                  className={cn(
                    'relative block overflow-hidden rounded-full py-3 text-center text-sm font-semibold transition-transform active:scale-[0.98]',
                    plan.featured
                      ? 'btn-shine plan-cta bg-[var(--brand-yellow)] text-[var(--brand-grey)]'
                      : 'border border-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)] bg-[color-mix(in_srgb,var(--brand-grey)_85%,transparent)] hover:border-[var(--brand-yellow)]',
                  )}
                >
                  {t('cta', { days })}
                </Link>
              }
            />
          ))}
          <PlanCard
            variant="gold"
            name={t('plans.partner.name')}
            badge={t('partner.badge')}
            {...priceOf(PARTNER.minor, PARTNER.currency)}
            body={t('plans.partner.body')}
            open={open}
            onToggle={toggle}
            rows={[
              { key: 'everything', has: true, text: t('partner.everything'), strong: true },
              ...PARTNER.services.map((id) => ({
                key: id,
                has: true,
                text: t(`partner.services.${id}`, counts),
                tag: id === 'deepAi' ? t('soon') : undefined,
              })),
            ]}
            foot={t('partner.excluded')}
            action={
              <a
                href={`mailto:${LEGAL_CONTACT}?subject=${encodeURIComponent(t('partner.mailSubject'))}`}
                className="btn-shine relative block overflow-hidden rounded-full border border-[var(--brand-yellow)] bg-[color-mix(in_srgb,var(--brand-grey)_85%,transparent)] py-3 text-center text-sm font-semibold text-[var(--brand-yellow)] transition-[transform,background-color] hover:bg-[color-mix(in_srgb,var(--brand-yellow)_12%,transparent)] active:scale-[0.98]"
              >
                {t('partner.cta')}
              </a>
            }
          />
        </div>
        {/* Monthly or yearly, like the reference: a switch under the cards. */}
        <div className="mt-6 flex items-center justify-center gap-3 md:justify-start">
          <button
            type="button"
            role="switch"
            aria-checked={yearly}
            aria-label={t('yearly')}
            onClick={() => setYearly((y) => !y)}
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300',
              yearly
                ? 'border-[var(--brand-yellow)] bg-[var(--brand-yellow)]'
                : 'border-[color-mix(in_srgb,var(--brand-silver)_25%,transparent)] bg-[color-mix(in_srgb,var(--brand-silver)_10%,transparent)]',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'absolute top-1/2 left-0.5 size-[18px] -translate-y-1/2 rounded-full shadow transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none',
                yearly ? 'translate-x-5 bg-[var(--brand-grey)]' : 'bg-[var(--brand-silver)]',
              )}
            />
          </button>
          <span className="text-sm font-medium">{t('yearly')}</span>
          <span className="rounded-full border border-[color-mix(in_srgb,var(--brand-yellow)_50%,transparent)] px-2 py-0.5 text-[11px] font-bold text-[var(--brand-yellow)]">
            {t('save', { pct: n(YEARLY_OFF_PERCENT) })}
          </span>
        </div>
        <p className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[color:var(--text-muted)]">
          <span className="flex items-center gap-1">
            <Mark yes /> {t('legendYes')}
          </span>
          <span className="flex items-center gap-1">
            <Mark yes={false} /> {t('legendNo')}
          </span>
          <span>{t('noCard')}</span>
          <span>{t('note')}</span>
        </p>
      </div>
    </section>
  );
});

type Row = { key: string; has: boolean; text: string; tag?: string | false; strong?: boolean };

function PlanCard({
  variant,
  name,
  badge,
  price,
  billing,
  body,
  rows,
  foot,
  action,
  open,
  onToggle,
}: {
  variant: Variant;
  name: string;
  badge?: string;
  price: string;
  billing: string;
  body: string;
  rows: readonly Row[];
  foot?: string;
  action: ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('landing3d.day.pricing');
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [fullPx, setFullPx] = useState<number | null>(null);

  // The open height is the list's own height, so the fold slides exactly (and follows a resize / language).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setFullPx(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const folds = fullPx === null || fullPx > CLOSED_PX;

  return (
    <article
      className={cn(
        'relative flex flex-col rounded-[1.5rem] shadow-[var(--rim)]',
        variant === 'featured' && 'plan-rim order-first lg:order-none',
        variant === 'gold' &&
          'plan-gold shadow-[0_0_70px_-34px_color-mix(in_srgb,var(--brand-yellow)_60%,transparent)] md:col-span-2 lg:col-span-1',
        variant === 'plain' &&
          'border border-[color-mix(in_srgb,var(--brand-silver)_12%,transparent)]',
      )}
    >
      <div className="flex flex-1 flex-col rounded-[inherit] bg-[color-mix(in_srgb,var(--brand-grey)_58%,transparent)] backdrop-blur-2xl">
        {/* Name and price */}
        <div data-reveal className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm text-[color:var(--text-secondary)]">{name}</h3>
            {badge && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-bold',
                  variant === 'featured'
                    ? 'bg-[var(--brand-yellow)] text-[var(--brand-grey)]'
                    : 'border border-[color-mix(in_srgb,var(--brand-yellow)_60%,transparent)] text-[var(--brand-yellow)]',
                )}
              >
                {badge}
              </span>
            )}
          </div>
          {/* Re-keyed on every change so the new price rises in. */}
          <p
            key={price}
            className="animate-rise-in mt-4 text-[2.6rem] leading-none font-bold tracking-[-0.03em]"
          >
            {price}
            <span className="text-[color-mix(in_srgb,var(--brand-silver)_55%,transparent)]">
              {t('perMonthShort')}
            </span>
          </p>
          <p className="mt-2 text-[11px] font-medium text-[color:var(--text-muted)]">{billing}</p>
          <p className="mt-3 min-h-[3.75rem] text-[13px] leading-relaxed text-[color:var(--text-muted)]">
            {body}
          </p>
        </div>
        <div className="h-px bg-[color-mix(in_srgb,var(--brand-silver)_10%,transparent)]" />

        {/* What it has: ticks and crosses */}
        <div className="flex flex-1 flex-col px-6 pt-5">
          <div
            className="relative overflow-hidden transition-[height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ height: open || !folds ? (fullPx ?? 'auto') : CLOSED_PX }}
          >
            <ul ref={listRef} id={listId} data-open={open} className="plan-list">
              {rows.map((r, i) => (
                <li
                  key={r.key}
                  data-late={i >= LATE_FROM || undefined}
                  style={{ '--i': i - LATE_FROM } as CSSProperties}
                  className="flex items-center gap-3 py-[7px] text-[13px]"
                >
                  <Mark yes={r.has} />
                  <span
                    className={cn(
                      'min-w-0 flex-1',
                      r.strong
                        ? 'font-semibold text-[color:var(--text-secondary)]'
                        : r.has
                          ? 'text-[color:var(--text-secondary)]'
                          : 'text-[color-mix(in_srgb,var(--brand-silver)_45%,transparent)]',
                    )}
                  >
                    {r.text}
                    {!r.has && <span className="sr-only"> — {t('legendNo')}</span>}
                  </span>
                  {r.tag && (
                    <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--brand-yellow)_35%,transparent)] px-2 py-px text-[10px] font-semibold text-[var(--brand-yellow)]">
                      {r.tag}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {folds && (
              <div
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-[color-mix(in_srgb,var(--brand-grey)_92%,transparent)] transition-opacity duration-500',
                  open && 'opacity-0',
                )}
              />
            )}
          </div>
          {folds && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={onToggle}
              className="mx-auto mt-3 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-[color:var(--text-secondary)] transition-colors hover:text-[var(--brand-yellow)]"
            >
              {open ? t('less') : t('more')}
              <ChevronDown
                aria-hidden
                className={cn('size-4 transition-transform duration-500', open && 'rotate-180')}
              />
            </button>
          )}
          {foot && (
            <p className="mt-3 text-[11px] leading-relaxed text-[color:var(--text-muted)]">
              {foot}
            </p>
          )}
        </div>

        {/* The button, always at the bottom so the three line up */}
        <div className="mt-auto px-6 pt-5 pb-6">{action}</div>
      </div>
    </article>
  );
}

/** A tick in a small ring (in the plan) or a cross in a dim one (a bigger plan). */
function Mark({ yes }: { yes: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-[18px] shrink-0 place-items-center rounded-full',
        yes
          ? 'bg-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)] text-[var(--brand-yellow)]'
          : 'bg-[color-mix(in_srgb,var(--brand-silver)_6%,transparent)] text-[color-mix(in_srgb,var(--brand-silver)_45%,transparent)]',
      )}
    >
      {yes ? (
        <Check className="size-[11px]" strokeWidth={3} />
      ) : (
        <X className="size-[11px]" strokeWidth={3} />
      )}
    </span>
  );
}
