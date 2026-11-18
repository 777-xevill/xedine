'use client';

import {
  BrainCircuit,
  Check,
  ChevronDown,
  Clapperboard,
  Crown,
  Globe,
  Megaphone,
  Palette,
  Sparkles,
  Store,
  TrendingUp,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
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
import { LEGAL_CONTACT } from '@/lib/contact';
import {
  DAYS_PER_MONTH,
  limitOf,
  PARTNER,
  PLAN_ROWS,
  PLANS,
  TRIAL_DAYS,
  type Limit,
  type PartnerServiceId,
  type Plan,
} from './pricing';

/** How tall a plan's feature list is before "See more" (about six rows). */
const CLOSED_PX = 262;
/** Rows from here on are under the fold: they come in one by one when it opens. */
const LATE_FROM = 6;

/**
 * The home page's pricing, between the 3D day and the A–Z list (the founder, 2026-11-18): two plans on glass
 * over a huge word, Starter ($19) and Pro ($27, the one Xedine sells: first on a phone, the yellow button and a
 * light running round its edge). Each shows its limits as four tiles, then Xedine's big features with a tick or
 * a cross, folded under "See more" (both plans open together, so their rows line up). Below them, the whole
 * width, Partner ($250): the most powerful plan, the founder's team working with the restaurant every month.
 */
export const PricingSection = memo(function PricingSection() {
  const t = useTranslations('landing3d.day.pricing');
  const [open, setOpen] = useState(false);
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
      <div className="relative mx-auto -mt-[9vw] max-w-5xl sm:-mt-20 lg:-mt-24">
        <h2 id="pricing-title" className="sr-only">
          {t('title')}
        </h2>
        <div className="grid items-start gap-5 md:grid-cols-2">
          {PLANS.map((plan) => (
            <PlanCard key={plan.code} plan={plan} open={open} onToggle={() => setOpen((o) => !o)} />
          ))}
        </div>
        <PartnerCard />
        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[color:var(--text-muted)]">
          <span className="flex items-center gap-1">
            <Mark yes /> {t('legendYes')}
          </span>
          <span className="flex items-center gap-1">
            <Mark yes={false} /> {t('legendNo')}
          </span>
          <span>{t('note')}</span>
        </p>
      </div>
    </section>
  );
});

