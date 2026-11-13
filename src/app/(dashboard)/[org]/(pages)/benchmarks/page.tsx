import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Hint, PageTitle } from '@/components/ui/form';
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

type Place = NonNullable<Bench['place']>;

const BPS = new Set([
  'food_cost.theoretical_pct',
  'labour.pct',
  'visits.first_return_rate',
  'channel.delivery_share',
]);
const POISHA = new Set(['sales.net_per_branch_day', 'orders.aov']);

/** Where the marker sits on the bar (percent from the left), by which quarter the restaurant falls in. */
const SPOT: Record<Place, number> = { below_p25: 8, p25_p50: 37, p50_p75: 63, above_p75: 92 };

const NEUTRAL_WORD: Record<Place, string> = {
  below_p25: 'lowerThanMost',
  p25_p50: 'aboutMiddle',
  p50_p75: 'aboutMiddle',
  above_p75: 'higherThanMost',
};

type Tone = 'success' | 'info' | 'warning' | 'neutral';

/**
 * One plain word for how a figure compares. Figures where lower is better flip, so the word always reads as
 * good news or something to look at; figures with no better direction just say lower or higher.
 */
function verdict(r: Bench): { key: string; tone: Tone } | null {
  if (!r.place) return null;
  if (r.better === 'neutral') return { key: NEUTRAL_WORD[r.place], tone: 'neutral' };
  const best: Place = r.better === 'lower' ? 'below_p25' : 'above_p75';
  const worst: Place = r.better === 'lower' ? 'above_p75' : 'below_p25';
  if (r.place === best) return { key: 'doingWell', tone: 'success' };
  if (r.place === worst) return { key: 'worthALook', tone: 'warning' };
  const goodHalf: Place = r.better === 'lower' ? 'p25_p50' : 'p50_p75';
  return r.place === goodHalf
    ? { key: 'fine', tone: 'info' }
    : { key: 'aboutMiddle', tone: 'neutral' };
}

/**
 * Benchmarks (ROADMAP Phase 9, PRODUCT.md M14), in plain words: for each figure, yours, one word on how it
 * compares, and a bar showing where you sit. Peers only as groups of five or more restaurants (SQL), or a
 * labelled typical range until enough exist. Owner and accountant (food cost and labour % are money, ADR 0007).
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
  const rows = ((data ?? []) as Bench[]).filter((r) => r.p50 != null);
  const optedIn = Boolean(settings?.benchmark_opt_in);
  const show = (id: string, v: number | null) => {
    if (v == null) return '—';
    if (BPS.has(id)) return formatBps(Math.round(Number(v)), loc);
    if (POISHA.has(id)) return formatBDT(Math.round(Number(v)), loc, { poisha: 'never' });
    return formatNumber(Number(v), loc, { fractionDigits: 1 });
  };

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {rows.length === 0 ? (
        <EmptyState title={t('none')} body={t('noneBody')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((r) => {
            const v = verdict(r);
            return (
              <Card key={r.metric_id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold">{t(`metric.${r.metric_id.replace(/\./g, '_')}`)}</p>
                  {r.is_reference ? (
                    <Badge tone="neutral">{t('reference')}</Badge>
                  ) : (
                    <Badge tone="info">{t('peers', { k: formatNumber(Number(r.k), loc) })}</Badge>
                  )}
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums">
                  {show(r.metric_id, r.own_value)}
                </p>
                {r.own_value == null ? (
                  <Hint>{t('notEnoughOwn')}</Hint>
                ) : (
                  <>
                    {v ? (
                      <div className="mt-1">
                        <StatusBadge tone={v.tone}>{t(`verdict.${v.key}`)}</StatusBadge>
                      </div>
                    ) : null}
                    {r.place ? (
                      <div
                        role="img"
                        aria-label={t('barLabel')}
                        className="relative mt-4 h-2 rounded-full bg-surface-elevated"
                      >
                        <span
                          aria-hidden
                          className="absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-purple"
                          style={{ insetInlineStart: `calc(${SPOT[r.place]}% - 0.5rem)` }}
                        />
                      </div>
                    ) : null}
                  </>
                )}
                <p className="mt-3 text-sm text-secondary">
                  {t('usual', { from: show(r.metric_id, r.p25), to: show(r.metric_id, r.p75) })}
                </p>
              </Card>
            );
          })}
        </div>
      )}
      <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
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
    </>
  );
}
