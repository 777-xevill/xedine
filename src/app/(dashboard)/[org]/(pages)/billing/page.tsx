import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardTitle, Hint, PageTitle, Stat } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import { getOrgContext } from '@/modules/tenancy/context';
import { SettingsNav } from '@/components/settings-nav';

const TONE = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  canceled: 'danger',
  trial_expired: 'danger',
} as const;

/**
 * Billing (ROADMAP Phase 10, ADR 0008 provisional prices): the plan, what it includes, what next month
 * costs and this month's usage. Payment is by invoice until a provider is chosen (ADR 0023 §6).
 */
export default async function BillingPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('accountant')) notFound();
  const [t, locale] = await Promise.all([getTranslations('billing'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const { data } = await supabase.rpc('metric_billing', {
    p_org: ctx.org.id,
    p_now: now().toISOString(),
  });
  const b = ((data ?? []) as Record<string, unknown>[])[0];
  if (!b) notFound();
  const status = b.status as keyof typeof TONE;
  const bdt = (v: unknown) => formatBDT(Number(v ?? 0), loc, { poisha: 'never' });

  return (
    <>
      <SettingsNav ctx={ctx} current="billing" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-secondary">{t('plan')}</p>
            <p className="text-2xl font-bold">{t(`plans.${b.plan_code as string}`)}</p>
          </div>
          <StatusBadge tone={TONE[status] ?? 'neutral'}>{t(`status.${status}`)}</StatusBadge>
        </div>
        {b.trial_ends ? (
          <p className="mt-2 text-sm text-secondary">
            {t(status === 'trial_expired' ? 'trialEnded' : 'trialEnds', {
              date: String(b.trial_ends),
            })}
          </p>
        ) : null}
      </Card>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('branches')} value={formatNumber(Number(b.branches), loc)} />
        <Stat label={t('pricePerBranch')} value={bdt(b.price_per_branch_poisha)} />
        <Stat
          label={t('discount')}
          value={
            Number(b.pilot_discount_bps) > 0 ? formatBps(Number(b.pilot_discount_bps), loc) : '—'
          }
        />
        <Stat label={t('monthly')} value={bdt(b.monthly_amount_poisha)} />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardTitle>{t('includesTitle')}</CardTitle>
          <ul className="space-y-2 text-sm">
            <li>
              <StatusBadge tone={b.ai_included ? 'success' : 'neutral'}>
                {t(b.ai_included ? 'aiYes' : 'aiNo')}
              </StatusBadge>
            </li>
            <li>
              <StatusBadge tone={b.whatsapp_included ? 'success' : 'neutral'}>
                {t(b.whatsapp_included ? 'waYes' : 'waNo')}
              </StatusBadge>
            </li>
          </ul>
          <Hint className="mt-3">{t(`planBody.${b.plan_code as string}`)}</Hint>
        </Card>
        <Card>
          <CardTitle>{t('usageTitle')}</CardTitle>
          <dl className="grid grid-cols-2 gap-2 text-sm tabular-nums">
            <dt className="text-secondary">{t('aiRequests')}</dt>
            <dd className="text-end">{formatNumber(Number(b.ai_requests_month), loc)}</dd>
            <dt className="text-secondary">{t('messages')}</dt>
            <dd className="text-end">{formatNumber(Number(b.messages_month), loc)}</dd>
          </dl>
          <Hint className="mt-3">{t('paymentNote')}</Hint>
        </Card>
      </div>
    </>
  );
}
