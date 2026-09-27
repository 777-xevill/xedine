import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { FindingActions, ScanForm } from '@/components/leak-forms';
import { StatusBadge } from '@/components/ui/badge';
import { Card, EmptyState, PageTitle } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import {
  formatBDT,
  formatBps,
  formatDhakaDate,
  formatNumber,
  type Locale,
} from '@/lib/i18n/format';
import { findings, type FindingRow } from '@/modules/metrics/queries';
import { getOrgContext } from '@/modules/tenancy/context';

const CONFIDENCE_TONE = { high: 'danger', medium: 'warning', low: 'info' } as const;
const STATUS_TONE = {
  new: 'warning',
  acknowledged: 'info',
  snoozed: 'neutral',
  resolved: 'success',
  dismissed: 'neutral',
} as const;

/** Business dates are plain dates; noon in Dhaka keeps them on the same calendar day in any format. */
const asDate = (d: string) => new Date(`${d}T06:00:00Z`);

export default async function LeaksPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const [{ org }, { show }] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const canSeeMoney = ctx.roles.includes('owner') || ctx.roles.includes('accountant');
  if (!canSeeMoney) notFound();

  const [t, locale] = await Promise.all([getTranslations('leaks'), getLocale()]);
  const loc = locale as Locale;
  const money = (p: number) => formatBDT(p, loc, { poisha: 'never' });
  const count = (v: unknown) => formatNumber(Number(v ?? 0), loc);
  const status = show === 'all' ? 'all' : 'open';
  const result = await findings(ctx.org.id, { status });
  const branchName = (id: string | null) =>
    ctx.branches.find((b) => b.id === id)?.name ?? t('allBranches');
  const typeKey = (type: string) => type.replace('.', '_');
  const subjectLabel = (f: FindingRow) =>
    [f.subject.staff_name, f.subject.item_name, f.subject.channel_name]
      .filter((v) => typeof v === 'string' && v !== '')
      .join(' · ');

  const evidenceText = (f: FindingRow): string[] => {
    const e = f.evidence;
    switch (f.type) {
      case 'void.after_kot':
      case 'discount.rate':
      case 'refund.rate': {
        const lines = [
          t('evidence.staffVsPeers', {
            count: count(e.count),
            orders: count(e.orders),
            value: money(Number(e.value_poisha ?? 0)),
            expected: formatNumber(Number(e.expected_count ?? 0), loc, { fractionDigits: 1 }),
          }),
          t('evidence.peers', {
            count: count(e.peer_count),
            orders: count(e.peer_orders),
            value: money(Number(e.peer_value_poisha ?? 0)),
          }),
        ];
        if (Number(e.without_reason ?? 0) > 0)
          lines.push(t('evidence.withoutReason', { count: count(e.without_reason) }));
        return lines;
      }
      case 'cash.share':
        return [
          t('evidence.cashShare', {
            share: formatBps(Number(e.share_bps ?? 0), loc),
            expected: formatBps(Number(e.expected_share_bps ?? 0), loc),
            orders: count(e.orders),
          }),
        ];
      case 'cash.over_short':
        return [
          t('evidence.overShort', {
            short: count(e.short_shifts),
            shifts: count(e.shifts),
            net: money(Number(e.net_over_short_poisha ?? 0)),
          }),
        ];
      case 'commission.drag':
        return [
          t('evidence.commission', {
            orders: count(e.orders),
            net: money(Number(e.net_poisha ?? 0)),
            pct: formatBps(Number(e.commission_bps ?? 0), loc),
            commission: money(Number(e.commission_poisha ?? 0)),
            share: formatBps(Number(e.cost_share_bps ?? 0), loc),
          }),
        ];
      case 'margin.below_target':
        return [
          t('evidence.marginBelowTarget', {
            qty: count(e.qty),
            net: money(Number(e.net_poisha ?? 0)),
            cost: money(Number(e.cost_poisha ?? 0)),
            pct: formatBps(Number(e.food_cost_bps ?? 0), loc),
            target: formatBps(Number(e.target_bps ?? 0), loc),
          }),
        ];
      case 'channel.negative_margin':
        return [
          t('evidence.negativeMargin', {
            qty: count(e.qty),
            net: money(Number(e.net_poisha ?? 0)),
            cost: money(Number(e.cost_poisha ?? 0)),
            commission: money(Number(e.commission_poisha ?? 0)),
          }),
        ];
      default:
        return [];
    }
  };

  return (
    <>
      <PageTitle
        title={t('title')}
        subtitle={t('subtitle')}
        actions={ctx.isOwner ? <ScanForm orgId={ctx.org.id} orgSlug={ctx.org.slug} /> : null}
      />
      <PillNav
        label={t('filter')}
        className="mb-6"
        items={[
          { href: `/${ctx.org.slug}/leaks`, label: t('open'), active: status === 'open' },
          { href: `/${ctx.org.slug}/leaks?show=all`, label: t('all'), active: status === 'all' },
        ]}
      />

      {result.rows.length === 0 ? (
        <EmptyState title={t('empty')} body={t('emptyBody')} />
      ) : (
        <ol className="space-y-4">
          {result.rows.map((f, i) => (
            <li key={f.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                      {t('rank', { n: i + 1 })} · {branchName(f.branch_id)}
                    </p>
                    <h2 className="mt-1 text-lg font-bold">
                      {t(`type.${typeKey(f.type)}`)}
                      {subjectLabel(f) ? ` · ${subjectLabel(f)}` : ''}
                    </h2>
                    <p className="text-sm text-secondary">
                      {t('period', {
                        from: formatDhakaDate(asDate(f.period_start), loc),
                        to: formatDhakaDate(asDate(f.period_end), loc),
                      })}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-xs text-secondary">{t(`impactLabel.${typeKey(f.type)}`)}</p>
                    <p className="text-2xl font-extrabold tabular-nums">{money(f.impact_poisha)}</p>
                    <div className="mt-1 flex flex-wrap justify-end gap-1.5">
                      <StatusBadge tone={CONFIDENCE_TONE[f.confidence]}>
                        {t(`confidence.${f.confidence}`)}
                      </StatusBadge>
                      <StatusBadge tone={STATUS_TONE[f.status]}>
                        {t(`status.${f.status}`)}
                      </StatusBadge>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="mb-1.5 text-sm font-semibold text-secondary">
                      {t('evidenceTitle')}
                    </h3>
                    <ul className="list-disc space-y-1 ps-5 text-sm">
                      {evidenceText(f).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <Link
                      href={`/${ctx.org.slug}/leaks/${f.id}`}
                      className="mt-2 inline-block text-sm font-semibold text-cyan hover:underline"
                    >
                      {t('seeEvidence')}
                    </Link>
                    <p className="mt-1 text-xs text-muted">
                      {t('metricRefs', { refs: f.metric_refs.join(', ') })}
                    </p>
                  </div>
                  <div>
                    <h3 className="mb-1.5 text-sm font-semibold text-secondary">
                      {t('actionsTitle')}
                    </h3>
                    <ul className="list-disc space-y-1 ps-5 text-sm">
                      {f.suggested_actions.map((a) => (
                        <li key={a}>{t(`action.${a}`)}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {f.reason ? (
                  <p className="mt-3 text-sm text-secondary">
                    {t('ownerNote', { note: f.reason })}
                  </p>
                ) : null}
                {ctx.isOwner ? (
                  <div className="mt-4 border-t border-line pt-4">
                    <FindingActions findingId={f.id} orgSlug={ctx.org.slug} status={f.status} />
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
