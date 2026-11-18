'use client';

import {
  ArrowUpRight,
  Check,
  ChevronDown,
  HeartHandshake,
  ShieldCheck,
  Sun,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { memo, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { DEFAULT_LOCALE, formatNumber, isLocale, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { FEATURE_GROUPS, FEATURES, type FeatureGroup, type FeatureId } from './features';
import { BEATS } from './story';

/** How tall a group's list is before "See more" (about six features). */
const CLOSED_PX = 372;
/** Rows from here on are under the fold: they come in one by one when it opens. */
const LATE_FROM = 6;

const ICONS: Record<FeatureGroup, LucideIcon> = {
  daily: Sun,
  money: Wallet,
  customers: HeartHandshake,
  team: ShieldCheck,
};

function firstBeat(id: FeatureId) {
  return BEATS.find((b) => b.features.includes(id))?.id ?? BEATS[0]!.id;
}

/**
 * Everything Xedine does, A to Z, dressed like the pricing above it (ADR 0064, the founder 2026-11-18): a huge
 * "A–Z" behind four glass cards, one per group. Each card: an icon, the group, how many features, a line, then
 * the features as ticked rows that fold under "See more"; a row links back to where the story showed it.
 */
export const AzSection = memo(function AzSection() {
  const t = useTranslations('landing3d.day');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return (
    <section
      id="everything"
      aria-labelledby="az-title"
      className="relative overflow-hidden bg-background px-4 pt-10 pb-16 sm:px-8 sm:pt-14 sm:pb-24"
    >
      <div className="mx-auto max-w-6xl text-center">
        <h2
          id="az-title"
          className="text-2xl font-bold tracking-[-0.02em] text-balance sm:text-3xl"
        >
          {t('az.title')}
        </h2>
        <p className="mt-2 text-sm text-[color:var(--text-muted)]">{t('az.body')}</p>
      </div>
      {/* The big word: the cards cover its lower half and blur it, like the pricing's. */}
      <p
        aria-hidden
        className="pointer-events-none mx-auto mt-4 text-center text-[30vw] leading-[0.8] font-bold tracking-[-0.05em] text-[var(--brand-silver)] select-none sm:text-[11rem] lg:text-[13rem]"
      >
        {t('az.word')}
      </p>
      <div className="relative mx-auto -mt-[11vw] grid max-w-6xl gap-4 sm:-mt-20 md:grid-cols-2 lg:-mt-24 lg:gap-5">
        {FEATURE_GROUPS.map((g, i) => (
          <GroupCard key={g} group={g} featured={i === 0} locale={locale} />
        ))}
      </div>
    </section>
  );
});

function GroupCard({
  group,
  featured,
  locale,
}: {
  group: FeatureGroup;
  featured: boolean;
  locale: Locale;
}) {
  const t = useTranslations('landing3d.day');
  const tp = useTranslations('landing3d.day.pricing');
  const Icon = ICONS[group];
  const items = FEATURES.filter((f) => f.group === group);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
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
        'plan-tile relative flex flex-col rounded-[1.5rem] shadow-[var(--rim)]',
        featured
          ? 'plan-rim'
          : 'border border-[color-mix(in_srgb,var(--brand-silver)_12%,transparent)]',
      )}
    >
      <div className="flex flex-1 flex-col rounded-[inherit] bg-[color-mix(in_srgb,var(--brand-grey)_58%,transparent)] backdrop-blur-2xl">
        {/* The group */}
        <div data-reveal className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-2xl border border-[color-mix(in_srgb,var(--brand-yellow)_35%,transparent)] bg-[color-mix(in_srgb,var(--brand-yellow)_10%,transparent)] text-[var(--brand-yellow)] shadow-[0_0_28px_-10px_color-mix(in_srgb,var(--brand-yellow)_70%,transparent)]"
            >
              <Icon className="size-5" />
            </span>
            <h3 className="min-w-0 flex-1 text-lg font-bold tracking-[-0.02em]">
              {t(`groups.${group}`)}
            </h3>
            <span
              className={cn(
                'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold',
                featured
                  ? 'bg-[var(--brand-yellow)] text-[var(--brand-grey)]'
                  : 'border border-[color-mix(in_srgb,var(--brand-yellow)_50%,transparent)] text-[var(--brand-yellow)]',
              )}
            >
              {t('az.count', { n: formatNumber(items.length, locale) })}
            </span>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-[color:var(--text-muted)]">
            {t(`az.lines.${group}`)}
          </p>
        </div>
        <div className="h-px bg-[color-mix(in_srgb,var(--brand-silver)_10%,transparent)]" />

        {/* The features */}
        <div className="flex flex-1 flex-col px-3 pt-3 pb-5 sm:px-4">
          <div
            className="relative overflow-hidden transition-[height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ height: open || !folds ? (fullPx ?? 'auto') : CLOSED_PX }}
          >
            <ul ref={listRef} id={listId} data-open={open} className="plan-list">
              {items.map((f, i) => (
                <li
                  key={f.id}
                  data-late={i >= LATE_FROM || undefined}
                  style={{ '--i': i - LATE_FROM } as CSSProperties}
                >
                  <a
                    href={`#beat-${firstBeat(f.id)}`}
                    tabIndex={!open && folds && i >= LATE_FROM ? -1 : undefined}
                    className="group/row flex items-start gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-300 hover:bg-[color-mix(in_srgb,var(--brand-silver)_7%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--brand-silver)_7%,transparent)]"
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)] text-[var(--brand-yellow)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/row:scale-110"
                    >
                      <Check className="size-[11px]" strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[color:var(--text-secondary)]">
                        {t(`features.${f.id}.name`)}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-snug text-[color:var(--text-muted)]">
                        {t(`features.${f.id}.line`)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex shrink-0 items-center gap-0.5 rounded-full border border-[color-mix(in_srgb,var(--brand-silver)_18%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--text-muted)] transition-colors duration-300 group-hover/row:border-[color-mix(in_srgb,var(--brand-yellow)_55%,transparent)] group-hover/row:text-[var(--brand-yellow)]">
                      {t('az.seeIt')}
                      <ArrowUpRight
                        aria-hidden
                        className="size-3 transition-transform duration-300 group-hover/row:translate-x-0.5 group-hover/row:-translate-y-0.5"
                      />
                    </span>
                  </a>
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
              onClick={() => setOpen((o) => !o)}
              className="mx-auto mt-3 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-[color:var(--text-secondary)] transition-colors hover:text-[var(--brand-yellow)]"
            >
              {open ? tp('less') : tp('more')}
              <ChevronDown
                aria-hidden
                className={cn('size-4 transition-transform duration-500', open && 'rotate-180')}
              />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