function PlanCard({ plan, open, onToggle }: { plan: Plan; open: boolean; onToggle: () => void }) {
  const t = useTranslations('landing3d.day.pricing');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
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

  const n = (v: number) => formatNumber(v, locale);
  const days = n(TRIAL_DAYS);
  const badge = (limit: Limit) =>
    limit === 'unlimited'
      ? t('unlimited')
      : t(limit.per === 'day' ? 'perDay' : 'perWeek', { n: n(limit.n) });

  return (
    <article
      className={cn(
        'relative rounded-[1.75rem] shadow-[var(--rim)]',
        plan.featured
          ? 'plan-rim order-first md:order-none'
          : 'border border-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)]',
      )}
    >
      <div className="rounded-[inherit] bg-[color-mix(in_srgb,var(--brand-grey)_70%,transparent)] backdrop-blur-2xl">
        {/* Name, price and the button */}
        <div data-reveal className="p-6 pb-5 sm:p-7 sm:pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
                plan.featured
                  ? 'border-[color-mix(in_srgb,var(--brand-yellow)_45%,transparent)] bg-[color-mix(in_srgb,var(--brand-yellow)_10%,transparent)] text-[var(--brand-yellow)]'
                  : 'border-[color-mix(in_srgb,var(--brand-silver)_22%,transparent)] text-[color:var(--text-secondary)]',
              )}
            >
              {plan.featured && <Sparkles aria-hidden className="size-3.5" />}
              {t(`plans.${plan.code}.name`)}
            </p>
            {plan.featured && (
              <p className="rounded-full bg-[var(--brand-yellow)] px-2.5 py-1 text-[11px] font-bold text-[var(--brand-grey)]">
                {t('badge')}
              </p>
            )}
          </div>
          <p className="mt-4 flex items-baseline gap-1">
            <span className="text-5xl font-bold tracking-[-0.04em]">
              {formatMoney(plan.minor, locale, plan.currency)}
            </span>
            <span className="text-xl font-semibold text-[color:var(--text-muted)]">
              {t('perMonth')}
            </span>
          </p>
          <p className="mt-2 min-h-10 text-sm text-[color:var(--text-secondary)]">
            {t(`plans.${plan.code}.body`)}
          </p>
          <Link
            href="/sign-up"
            className={cn(
              'relative mt-5 block overflow-hidden rounded-full py-3.5 text-center text-sm font-semibold transition-transform active:scale-[0.98]',
              plan.featured
                ? 'btn-shine plan-cta bg-[var(--brand-yellow)] text-[var(--brand-grey)]'
                : 'border border-[color-mix(in_srgb,var(--brand-silver)_16%,transparent)] bg-[var(--brand-grey)] hover:border-[var(--brand-yellow)]',
            )}
          >
            {t('cta', { days })}
          </Link>
          <p className="mt-2 text-center text-xs text-[color:var(--text-muted)]">{t('noCard')}</p>
        </div>

        {/* The limits */}
        <ul data-reveal className="grid grid-cols-2 gap-2 px-6 sm:px-7">
          {plan.limits.map(({ id, limit }) => {
            const soon = PLAN_ROWS.find((r) => r.id === id)?.soon;
            return (
              <li
                key={id}
                className="plan-tile relative min-h-24 rounded-2xl border border-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)] bg-[color-mix(in_srgb,var(--brand-silver)_5%,transparent)] p-3"
              >
                {soon && (
                  <span className="absolute top-2.5 right-2.5 flex items-center gap-1 text-[10px] font-semibold text-[var(--brand-yellow)]">
                    <span className="animate-pulse-dot size-1.5 rounded-full bg-[var(--brand-yellow)]" />
                    {t('soon')}
                  </span>
                )}
                <p
                  className={cn(
                    'font-bold text-[var(--brand-yellow)]',
                    limit === 'unlimited' ? 'pt-1 text-lg leading-7' : 'text-2xl',
                  )}
                >
                  {limit === 'unlimited' ? t('unlimited') : n(limit.n)}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-[color:var(--text-secondary)]">
                  {t('tileLabel', {
                    what: t(`limits.${id}`),
                    per: limit === 'unlimited' ? 'none' : limit.per,
                  })}
                </p>
                {limit !== 'unlimited' && limit.per === 'day' && (
                  <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">
                    {t('aboutMonth', { n: n(limit.n * DAYS_PER_MONTH) })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {/* Xedine's big features: a tick or a cross */}
        <div className="mt-5 h-px bg-[color-mix(in_srgb,var(--brand-silver)_12%,transparent)]" />
        <div className="px-6 pt-4 pb-5 sm:px-7">
          <h3 className="text-sm font-semibold">{t('allTitle')}</h3>
          <div
            className="relative mt-2 overflow-hidden transition-[height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ height: open ? (fullPx ?? 'auto') : CLOSED_PX }}
          >
            <ul ref={listRef} id={listId} data-open={open} className="plan-list">
              {PLAN_ROWS.map((r, i) => {
                const has = !plan.without.has(r.id);
                const limit = limitOf(plan, r.id);
                return (
                  <li
                    key={r.id}
                    data-late={i >= LATE_FROM || undefined}
                    style={{ '--i': i - LATE_FROM } as CSSProperties}
                    className="flex items-center gap-2.5 border-b border-[color-mix(in_srgb,var(--brand-silver)_8%,transparent)] py-2.5 text-sm"
                  >
                    <Mark yes={has} />
                    <span
                      className={cn(
                        'min-w-0 flex-1',
                        has
                          ? 'text-[color:var(--text-secondary)]'
                          : 'text-[color:var(--text-muted)]',
                      )}
                    >
                      {t(`rows.${r.id}`)}
                      {!has && <span className="sr-only"> — {t('legendNo')}</span>}
                    </span>
                    {has && (r.soon || limit) && (
                      <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--brand-yellow)_40%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-yellow)]">
                        {r.soon ? t('soon') : limit && badge(limit)}
                      </span>
                    )}
                  </li>
                );
              })}
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
            onClick={onToggle}
            className="mx-auto mt-4 flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--brand-silver)_22%,transparent)] px-4 py-2 text-xs font-semibold transition-[border-color,scale] hover:border-[var(--brand-yellow)] active:scale-[0.97]"
          >
            {open ? t('less') : t('more')}
            <ChevronDown
              aria-hidden
              className={cn('size-4 transition-transform duration-500', open && 'rotate-180')}
            />
          </button>
        </div>
      </div>
    </article>
  );
}

const SERVICE_ICON: Record<PartnerServiceId, LucideIcon> = {
  films: Clapperboard,
  ads: Megaphone,
  visit: Store,
  website: Globe,
  brand: Palette,
  build: Wrench,
  review: TrendingUp,
  deepAi: BrainCircuit,
};

/** The most powerful plan, the whole width under the other two: everything in Pro plus the team's work. */
function PartnerCard() {
  const t = useTranslations('landing3d.day.pricing');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const n = (v: number) => formatNumber(v, locale);
  const mail = `mailto:${LEGAL_CONTACT}?subject=${encodeURIComponent(t('partner.mailSubject'))}`;
  return (
    <article className="plan-gold relative mt-5 rounded-[1.75rem] shadow-[0_0_80px_-30px_color-mix(in_srgb,var(--brand-yellow)_55%,transparent)]">
      <div className="grid gap-6 rounded-[inherit] bg-[color-mix(in_srgb,var(--brand-grey)_72%,transparent)] p-6 backdrop-blur-2xl sm:p-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-10">
        {/* Name, price and the button */}
        <div data-reveal className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--brand-yellow)_45%,transparent)] bg-[color-mix(in_srgb,var(--brand-yellow)_10%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-yellow)]">
              <Crown aria-hidden className="size-3.5" />
              {t('plans.partner.name')}
            </p>
            <p className="rounded-full border border-[color-mix(in_srgb,var(--brand-yellow)_60%,transparent)] px-2.5 py-1 text-[11px] font-bold text-[var(--brand-yellow)]">
              {t('partner.badge')}
            </p>
          </div>
          <p className="mt-4 flex items-baseline gap-1">
            <span className="text-5xl font-bold tracking-[-0.04em]">
              {formatMoney(PARTNER.minor, locale, PARTNER.currency)}
            </span>
            <span className="text-xl font-semibold text-[color:var(--text-muted)]">
              {t('perMonth')}
            </span>
          </p>
          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
            {t('plans.partner.body')}
          </p>
          <a
            href={mail}
            className="btn-shine relative mt-5 block overflow-hidden rounded-full border border-[var(--brand-yellow)] py-3.5 text-center text-sm font-semibold text-[var(--brand-yellow)] transition-[transform,background-color] hover:bg-[color-mix(in_srgb,var(--brand-yellow)_12%,transparent)] active:scale-[0.98]"
          >
            {t('partner.cta')}
          </a>
          <p className="mt-2 text-center text-xs text-[color:var(--text-muted)]">
            {t('partner.places')}
          </p>
        </div>

        {/* Everything in Pro, plus the team's work */}
        <div data-reveal>
          <h3 className="text-sm font-semibold">{t('partner.plus')}</h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {PARTNER.services.map((id) => {
              const Icon = SERVICE_ICON[id];
              return (
                <li
                  key={id}
                  className="plan-tile flex gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--brand-silver)_12%,transparent)] bg-[color-mix(in_srgb,var(--brand-silver)_4%,transparent)] p-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--brand-yellow)_14%,transparent)] text-[var(--brand-yellow)]">
                    <Icon aria-hidden className="size-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                      {t(`partner.services.${id}.name`, {
                        films: n(PARTNER.filmsPerMonth),
                        reels: n(PARTNER.reelsPerMonth),
                        n: n(PARTNER.deepAiPerWeek),
                      })}
                      {id === 'deepAi' && (
                        <span className="text-[10px] font-semibold text-[var(--brand-yellow)]">
                          {t('soon')}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-[color:var(--text-muted)]">
                      {t(`partner.services.${id}.line`)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-[color:var(--text-muted)]">
            {t('partner.excluded')}
          </p>
        </div>
      </div>
    </article>
  );
}

/** A tick in a yellow ring (in the plan) or a cross in a dim one (a bigger plan). */
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
