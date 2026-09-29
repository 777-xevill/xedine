import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card, EmptyState, Hint, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import { setBenchmarkOptInAction } from '@/modules/benchmarking/actions';
import { getOrgContext } from '@/modules/tenancy/context';

interface Bench {
  metric_id: string;
  own_value: number | null;
  period: string | null;
  segment: Record<string, string> | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  k: number | null;
  is_reference: boolean;
  better: 'lower' | 'higher' | 'neutral';
  place: 'below_p25' | 'p25_p50' | 'p50_p75' | 'above_p75' | null;
}

const BPS = new Set([
  'food_cost.theoretical_pct',
  'labour.pct',
  'visits.first_return_rate',
  'channel.delivery_share',
]);
const POISHA = new Set(['sales.net_per_branch_day', 'orders.aov']);

/**
 * Benchmarks (ROADMAP Phase 9, PRODUCT.md M14): the restaurant's last full month against peers — only
 * cells of five or more restaurants, computed in SQL — or, until enough peers exist, a clearly labelled
 * reference range. Owner and accountant (food cost and labour % are money, ADR 0007).
 */
export default async function BenchmarksPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('accountant')) notFound();
  const [t, locale] = await Promise.all([getTranslations('benchmarks'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const [{ data }, { data: settings }] = await Promise.all([
    supabase.rpc('metric_benchmarks', { p_org: ctx.org.id, p_now: now().toISOString() }),
    supabase.from('org_settings').select('benchmark_opt_in').eq('org_id', ctx.org.id).maybeSingle(),
  ]);
  const rows = (data ?? []) as Bench[];
  const optedIn = Boolean(settings?.benchmark_opt_in);
  const show = (id: string, v: number | null) => {
    if (v == null) return '—';
    if (BPS.has(id)) return formatBps(Math.round(Number(v)), loc);
    if (POISHA.has(id)) return formatBDT(Math.round(Number(v)), loc, { poisha: 'never' });
    return formatNumber(Number(v), loc, { fractionDigits: 1 });
  };
  const segment = (s: Record<string, string> | null) =>
    !s || Object.keys(s).length === 0
      ? t('segmentAll')
      : [s.cuisine, s.branch_band ? t('band', { band: s.branch_band }) : null]
          .filter(Boolean)
          .join(' · ');

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="max-w-2xl">
          <p className="font-semibold">{optedIn ? t('optedIn') : t('notOptedIn')}</p>
          <p className="text-sm text-secondary">{t('optInBody')}</p>
        </div>
        {ctx.isOwner ? (
          <ActionForm action={setBenchmarkOptInAction} successKey="common.saved">
            <input type="hidden" name="orgId" value={ctx.org.id} />
            <input type="hidden" name="orgSlug" value={ctx.org.slug} />
            <input type="hidden" name="optIn" value={optedIn ? 'false' : 'true'} />
            <Button type="submit" variant={optedIn ? 'ghost' : 'primary'}>
              {optedIn ? t('optOut') : t('optIn')}
            </Button>
          </ActionForm>
        ) : null}
      </Card>
      {rows.every((r) => r.p50 == null) ? (
        <EmptyState title={t('none')} body={t('noneBody')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.metric_id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold">{t(`metric.${r.metric_id.replace(/\./g, '_')}`)}</p>
                {r.p50 == null ? null : r.is_reference ? (
                  <Badge tone="neutral">{t('reference')}</Badge>
                ) : (
                  <Badge tone="info">{t('peers', { k: formatNumber(Number(r.k), loc) })}</Badge>
                )}
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums">
                {show(r.metric_id, r.own_value)}
              </p>
              <p className="text-xs text-secondary">
                {r.own_value == null ? t('notEnoughOwn') : t('yours')}
              </p>
              {r.p50 == null ? (
                <Hint>{t('noRange')}</Hint>
              ) : (
                <>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm tabular-nums">
                    {(['p25', 'p50', 'p75'] as const).map((p) => (
                      <div key={p} className="glass-tile rounded-input px-2 py-2">
                        <dt className="text-xs text-secondary">{t(p)}</dt>
                        <dd className="font-semibold">{show(r.metric_id, r[p])}</dd>
                      </div>
                    ))}
                  </dl>
                  {r.place ? (
                    <p className="mt-2 text-sm">
                      {t(`place.${r.place}`)}
                      {r.better !== 'neutral' ? ` ${t(`better.${r.better}`)}` : ''}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-secondary">
                    {r.is_reference
                      ? t('referenceNote')
                      : t('peerNote', { segment: segment(r.segment), period: r.period ?? '' })}
                  </p>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
      <Alert tone="info" className="mt-6">
        {t('privacy')}
      </Alert>
    </>
  );
}
