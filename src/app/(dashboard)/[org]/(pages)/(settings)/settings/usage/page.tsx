import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh';
import { Card, CardTitle, Hint, PageTitle, Stat } from '@/components/ui/form';
import { APP_COOKIE, isAppCookie } from '@/lib/android-app';
import { createClient } from '@/lib/db/supabase-server';
import { formatBps, formatDay, formatNumber, formatTime, type Locale } from '@/lib/i18n/format';
import { aiDailyCapUsdMicros, x7Configured } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import { cn } from '@/lib/utils';
import { getOrgContext } from '@/modules/tenancy/context';

interface Day {
  usage_date: string;
  requests: number;
  used_pct: number;
  is_today: boolean;
  resets_at: string;
  ai_allowed: boolean;
}

/**
 * Usage (owner/accountant): the plan's limits as meters, like a desktop app's usage page. The one limit
 * Xedine enforces is the daily AI allowance (the LLM gateway refuses calls once it is spent); the meter
 * and the last seven days come from metric_ai_usage, this month's counts from metric_billing.
 */
export default async function UsagePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('accountant')) notFound();
  const [t, tb, locale, jar] = await Promise.all([
    getTranslations('usage'),
    getTranslations('billing'),
    getLocale(),
    cookies(),
  ]);
  const loc = locale as Locale;
  const inApp = isAppCookie(jar.get(APP_COOKIE)?.value);
  const supabase = await createClient();
  const at = now().toISOString();
  const [{ data: usage }, { data: billing }, { data: x7 }] = await Promise.all([
    supabase.rpc('metric_ai_usage', {
      p_org: ctx.org.id,
      p_now: at,
      p_cap_usd_micros: aiDailyCapUsdMicros(),
      p_days: 7,
    }),
    supabase.rpc('metric_billing', { p_org: ctx.org.id, p_now: at }),
    // X7 this week (ADR 0067): its own allowance, counted per question.
    x7Configured()
      ? supabase.rpc('x7_allowance', { p_org: ctx.org.id, p_now: at })
      : Promise.resolve({ data: null }),
  ]);
  const week = (
    x7 as { per_week: number; used: number; left_count: number; resets_on: string }[] | null
  )?.[0];
  const days = ((usage ?? []) as Day[]).map((d) => ({
    ...d,
    requests: Number(d.requests),
    used_pct: Number(d.used_pct),
  }));
  const today = days.find((d) => d.is_today);
  const b = ((billing ?? []) as Record<string, unknown>[])[0];
  if (!today || !b) notFound();
  const n = (v: number) => formatNumber(v, loc);
  const resets = formatTime(new Date(today.resets_at), loc, ctx.place.tz);
  const dayLabel = (d: string) => formatDay(new Date(`${d}T12:00:00Z`), loc, 'UTC');
  const full = today.used_pct >= 100;

  return (
    <>
      <AutoRefresh />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />

      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="mb-0">{t('limitsTitle')}</CardTitle>
          <span className="rounded-full border border-edge px-2.5 py-0.5 text-xs font-semibold text-secondary">
            {t('planBadge', { plan: tb(`plans.${b.plan_code as string}`) })}
          </span>
        </div>
        {today.ai_allowed ? (
          <div className="grid items-center gap-x-6 gap-y-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
            <div>
              <p className="text-sm font-semibold">{t('aiToday')}</p>
              <p className="text-xs text-secondary">{t('resetsAt', { time: resets })}</p>
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={today.used_pct}
              aria-label={t('aiToday')}
            >
              <div
                className={cn(
                  'h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700',
                  full ? 'bg-warning-bright' : 'bg-brand-yellow',
                )}
                style={{ width: `${today.used_pct}%` }}
              />
            </div>
            <p className="text-sm text-secondary tabular-nums sm:text-end">
              {t('usedPct', { pct: n(today.used_pct) })}
            </p>
          </div>
        ) : (
          <p className="text-sm text-secondary">
            {t('noAi')}{' '}
            <Link
              href={`/${ctx.org.slug}/billing`}
              className="font-semibold text-foreground underline"
            >
              {t('seePlan')}
            </Link>
          </p>
        )}
        {today.ai_allowed && week && week.per_week > 0 ? (
          <div className="mt-5 grid items-center gap-x-6 gap-y-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
            <div>
              <p className="text-sm font-semibold">{t('x7Title')}</p>
              <p className="text-xs text-secondary">
                {t('x7Body', {
                  used: n(week.used),
                  perWeek: n(week.per_week),
                  day: dayLabel(week.resets_on),
                })}
              </p>
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={week.per_week}
              aria-valuenow={Math.min(week.used, week.per_week)}
              aria-label={t('x7Title')}
            >
              <div
                className={cn(
                  'h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700',
                  week.left_count === 0 ? 'bg-warning-bright' : 'bg-brand-yellow',
                )}
                style={{
                  width: `${Math.min(100, Math.round((week.used * 100) / week.per_week))}%`,
                }}
              />
            </div>
            <p className="text-sm text-secondary tabular-nums sm:text-end">
              {n(week.used)}/{n(week.per_week)}
            </p>
          </div>
        ) : null}
        <Hint className="mt-4">
          {full ? t('fullBody', { time: resets }) : t('aiBody', { count: n(today.requests) })}
        </Hint>
      </Card>

      <Card className="mb-6">
        <CardTitle>{t('weekTitle')}</CardTitle>
        <ol className="flex h-40 items-end gap-2 sm:gap-3">
          {days.map((d) => (
            <li
              key={d.usage_date}
              className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              <span className="text-[0.6875rem] text-muted tabular-nums">
                {formatBps(d.used_pct * 100, loc)}
              </span>
              <div className="relative w-full flex-1 overflow-hidden rounded-md bg-line">
                <div
                  className={cn(
                    'absolute inset-x-0 bottom-0 rounded-md',
                    d.is_today ? 'bg-brand-yellow' : 'bg-secondary/70',
                  )}
                  style={{ height: `${d.used_pct}%` }}
                />
              </div>
              <span
                className={cn(
                  'truncate text-[0.6875rem]',
                  d.is_today ? 'font-semibold text-foreground' : 'text-muted',
                )}
              >
                {d.is_today ? t('today') : dayLabel(d.usage_date)}
              </span>
              <span className="sr-only">{t('requests', { count: n(d.requests) })}</span>
            </li>
          ))}
        </ol>
        <Hint className="mt-3">{t('weekBody')}</Hint>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label={t('monthAi')} value={n(Number(b.ai_requests_month))} />
        <Stat label={t('monthMessages')} value={n(Number(b.messages_month))} />
      </div>
      <Hint className="mt-4">
        {t('moreLimits')}{' '}
        {inApp ? null : (
          <Link href={`/${ctx.org.slug}/billing`} className="font-semibold underline">
            {t('seePlan')}
          </Link>
        )}
      </Hint>
    </>
  );
}
