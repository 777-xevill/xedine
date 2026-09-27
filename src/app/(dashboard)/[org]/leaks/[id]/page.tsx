import { ArrowLeft, Bot } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { FindingActions } from '@/components/leak-forms';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle, EmptyState, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import {
  formatBDT,
  formatBps,
  formatDhakaDateTime,
  formatNumber,
  type Locale,
} from '@/lib/i18n/format';
import { formatQuantity } from '@/modules/inventory/format';
import type { BaseUnit } from '@/modules/purchasing/lines';
import { getOrgContext } from '@/modules/tenancy/context';

type Evidence = Record<string, unknown>;
const STOCK_TYPES = ['usage.unexplained', 'transfer.suspected', 'price.drift'];

/**
 * The rows behind one finding (public.finding_events and the detector's evidence summary): every finding
 * links to its evidence, and the owner acts on it from here — finding → evidence → action in ≤ 3 clicks.
 */
export default async function FindingEvidencePage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org, id } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('accountant')) notFound();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const [t, tu, locale] = await Promise.all([
    getTranslations('leaks'),
    getTranslations('units'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const [{ data: finding }, { data: events, error }] = await Promise.all([
    supabase
      .from('findings')
      .select(
        'id, type, subject, branch_id, status, period_start, period_end, finding_evidence(summary)',
      )
      .eq('org_id', ctx.org.id)
      .eq('id', id)
      .maybeSingle(),
    supabase.rpc('finding_events', { p_finding: id }),
  ]);
  if (!finding || error) notFound();

  const subject = (finding.subject as Record<string, unknown>) ?? {};
  const evidence =
    (finding.finding_evidence as { summary: Evidence }[] | null)?.[0]?.summary ?? ({} as Evidence);
  const base = (evidence.base as BaseUnit | undefined) ?? 'g';
  const qty = (v: unknown) => formatQuantity(Number(v ?? 0), base, loc, (u) => tu(u));
  const perKg = (x1000: unknown) =>
    formatBDT(Math.round(Number(x1000 ?? 0) * (base === 'pcs' ? 0.001 : 1)), loc);
  const rows = (events ?? []) as {
    occurred_at: string | null;
    business_date: string;
    order_id: string | null;
    order_number: number | null;
    kind: string;
    value_poisha: number;
    detail: string;
  }[];
  const type = String(finding.type);
  const itemDay = rows.some((r) => r.kind === 'item_day');
  const perDay = itemDay || rows.some((r) => r.kind === 'channel_day' || r.kind === 'staff_day');
  const isStock = STOCK_TYPES.includes(type);
  const title = t(`type.${type.replace('.', '_')}`);
  const about = String(
    subject.staff_name ??
      subject.channel_name ??
      subject.item_name ??
      subject.ingredient_name ??
      '',
  );
  const ask = t('askPrompt', { id });

  return (
    <>
      <PageTitle
        title={t('evidencePageTitle', { type: title })}
        subtitle={[about, ctx.branches.find((b) => b.id === finding.branch_id)?.name]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <Link
              href={`/${ctx.org.slug}/assistant?ask=${encodeURIComponent(ask)}`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <Bot aria-hidden className="size-4" />
              {t('askAssistant')}
            </Link>
            <Link
              href={`/${ctx.org.slug}/leaks`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <ArrowLeft aria-hidden className="size-4" />
              {t('backToLeaks')}
            </Link>
          </>
        }
      />

      {ctx.isOwner ? (
        <Card className="mb-6 p-5">
          <CardTitle className="text-base">{t('actOnIt')}</CardTitle>
          <FindingActions findingId={id} orgSlug={ctx.org.slug} status={String(finding.status)} />
        </Card>
      ) : null}

      {type === 'usage.unexplained' ? (
        <Card className="mb-6 p-5">
          <CardTitle className="text-base">
            {t('usageBreakdown', {
              from: String(evidence.period_start),
              to: String(evidence.period_end),
            })}
          </CardTitle>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ['opening', evidence.opening_qty],
                ['bought', evidence.purchases_qty],
                ['closing', evidence.closing_qty],
                ['actual', evidence.used_actual_qty],
                ['theoretical', evidence.used_theoretical_qty],
                ['waste', evidence.waste_qty],
                ['unexplained', evidence.variance_qty],
                ['voided', evidence.voided_dish_qty],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="glass-tile rounded-input px-4 py-3">
                <dt className="text-xs text-secondary">{t(`breakdown.${k}`)}</dt>
                <dd className="text-lg font-bold tabular-nums">{qty(v)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-secondary">
            {t('usageRates', {
              rate: formatBps(Number(evidence.rate_bps ?? 0), loc),
              baseline: formatBps(Number(evidence.baseline_bps ?? 0), loc),
              excess: qty(evidence.excess_qty),
            })}
          </p>
          {((evidence.suspects as { name: string; share_bps: number }[] | undefined) ?? []).length >
          0 ? (
            <>
              <h3 className="mt-4 mb-2 text-sm font-semibold">{t('suspectsTitle')}</h3>
              <ul className="space-y-1 text-sm">
                {(evidence.suspects as { name: string; share_bps: number }[]).map((s) => (
                  <li key={s.name} className="flex justify-between gap-2">
                    <span>{s.name}</span>
                    <span className="text-secondary tabular-nums">
                      {formatBps(s.share_bps, loc)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      ) : null}

      {type === 'transfer.suspected' ? (
        <Card className="mb-6 p-5">
          <CardTitle className="text-base">{t('transferBreakdown')}</CardTitle>
          <p className="text-sm">
            {t('evidence.transferSuspected', {
              over: qty(evidence.from_variance_qty),
              under: qty(-Number(evidence.to_variance_qty ?? 0)),
              toBranch: String(subject.to_branch_name ?? ''),
              match: formatNumber(Number(evidence.match_pct ?? 0), loc),
            })}
          </p>
          <p className="mt-2 text-sm text-secondary">
            {t('transferEstimate', { qty: qty(evidence.estimated_qty) })}
          </p>
        </Card>
      ) : null}

      {type === 'price.drift' ? (
        <Card className="mb-6 overflow-x-auto p-0">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="px-4 pt-4 text-start font-semibold">{t('flaggedLines')}</caption>
            <thead>
              <tr className="border-b border-line text-xs tracking-wide text-secondary uppercase">
                <th scope="col" className="px-4 py-3 text-start">
                  {t('col.day')}
                </th>
                <th scope="col" className="px-4 py-3 text-end">
                  {t('col.qty')}
                </th>
                <th scope="col" className="px-4 py-3 text-end">
                  {t('col.paidPer', {
                    unit: tu(base === 'pcs' ? 'pcs' : base === 'ml' ? 'l' : 'kg'),
                  })}
                </th>
                <th scope="col" className="px-4 py-3 text-end">
                  {t('col.usualPer')}
                </th>
                <th scope="col" className="px-4 py-3 text-end">
                  {t('col.marketPer')}
                </th>
              </tr>
            </thead>
            <tbody>
              {((evidence.lines as Evidence[] | undefined) ?? []).map((l, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2.5">{String(l.date)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{qty(l.qty)}</td>
                  <td className="px-4 py-2.5 text-end font-semibold tabular-nums">
                    {perKg(l.unit_x1000)}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{perKg(l.own_ref_x1000)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">
                    {perKg(l.market_x1000)}{' '}
                    <span className="text-xs text-secondary">
                      ({t(`basis.${String(l.basis)}`)})
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {type === 'transfer.unconfirmed' || type === 'transfer.disputed' ? (
        <Card className="mb-6 p-5">
          <ul className="space-y-1 text-sm">
            {((evidence.lines as Evidence[] | undefined) ?? []).map((l, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>{String(l.ingredient_name)}</span>
                <span className="tabular-nums text-secondary">
                  {formatQuantity(Number(l.sent_qty ?? 0), (l.base as BaseUnit) ?? 'g', loc, (u) =>
                    tu(u),
                  )}
                  {l.received_qty === null || l.received_qty === undefined
                    ? ''
                    : ` → ${formatQuantity(Number(l.received_qty), (l.base as BaseUnit) ?? 'g', loc, (u) => tu(u))}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        isStock || type.startsWith('transfer.') ? null : (
          <EmptyState title={t('noEvents')} />
        )
      ) : isStock ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[30rem] text-sm">
            <caption className="px-4 pt-4 text-start font-semibold">
              {t('purchasesInPeriod')}
            </caption>
            <thead>
              <tr className="border-b border-line text-xs tracking-wide text-secondary uppercase">
                <th scope="col" className="px-4 py-3 text-start">
                  {t('col.day')}
                </th>
                <th scope="col" className="px-4 py-3 text-end">
                  {t('col.qty')}
                </th>
                <th scope="col" className="px-4 py-3 text-end">
                  {t('col.value_purchase')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.business_date}-${i}`}
                  className="border-b border-line/60 last:border-0"
                >
                  <td className="px-4 py-2.5">{r.business_date}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{qty(r.detail)}</td>
                  <td className="px-4 py-2.5 text-end font-semibold tabular-nums">
                    {formatBDT(Number(r.value_poisha), loc)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
