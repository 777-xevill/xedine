import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { DeleteCustomerButton } from '@/components/delete-customer-button';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardTitle, EmptyState, Hint, PageTitle, Stat } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import { getOrgContext } from '@/modules/tenancy/context';

const SEGMENTS = ['all', 'regular', 'at_risk', 'new', 'returning', 'lost'] as const;
const SEGMENT_TONE = {
  regular: 'success',
  at_risk: 'warning',
  new: 'info',
  returning: 'neutral',
  lost: 'danger',
} as const;

/** Customers (ROADMAP Phase 8): who comes back and who is slipping away (service speed removed, ADR 0052). */
export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ segment?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const has = (r: string) => ctx.roles.includes(r as never);
  if (!['owner', 'manager', 'accountant'].some(has)) notFound();
  const canSeeList = has('owner') || has('manager');
  const segment = (SEGMENTS as readonly string[]).includes(sp.segment ?? '')
    ? (sp.segment as (typeof SEGMENTS)[number])
    : 'all';
  const [t, locale] = await Promise.all([getTranslations('customers'), getLocale()]);
  const loc = locale as Locale;
  const pct = (bps: number | null) => (bps === null ? '—' : formatBps(bps, loc));
  const supabase = await createClient();
  const at = now().toISOString();
  const scope = ctx.selectedBranchId;

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {await (async () => {
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
                          <th className="py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((c) => (
                          <tr key={c.customer_id as string} className="border-t border-line">
                            <td className="py-2.5">
                              <span className="font-medium tabular-nums">{c.phone as string}</span>
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
                            <td className="py-2.5 text-end">
                              <DeleteCustomerButton
                                orgId={ctx.org.id}
                                orgSlug={ctx.org.slug}
                                customerId={c.customer_id as string}
                                phone={c.phone as string}
                                visits={Number(c.visits)}
                              />
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
      })()}
    </>
  );
}
