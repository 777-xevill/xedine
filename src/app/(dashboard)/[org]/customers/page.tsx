import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardTitle, EmptyState, Hint, PageTitle, Stat } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { addDays } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import { businessToday } from '@/modules/metrics/queries';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';

const SEGMENTS = ['all', 'regular', 'at_risk', 'new', 'returning', 'lost'] as const;
const SEGMENT_TONE = {
  regular: 'success',
  at_risk: 'warning',
  new: 'info',
  returning: 'neutral',
  lost: 'danger',
} as const;
const WEEKDAYS = [6, 0, 1, 2, 3, 4, 5] as const;
const BLOCKS = [10, 12, 14, 16, 18, 20, 22] as const;

/** Customers (ROADMAP Phase 8): who comes back, who is slipping away, and how fast the kitchen serves them. */
export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ segment?: string; tab?: string; branch?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const has = (r: string) => ctx.roles.includes(r as never);
  if (!['owner', 'manager', 'accountant'].some(has)) notFound();
  const canSeeList = has('owner') || has('manager');
  const tab = sp.tab === 'service' ? 'service' : 'people';
  const segment = (SEGMENTS as readonly string[]).includes(sp.segment ?? '')
    ? (sp.segment as (typeof SEGMENTS)[number])
    : 'all';
  const [t, tw, locale] = await Promise.all([
    getTranslations('customers'),
    getTranslations('weekdays'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const pct = (bps: number | null) => (bps === null ? '—' : formatBps(bps, loc));
  const supabase = await createClient();
  const at = now().toISOString();
  const scope = ctx.selectedBranchId;

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <PillNav
        label={t('sections')}
        className="mb-6"
        items={(['people', 'service'] as const).map((x) => ({
          href: `/${ctx.org.slug}/customers?tab=${x}`,
          label: t(`tabs.${x}`),
          active: x === tab,
        }))}
      />
      {tab === 'people'
        ? await (async () => {
            const { data: summary } = await supabase.rpc('metric_customer_summary', {
              p_org: ctx.org.id,
              p_branch: scope,
              p_now: at,
            });
            const s = ((summary ?? []) as Record<string, unknown>[])[0] ?? {};
            const segs = (s.segments ?? {}) as Record<string, number>;
            const list = canSeeList
              ? (((
                  await supabase.rpc('metric_customers', {
                    p_org: ctx.org.id,
                    p_branch: scope,
                    p_now: at,
                    p_segment: segment === 'all' ? null : segment,
                    p_limit: 100,
                  })
                ).data ?? []) as Record<string, unknown>[])
              : [];
            return (
              <div className="space-y-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat
                    label={t('identified')}
                    value={pct(
                      s.identified_share_bps === undefined
                        ? null
                        : (s.identified_share_bps as number | null),
                    )}
                  />
                  <Stat
                    label={t('return30')}
                    value={pct((s.first_return_30d_bps as number | null) ?? null)}
                  />
                  <Stat
                    label={t('return60')}
                    value={pct((s.first_return_60d_bps as number | null) ?? null)}
                  />
                  <Stat label={t('atRisk')} value={formatNumber(Number(segs.at_risk ?? 0), loc)} />
                </div>
                <Hint>
                  {t('summaryHint', {
                    firstTimers: formatNumber(Number(s.first_timers ?? 0), loc),
                  })}
                </Hint>
                {canSeeList ? (
                  <Card className="p-4 sm:p-6">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="mb-0">{t('listTitle')}</CardTitle>
                      <PillNav
                        label={t('segment')}
                        items={SEGMENTS.map((x) => ({
                          href: `/${ctx.org.slug}/customers?segment=${x}`,
                          label:
                            x === 'all'
                              ? t('all')
                              : `${t(`segments.${x}`)} (${formatNumber(Number(segs[x] ?? 0), loc)})`,
                          active: x === segment,
                        }))}
                      />
                    </div>
                    {list.length === 0 ? (
                      <EmptyState title={t('none')} body={t('noneBody')} />
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[44rem] text-sm">
                          <thead className="text-xs text-secondary uppercase">
                            <tr>
                              <th className="py-2 text-start font-medium">{t('phone')}</th>
                              <th className="py-2 text-end font-medium">{t('visits')}</th>
                              <th className="py-2 text-end font-medium">{t('lastVisit')}</th>
                              <th className="py-2 text-end font-medium">{t('spend90')}</th>
                              <th className="py-2 text-end font-medium">{t('rfm')}</th>
                              <th className="py-2 text-end font-medium">{t('segment')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map((c) => (
                              <tr key={c.customer_id as string} className="border-t border-line">
                                <td className="py-2.5">
                                  <span className="font-medium tabular-nums">
                                    {c.phone as string}
                                  </span>
                                  {c.marketing_ok ? null : (
                                    <span className="ms-2 text-xs text-secondary">
                                      {t('noConsent')}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 text-end tabular-nums">
                                  {formatNumber(Number(c.visits), loc)}
                                </td>
                                <td className="py-2.5 text-end tabular-nums">
                                  {c.last_visit as string}
                                  <span className="block text-xs text-secondary">
                                    {t('daysAgo', { days: Number(c.days_since) })}
                                  </span>
                                </td>
                                <td className="py-2.5 text-end tabular-nums">
                                  {formatBDT(Number(c.spend_90d_poisha), loc, { poisha: 'never' })}
                                </td>
                                <td className="py-2.5 text-end text-xs text-secondary tabular-nums">
                                  {`R${c.r ?? '–'} F${c.f} M${c.m}`}
                                </td>
                                <td className="py-2.5 text-end">
                                  <StatusBadge
                                    tone={SEGMENT_TONE[c.segment as keyof typeof SEGMENT_TONE]}
                                  >
                                    {t(`segments.${c.segment as string}`)}
                                  </StatusBadge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <Hint className="mt-3">{t('segmentsHint')}</Hint>
                  </Card>
                ) : null}
              </div>
            );
          })()
        : await (async () => {
            const branch = pickBranch(ctx, sp.branch);
            if (!branch) return <EmptyState title={t('none')} />;
            const { date: today } = await businessToday(ctx.org.id);
            const { data } = await supabase.rpc('metric_service_slots', {
              p_org: ctx.org.id,
              p_branch: branch.id,
              p_from: addDays(today, -28),
              p_to: addDays(today, -1),
            });
            const slots = (data ?? []) as {
              weekday: number;
              from_hour: number;
              orders: number;
              median_seconds: number;
            }[];
            const all = slots
              .flatMap((x) => Array(Number(x.orders)).fill(Number(x.median_seconds)) as number[])
              .sort((a, b) => a - b);
            const typical = all.length ? all[Math.floor(all.length / 2)]! : 0;
            const cell = (d: number, h: number) =>
              slots.find((x) => x.weekday === d && x.from_hour === h);
            return (
              <Card className="p-4 sm:p-6">
                {ctx.branches.length > 1 ? (
                  <PillNav
                    label={t('branches')}
                    className="mb-4"
                    items={ctx.branches.map((b) => ({
                      href: `/${ctx.org.slug}/customers?tab=service&branch=${b.id}`,
                      label: b.name,
                      active: b.id === branch.id,
                    }))}
                  />
                ) : null}
                <CardTitle>{t('serviceTitle')}</CardTitle>
                <p className="-mt-2 mb-4 text-sm text-secondary">
                  {t('serviceBody', { minutes: formatNumber(Math.round(typical / 60), loc) })}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-center text-sm">
                    <thead className="text-xs text-secondary">
                      <tr>
                        <th className="py-2 text-start font-medium">{t('day')}</th>
                        {BLOCKS.map((h) => (
                          <th
                            key={h}
                            className="py-2 font-medium tabular-nums"
                          >{`${h}–${h + 2}`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {WEEKDAYS.map((d) => (
                        <tr key={d} className="border-t border-line">
                          <td className="py-2 text-start font-medium">{tw(String(d))}</td>
                          {BLOCKS.map((h) => {
                            const c = cell(d, h);
                            const slow =
                              c &&
                              Number(c.orders) >= 12 &&
                              typical > 0 &&
                              Number(c.median_seconds) >= 1.5 * typical;
                            return (
                              <td
                                key={h}
                                className={`py-2 tabular-nums ${slow ? 'font-bold text-danger' : ''}`}
                              >
                                {c
                                  ? formatNumber(Math.round(Number(c.median_seconds) / 60), loc)
                                  : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Hint className="mt-3">{t('serviceHint')}</Hint>
              </Card>
            );
          })()}
    </>
  );
}
