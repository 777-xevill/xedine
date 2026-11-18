'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { memo } from 'react';
import { DEFAULT_LOCALE, formatMoney, isLocale, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { PRICE_CURRENCY, PRICING_PLANS, TRIAL_DAYS } from './pricing';

/**
 * The home page's pricing, between the 3D day and the A–Z list (the founder's reference, 2026-11-18): a huge
 * word behind three glass cards that blur it, each with its price, what it includes and a button. In the
 * founder's grey, silver and yellow; the recommended plan's button is yellow.
 */
export const PricingSection = memo(function PricingSection() {
  const t = useTranslations('landing3d.day.pricing');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
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
        <div className="grid gap-4 md:grid-cols-3 md:gap-5">
          {PRICING_PLANS.map((plan) => (
            <article
              key={plan.code}
              className={cn(
                'flex flex-col rounded-3xl border bg-[color-mix(in_srgb,var(--brand-grey)_62%,transparent)] shadow-[var(--rim)] backdrop-blur-2xl',
                plan.featured
                  ? 'border-[color-mix(in_srgb,var(--brand-silver)_30%,transparent)]'
                  : 'border-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)]',
              )}
            >
              <div className="p-6 pb-5 sm:p-7 sm:pb-6">
                <h3 className="text-sm text-[color:var(--text-muted)]">
                  {t(`plans.${plan.code}.name`)}
                </h3>
                <p className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-[-0.03em] sm:text-[2.6rem]">
                    {formatMoney(plan.minor, locale, PRICE_CURRENCY)}
                  </span>
                  <span className="text-2xl font-semibold text-[color:var(--text-muted)]">
                    {t('perMonth')}
                  </span>
                </p>
                <p className="mt-1 text-xs text-[color:var(--text-muted)]">{t('perBranch')}</p>
              </div>
              <div className="h-px bg-[color-mix(in_srgb,var(--brand-silver)_12%,transparent)]" />
              <ul className="flex flex-1 flex-col gap-4 p-6 sm:p-7">
                {Array.from({ length: plan.points }, (_, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--brand-silver)_22%,transparent)] bg-[color-mix(in_srgb,var(--brand-silver)_8%,transparent)]">
                      <Check aria-hidden className="size-3.5" />
                    </span>
                    <span className="text-[color:var(--text-secondary)]">
                      {t(`plans.${plan.code}.p${i + 1}`)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="p-6 pt-2 sm:p-7 sm:pt-2">
                <Link
                  href="/sign-up"
                  className={cn(
                    'block rounded-full py-3 text-center text-sm font-semibold transition-transform active:scale-[0.98]',
                    plan.featured
                      ? 'bg-[var(--brand-yellow)] text-[var(--brand-grey)]'
                      : 'border border-[color-mix(in_srgb,var(--brand-silver)_16%,transparent)] bg-[var(--brand-grey)] hover:border-[var(--brand-yellow)]',
                  )}
                >
                  {t('cta', { days: TRIAL_DAYS })}
                </Link>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-[color:var(--text-muted)]">
          {t('body', { days: TRIAL_DAYS })}
        </p>
        <p className="mt-1 text-center text-xs text-[color:var(--text-muted)]">{t('note')}</p>
      </div>
    </section>
  );
});
