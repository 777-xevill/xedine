'use client';

import { ArrowRight, Check, Crown, Zap } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
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
  PARTNER,
  PAY_WITH,
  PLAN_CHOICE_COOKIE,
  PLANS,
  TRIAL_DAYS,
  YEARLY_OFF_PERCENT,
  yearlyMonthly,
  type PlanChoice,
} from '@/components/landing-3d/pricing';

const signUpHref = (choice: PlanChoice, next?: string) => {
  const q = new URLSearchParams({ plan: choice.plan, billing: choice.billing });
  if (next) q.set('next', next);
  return `/sign-up?${q.toString()}`;
};

function useMoney() {
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return {
    n: (v: number) => formatNumber(v, locale),
    month: (minor: number, yearly: boolean) =>
      formatMoney(yearly ? yearlyMonthly(minor) : minor, locale, 'USD'),
  };
}

/**
 * Create account starts with the plans (the founder, 2026-11-19): Starter, Pro and Partner with the monthly /
 * yearly switch, the free days and how to pay after them. Picking Starter or Pro goes on to the account form
 * with the plan in the address; Partner is "Talk to us", as on the home page.
 */
export function PlanPicker({ next }: { next?: string }) {
  const t = useTranslations('landing3d.day.pricing');
  const ta = useTranslations('auth.plan');
  const { n, month } = useMoney();
  const [yearly, setYearly] = useState(false);
  const billing = yearly ? 'yearly' : 'monthly';
  const days = n(TRIAL_DAYS);

  const options = [
    ...PLANS.map((p) => ({
      code: p.code,
      featured: !!p.featured,
      minor: p.minor,
      href: signUpHref({ plan: p.code, billing }, next),
      cta: ta('choose', { name: t(`plans.${p.code}.name`) }),
    })),
    {
      code: 'partner' as const,
      featured: false,
      minor: PARTNER.minor,
      href: `mailto:${LEGAL_CONTACT}?subject=${encodeURIComponent(t('partner.mailSubject'))}`,
      cta: t('partner.cta'),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={yearly}
          onClick={() => setYearly((y) => !y)}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <span
            aria-hidden
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300',
              yearly
                ? 'border-[var(--brand-yellow)] bg-[var(--brand-yellow)]'
                : 'border-[color-mix(in_srgb,var(--brand-silver)_25%,transparent)] bg-[color-mix(in_srgb,var(--brand-silver)_10%,transparent)]',
            )}
          >
            <span
              className={cn(
                'absolute top-1/2 left-0.5 size-[18px] -translate-y-1/2 rounded-full transition-transform duration-300 motion-reduce:transition-none',
                yearly ? 'translate-x-5 bg-[var(--brand-grey)]' : 'bg-[var(--brand-silver)]',
              )}
            />
          </span>
          {t('yearly')}
        </button>
        <span className="rounded-full border border-[color-mix(in_srgb,var(--brand-yellow)_50%,transparent)] px-2 py-0.5 text-[11px] font-bold text-[var(--brand-yellow)]">
          {t('save', { pct: n(YEARLY_OFF_PERCENT) })}
        </span>
      </div>

      <ul className="space-y-3">
        {options.map((o) => {
          const name = t(`plans.${o.code}.name`);
          const isPartner = o.code === 'partner';
          const body = (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{name}</span>
                {o.featured && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--brand-yellow)] px-2 py-0.5 text-[10px] font-bold text-[var(--brand-grey)]">
                    <Zap aria-hidden className="size-3" fill="currentColor" />
                    {t('badge')}
                  </span>
                )}
                {isPartner && (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-[color-mix(in_srgb,var(--brand-yellow)_60%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--brand-yellow)]">
                    <Crown aria-hidden className="size-3" />
                    {t('partner.badge')}
                  </span>
                )}
                <span className="ml-auto text-right">
                  <span
                    key={`${o.code}-${billing}`}
                    className="animate-rise-in inline-block text-lg font-bold"
                  >
                    {month(o.minor, yearly)}
                  </span>
                  <span className="text-xs text-[color:var(--text-muted)]">
                    {t('perMonthShort')}
                  </span>
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[color:var(--text-muted)]">
                {t(`plans.${o.code}.body`)}
              </p>
              <span
                className={cn(
                  'mt-3 flex items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold',
                  o.featured
                    ? 'bg-[var(--brand-yellow)] text-[var(--brand-grey)]'
                    : 'border border-[color-mix(in_srgb,var(--brand-silver)_20%,transparent)]',
                  isPartner && 'border-[var(--brand-yellow)] text-[var(--brand-yellow)]',
                )}
              >
                {o.cta}
                <ArrowRight aria-hidden className="size-3.5" />
              </span>
            </>
          );
          const className = cn(
            'block rounded-2xl border p-4 transition-[border-color,translate] duration-300 hover:-translate-y-0.5 active:scale-[0.99]',
            o.featured
              ? 'border-[var(--brand-yellow)] bg-[color-mix(in_srgb,var(--brand-yellow)_6%,transparent)]'
              : isPartner
                ? 'border-[color-mix(in_srgb,var(--brand-yellow)_45%,transparent)]'
                : 'border-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)] hover:border-[color-mix(in_srgb,var(--brand-yellow)_55%,transparent)]',
          );
          return (
            <li key={o.code}>
              {isPartner ? (
                <a href={o.href} className={className}>
                  {body}
                </a>
              ) : (
                <Link href={o.href} className={className}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <PayLine days={days} />
    </div>
  );
}

/** "14 days free, then pay with bKash · Nagad" and "No card needed to start." */
function PayLine({ days }: { days: string }) {
  const t = useTranslations('landing3d.day.pricing');
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-xs text-[color:var(--text-muted)]">
      {t('payThen', { days })}
      {PAY_WITH.map((w) => (
        <span
          key={w}
          className="rounded-md border border-[color-mix(in_srgb,var(--brand-yellow)_45%,transparent)] px-1.5 py-px font-bold text-[var(--brand-yellow)]"
        >
          {t(`wallets.${w}`)}
        </span>
      ))}
      <span className="w-full">{t('noCard')}</span>
    </p>
  );
}

/**
 * Above the account form once a plan is picked: the plan, its price and billing, and "Change". Keeps the choice
 * in a cookie so it survives Google, Facebook, X or phone sign-in; it is saved on the account when the
 * restaurant is made.
 */
export function PlanChosen({ choice, next }: { choice: PlanChoice; next?: string }) {
  const t = useTranslations('landing3d.day.pricing');
  const ta = useTranslations('auth.plan');
  const { n, month } = useMoney();
  const yearly = choice.billing === 'yearly';
  const minor =
    choice.plan === 'partner'
      ? PARTNER.minor
      : (PLANS.find((p) => p.code === choice.plan)?.minor ?? 0);

  useEffect(() => {
    document.cookie = `${PLAN_CHOICE_COOKIE}=${choice.plan}:${choice.billing}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
  }, [choice.plan, choice.billing]);

  const changeHref = next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up';
  return (
    <div className="mb-5 space-y-2">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--brand-yellow)] bg-[color-mix(in_srgb,var(--brand-yellow)_6%,transparent)] px-4 py-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--brand-yellow)] text-[var(--brand-grey)]">
          <Check aria-hidden className="size-3.5" strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[color:var(--text-muted)]">{ta('chosen')}</p>
          <p className="text-sm font-semibold">
            {t(`plans.${choice.plan}.name`)} · {month(minor, yearly)}
            {t('perMonthShort')}{' '}
            <span className="font-normal text-[color:var(--text-muted)]">
              · {yearly ? t('yearly') : t('billedMonth')}
            </span>
          </p>
        </div>
        <Link
          href={changeHref}
          className="shrink-0 text-xs font-semibold text-[var(--brand-yellow)] hover:underline"
        >
          {ta('change')}
        </Link>
      </div>
      <PayLine days={n(TRIAL_DAYS)} />
    </div>
  );
}
