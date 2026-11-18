'use client';

import { Check, ChevronDown, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { memo, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  DEFAULT_LOCALE,
  formatMoney,
  formatNumber,
  isLocale,
  type Locale,
} from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { PLAN_PRICE, PLAN_ROWS, TRIAL_DAYS, WEEKLY_LIMITS, type PlanRowId } from './pricing';

/** How tall the feature list is before "See more" (about five rows a column). */
const CLOSED_PX = 232;
/** Rows from here on are under the fold even on a PC (two columns of five): they come in one by one. */
const LATE_FROM = 10;

/**
 * The home page's pricing, between the 3D day and the A–Z list (the founder, 2026-11-18): one plan from $19 a
 * month on glass over a huge word. Its weekly limits as four tiles, then every feature Xedine has with a tick
 * (in this plan) or a cross (a bigger plan), folded under "See more" so the page stays short. A yellow light
 * runs round the card's edge; the rows come in one after another when it opens.
 */
export const PricingSection = memo(function PricingSection() {
  const t = useTranslations('landing3d.day');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const [open, setOpen] = useState(false);
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

  const days = formatNumber(TRIAL_DAYS, locale);
  const n = (v: number) => formatNumber(v, locale);
  const name = (id: PlanRowId) =>
    id === 'deliveryChannels' || id === 'deepAi'
      ? t(`pricing.extra.${id}`)
      : t(`features.${id}.name`);
  const included = PLAN_ROWS.filter((r) => r.included).length;

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="relative overflow-hidden bg-background px-4 pt-14 pb-16 sm:px-8 sm:pt-20 sm:pb-24"
    >
      {/* The big word: the card covers its lower half and blurs it, like frosted glass. */}
      <p
        aria-hidden
        className="pointer-events-none mx-auto text-center text-[25vw] leading-[0.8] font-bold tracking-[-0.05em] text-[var(--brand-silver)] select-none sm:text-[11rem] lg:text-[13rem]"
      >
        {t('pricing.title')}
      </p>
      <div className="relative mx-auto -mt-[9vw] max-w-3xl sm:-mt-20 lg:-mt-24">
        <h2 id="pricing-title" className="sr-only">
          {t('pricing.title')}
        </h2>
        <article className="plan-rim relative rounded-[1.75rem] shadow-[var(--rim)]">
          <div className="rounded-[inherit] bg-[color-mix(in_srgb,var(--brand-grey)_70%,transparent)] backdrop-blur-2xl">
            {/* Name, price and the button */}
            <div data-reveal className="flex flex-col gap-5 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-8">
              <div>
                <p className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--brand-yellow)_45%,transparent)] bg-[color-mix(in_srgb,var(--brand-yellow)_10%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-yellow)]">
                  <Sparkles aria-hidden className="size-3.5" />
                  {t('pricing.name')}
                </p>
                <p className="mt-4 flex items-baseline gap-1">
                  <span className="text-xs font-semibold text-[color:var(--text-muted)]">
                    {t('pricing.from')}
                  </span>
                  <span className="text-5xl font-bold tracking-[-0.04em] sm:text-6xl">
                    {formatMoney(PLAN_PRICE.minor, locale, PLAN_PRICE.currency)}
                  </span>
                  <span className="text-xl font-semibold text-[color:var(--text-muted)]">
                    {t('pricing.perMonth')}
                  </span>
                </p>
                <p className="mt-2 max-w-sm text-sm text-[color:var(--text-secondary)]">
                  {t('pricing.body')}
                </p>
              </div>
              <div className="sm:w-60">
                <Link
                  href="/sign-up"
                  className="btn-shine plan-cta relative block overflow-hidden rounded-full bg-[var(--brand-yellow)] py-3.5 text-center text-sm font-semibold text-[var(--brand-grey)] transition-transform active:scale-[0.98]"
                >
                  {t('pricing.cta', { days })}
                </Link>
                <p className="mt-2 text-center text-xs text-[color:var(--text-muted)]">
                  {t('pricing.noCard')}
                </p>
              </div>
            </div>

            {/* The weekly limits */}
            <ul data-reveal className="grid grid-cols-2 gap-2 px-6 sm:grid-cols-4 sm:gap-3 sm:px-8">
              {WEEKLY_LIMITS.map((l) => (
                <li
                  key={l.id}
                  className="plan-tile relative rounded-2xl border border-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)] bg-[color-mix(in_srgb,var(--brand-silver)_5%,transparent)] p-3"
                >
                  {l.soon && (
                    <span className="absolute top-2.5 right-2.5 flex items-center gap-1 text-[10px] font-semibold text-[var(--brand-yellow)]">
                      <span className="animate-pulse-dot size-1.5 rounded-full bg-[var(--brand-yellow)]" />
                      {t('pricing.soon')}
                    </span>
                  )}
                  <p className="text-2xl font-bold text-[var(--brand-yellow)]">{n(l.perWeek)}</p>
                  <p className="mt-0.5 text-xs leading-snug text-[color:var(--text-secondary)]">
                    {t(`pricing.limits.${l.id}`)}
                  </p>
                </li>
              ))}
            </ul>

            {/* Every feature: a tick or a cross */}
            <div className="mt-6 h-px bg-[color-mix(in_srgb,var(--brand-silver)_12%,transparent)]" />
            <div className="px-6 pt-5 pb-5 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <h3 className="text-sm font-semibold">
                  {t('pricing.allTitle', { n: n(included), total: n(PLAN_ROWS.length) })}
                </h3>
                <p className="flex items-center gap-3 text-xs text-[color:var(--text-muted)]">
                  <span className="flex items-center gap-1">
                    <Mark yes /> {t('pricing.legendYes')}
                  </span>
                  <span className="flex items-center gap-1">
                    <Mark yes={false} /> {t('pricing.legendNo')}
                  </span>
                </p>
              </div>
              <div
                className="relative mt-4 overflow-hidden transition-[height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                style={{ height: open ? (fullPx ?? 'auto') : CLOSED_PX }}
              >
                <ul
                  ref={listRef}
                  id={listId}
                  data-open={open}
                  className="plan-list grid gap-x-6 sm:grid-cols-2"
                >
                  {PLAN_ROWS.map((r, i) => (
                    <li
                      key={r.id}
                      data-late={i >= LATE_FROM || undefined}
                      style={{ '--i': i - LATE_FROM } as CSSProperties}
                      className="flex items-center gap-2.5 border-b border-[color-mix(in_srgb,var(--brand-silver)_8%,transparent)] py-2.5 text-sm"
                    >
                      <Mark yes={r.included} />
                      <span
                        className={cn(
                          'min-w-0 flex-1',
                          r.included
                            ? 'text-[color:var(--text-secondary)]'
                            : 'text-[color:var(--text-muted)]',
                        )}
                      >
                        {name(r.id)}
                        {!r.included && <span className="sr-only"> — {t('pricing.legendNo')}</span>}
                      </span>
                      {r.perWeek !== undefined && (
                        <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--brand-yellow)_40%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-yellow)]">
                          {r.soon ? t('pricing.soon') : t('pricing.perWeek', { n: n(r.perWeek) })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {/* The fold fades into the card while it is closed. */}
                <div
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-[color-mix(in_srgb,var(--brand-grey)_96%,transparent)] transition-opacity duration-500',
                    open && 'opacity-0',
                  )}
                />
              </div>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => setOpen((o) => !o)}
                className="mx-auto mt-5 flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--brand-silver)_22%,transparent)] px-4 py-2 text-xs font-semibold transition-[border-color,scale] hover:border-[var(--brand-yellow)] active:scale-[0.97]"
              >
                {open ? t('pricing.less') : t('pricing.more', { total: n(PLAN_ROWS.length) })}
                <ChevronDown
                  aria-hidden
                  className={cn('size-4 transition-transform duration-500', open && 'rotate-180')}
                />
              </button>
            </div>
          </div>
        </article>
        <p className="mt-6 text-center text-xs text-[color:var(--text-muted)]">
          {t('pricing.note')}
        </p>
      </div>
    </section>
  );
});

/** A tick in a yellow ring (in this plan) or a cross in a dim one (needs a bigger plan). */
function Mark({ yes }: { yes: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-full border',
        yes
          ? 'border-[color-mix(in_srgb,var(--brand-yellow)_50%,transparent)] bg-[color-mix(in_srgb,var(--brand-yellow)_14%,transparent)] text-[var(--brand-yellow)]'
          : 'border-[color-mix(in_srgb,var(--brand-silver)_18%,transparent)] text-[color:var(--text-muted)]',
      )}
    >
      {yes ? (
        <Check className="size-3" strokeWidth={3} />
      ) : (
        <X className="size-3" strokeWidth={3} />
      )}
    </span>
  );
}
