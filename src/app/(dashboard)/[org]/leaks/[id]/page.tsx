import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { Card, EmptyState, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, formatDhakaDateTime, formatNumber, type Locale } from '@/lib/i18n/format';
import { getOrgContext } from '@/modules/tenancy/context';

/** The rows behind one finding (public.finding_events): every finding links to its evidence. */
export default async function FindingEvidencePage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org, id } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('accountant')) notFound();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const [t, locale] = await Promise.all([getTranslations('leaks'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const [{ data: finding }, { data: events, error }] = await Promise.all([
    supabase
      .from('findings')
      .select('id, type, subject, branch_id')
      .eq('org_id', ctx.org.id)
      .eq('id', id)
      .maybeSingle(),
    supabase.rpc('finding_events', { p_finding: id }),
  ]);
  if (!finding || error) notFound();

  const subject = (finding.subject as Record<string, unknown>) ?? {};
  const rows = (events ?? []) as {
    occurred_at: string | null;
    business_date: string;
    order_id: string | null;
    order_number: number | null;
    kind: string;
    value_poisha: number;
    detail: string;
  }[];
  const itemDay = rows.some((r) => r.kind === 'item_day');
  const perDay = itemDay || rows.some((r) => r.kind === 'channel_day' || r.kind === 'staff_day');

  return (
    <>
      <PageTitle
        title={t('evidencePageTitle', {
          type: t(`type.${String(finding.type).replace('.', '_')}`),
        })}
        subtitle={String(subject.staff_name ?? subject.channel_name ?? '')}
        actions={
          <Link
            href={`/${ctx.org.slug}/leaks`}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <ArrowLeft aria-hidden className="size-4" />
            {t('backToLeaks')}
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title={t('noEvents')} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">{t('evidenceTitle')}</caption>
            <thead>
              <tr className="border-b border-line text-start text-xs tracking-wide text-secondary uppercase">
                <th scope="col" className="px-4 py-3 text-start">
                  {perDay ? t('col.day') : t('col.when')}
                </th>
                <th scope="col" className="px-4 py-3 text-start">
                  {perDay ? t('col.orders') : t('col.order')}
                </th>
                <th scope="col" className="px-4 py-3 text-end">
                  {t(`col.value_${rows[0]!.kind}`)}
                </th>
                {itemDay ? (
                  <th scope="col" className="px-4 py-3 text-end">
                    {t('col.netSales')}
                  </th>
                ) : perDay ? null : (
                  <th scope="col" className="px-4 py-3 text-start">
                    {t('col.reason')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.business_date}-${i}`}
                  className="border-b border-line/60 last:border-0"
                >
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {perDay || !r.occurred_at
                      ? r.business_date
                      : formatDhakaDateTime(new Date(r.occurred_at), loc)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {r.order_number === null
                      ? '—'
                      : perDay
                        ? formatNumber(r.order_number, loc)
                        : `#${formatNumber(r.order_number, loc)}`}
                  </td>
                  <td className="px-4 py-2.5 text-end font-semibold tabular-nums">
                    {formatBDT(Number(r.value_poisha), loc)}
                  </td>
                  {itemDay ? (
                    <td className="px-4 py-2.5 text-end tabular-nums">
                      {formatBDT(Number(r.detail || 0), loc)}
                    </td>
                  ) : perDay ? null : (
                    <td className="px-4 py-2.5 text-secondary">{r.detail || '—'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
