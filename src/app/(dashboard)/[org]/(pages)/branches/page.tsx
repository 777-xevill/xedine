import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardTitle, EmptyState, Hint, PageTitle } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { addDays } from '@/lib/time/business-date';
import { businessToday } from '@/modules/metrics/queries';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';

type Row = Record<string, unknown>;
const PERIODS = [7, 28, 90] as const;
type Tab = 'league' | 'gaps' | 'items' | 'scorecard' | 'transfers';
const TRANSFER_TONE = { sent: 'warning', received: 'success', disputed: 'danger' } as const;

/**
 * Branches (ROADMAP Phase 9, PRODUCT.md M13): the league table, the gap to the best branch in ৳, the same
 * items side by side, a money-free scorecard for managers, and the transfer audit. Every figure comes
 * from a metric function; cost columns arrive empty for roles that may not see money (ADR 0007).
 */
export default async function BranchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ tab?: string; days?: string; branch?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const has = (r: string) => ctx.roles.includes(r as never);
  if (!['owner', 'manager', 'accountant'].some(has)) notFound();
  const money = has('owner') || has('accountant');
  const multi = ctx.branches.length > 1;
  const allowed: Tab[] = [
    ...(multi ? (['league'] as const) : []),
    ...(money && multi ? (['gaps', 'items'] as const) : []),
    'scorecard',
    'transfers',
  ];
  const tab = (allowed as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : allowed[0]!;
  const days = (PERIODS as readonly number[]).includes(Number(sp.days)) ? Number(sp.days) : 28;
  const [t, locale] = await Promise.all([getTranslations('branches'), getLocale()]);
  const loc = locale as Locale;
  const { date: today } = await businessToday(ctx.org.id);
  const to = addDays(today, -1);
  const from = addDays(to, -(days - 1));
  const supabase = await createClient();
  const name = (id: unknown) => ctx.branches.find((b) => b.id === id)?.name ?? t('otherBranch');
  const bdt = (v: unknown) => (v == null ? '—' : formatBDT(Number(v), loc, { poisha: 'never' }));
  const bps = (v: unknown) => (v == null ? '—' : formatBps(Number(v), loc));
  const num = (v: unknown, digits = 0) =>
    v == null ? '—' : formatNumber(Number(v), loc, { fractionDigits: digits });
  const href = (x: { tab?: string; days?: number; branch?: string }) => {
    const q = new URLSearchParams({ tab: x.tab ?? tab, days: String(x.days ?? days) });
    if (x.branch ?? sp.branch) q.set('branch', (x.branch ?? sp.branch)!);
    return `/${ctx.org.slug}/branches?${q.toString()}`;
  };

  let body: React.ReactNode;
  if (tab === 'league') {
    const { data } = await supabase.rpc('metric_branch_league', {
      p_org: ctx.org.id,
      p_from: from,
      p_to: to,
    });
    const rows = (data ?? []) as Row[];
    body =
      rows.length === 0 ? (
        <EmptyState title={t('none')} />
      ) : (
        <Card className="p-4 sm:p-6">
          <CardTitle>{t('leagueTitle')}</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="text-xs text-secondary">
                <tr>
                  <th className="py-2 text-start font-medium">{t('branch')}</th>
                  <th className="py-2 text-end font-medium">{t('col.netPerDay')}</th>
                  <th className="py-2 text-end font-medium">{t('col.orders')}</th>
                  <th className="py-2 text-end font-medium">{t('col.aov')}</th>
                  <th className="py-2 text-end font-medium">{t('col.delivery')}</th>
                  <th className="py-2 text-end font-medium">{t('col.ticket')}</th>
                  <th className="py-2 text-end font-medium">{t('col.rating')}</th>
                  <th className="py-2 text-end font-medium">{t('col.return')}</th>
                  <th className="py-2 text-end font-medium">{t('col.discipline')}</th>
                  <th className="py-2 text-end font-medium">{t('col.discounts')}</th>
                  {money ? (
                    <>
                      <th className="py-2 text-end font-medium">{t('col.foodCost')}</th>
                      <th className="py-2 text-end font-medium">{t('col.labour')}</th>
                      <th className="py-2 text-end font-medium">{t('col.waste')}</th>
                      <th className="py-2 text-end font-medium">{t('col.unexplained')}</th>
                      <th className="py-2 text-end font-medium">{t('col.gap')}</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.branch_id as string} className="border-t border-line tabular-nums">
                    <td className="py-2.5 font-medium">{name(r.branch_id)}</td>
                    <td className="py-2.5 text-end">{bdt(r.net_per_day_poisha)}</td>
                    <td className="py-2.5 text-end">{num(r.orders)}</td>
                    <td className="py-2.5 text-end">{bdt(r.aov_poisha)}</td>
                    <td className="py-2.5 text-end">{bps(r.delivery_share_bps)}</td>
                    <td className="py-2.5 text-end">
                      {r.ticket_median_seconds == null
                        ? '—'
                        : num(Number(r.ticket_median_seconds) / 60, 1)}
                    </td>
                    <td className="py-2.5 text-end">{num(r.rating_avg, 1)}</td>
                    <td className="py-2.5 text-end">{bps(r.first_return_30d_bps)}</td>
                    <td className="py-2.5 text-end">{num(r.discipline_avg)}</td>
                    <td className="py-2.5 text-end">{bps(r.discount_bps)}</td>
                    {money ? (
                      <>
                        <td className="py-2.5 text-end">{bps(r.tfc_pct_bps)}</td>
                        <td className="py-2.5 text-end">{bps(r.labour_bps)}</td>
                        <td className="py-2.5 text-end">{bps(r.waste_bps)}</td>
                        <td className="py-2.5 text-end">{bps(r.unexplained_bps)}</td>
                        <td
                          className={`py-2.5 text-end font-semibold ${Number(r.gap_poisha) > 0 ? 'text-danger' : ''}`}
                        >
                          {bdt(r.gap_poisha)}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Hint className="mt-3">{money ? t('leagueHintMoney') : t('leagueHint')}</Hint>
        </Card>
      );
  } else if (tab === 'gaps') {
    const { data } = await supabase.rpc('metric_branch_gaps', {
      p_org: ctx.org.id,
      p_from: from,
      p_to: to,
    });
    const rows = ((data ?? []) as Row[]).filter((r) => Number(r.gap_poisha) > 0);
    const byBranch = new Map<string, Row[]>();
    for (const r of rows)
      byBranch.set(r.branch_id as string, [...(byBranch.get(r.branch_id as string) ?? []), r]);
    body =
      byBranch.size === 0 ? (
        <EmptyState title={t('noGaps')} body={t('noGapsBody')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {[...byBranch.entries()]
            .sort((a, b) => sum(b[1]) - sum(a[1]))
            .map(([bid, list]) => (
              <Card key={bid} className="p-5">
                <p className="text-sm text-secondary">{name(bid)}</p>
                <p className="text-2xl font-bold tabular-nums">{bdt(sum(list))}</p>
                <p className="mb-3 text-xs text-secondary">{t('gapCaption', { days })}</p>
                <ul className="space-y-2 text-sm">
                  {list.map((g) => (
                    <li
                      key={g.component as string}
                      className="flex items-baseline justify-between gap-3 border-t border-line pt-2"
                    >
                      <span>
                        {t(`component.${g.component as string}`)}
                        <span className="block text-xs text-secondary">
                          {t('gapLine', {
                            rate: bps(g.branch_bps),
                            best: bps(g.best_bps),
                            bestBranch: name(g.best_branch_id),
                          })}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums">{bdt(g.gap_poisha)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          <Hint className="md:col-span-2">{t('gapsHint')}</Hint>
        </div>
      );
  } else if (tab === 'items') {
    const { data } = await supabase.rpc('metric_like_for_like', {
      p_org: ctx.org.id,
      p_from: from,
      p_to: to,
    });
    const rows = (data ?? []) as Row[];
    const branchIds = [...new Set(rows.map((r) => r.branch_id as string))];
    const items = [...new Set(rows.map((r) => r.menu_item_id as string))];
    body =
      rows.length === 0 ? (
        <EmptyState title={t('noItems')} />
      ) : (
        <Card className="p-4 sm:p-6">
          <CardTitle>{t('itemsTitle')}</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-xs text-secondary">
                <tr>
                  <th className="py-2 text-start font-medium">{t('item')}</th>
                  {branchIds.map((b) => (
                    <th key={b} className="py-2 text-end font-medium">
                      {name(b)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const cells = rows.filter((r) => r.menu_item_id === i);
                  const first = cells[0]!;
                  return (
                    <tr key={i} className="border-t border-line tabular-nums">
                      <td className="py-2.5 font-medium">
                        {(loc === 'bn' ? (first.name_bn ?? first.name) : first.name) as string}
                      </td>
                      {branchIds.map((b) => {
                        const c = cells.find((x) => x.branch_id === b);
                        return (
                          <td key={b} className="py-2.5 text-end">
                            {c ? (
                              <>
                                {t('perDay', { qty: num(c.per_day, 1) })}
                                <span className="block text-xs text-secondary">
                                  {bdt(c.avg_net_poisha)}
                                </span>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Hint className="mt-3">{t('itemsHint')}</Hint>
        </Card>
      );
  } else if (tab === 'scorecard') {
    const branch = pickBranch(ctx, sp.branch);
    if (!branch) body = <EmptyState title={t('none')} />;
    else {
      const { data } = await supabase.rpc('metric_branch_scorecard', {
        p_org: ctx.org.id,
        p_branch: branch.id,
        p_from: from,
        p_to: to,
      });
      const rows = (data ?? []) as {
        measure: string;
        value: number | null;
        rank: number | null;
        branches: number;
      }[];
      const show = (m: string, v: number | null) => {
        if (v == null) return '—';
        if (m === 'net_per_day' || m === 'aov') return bdt(Math.round(Number(v)));
        if (m === 'first_return' || m === 'discount_rate' || m === 'void_rate') return bps(v);
        if (m === 'ticket_minutes') return t('minutes', { n: num(v, 1) });
        if (m === 'rating') return t('outOfTen', { n: num(v, 1) });
        if (m === 'orders_per_day') return num(v, 1);
        return num(v);
      };
      body = (
        <Card className="p-4 sm:p-6">
          {ctx.branches.length > 1 ? (
            <PillNav
              label={t('branch')}
              className="mb-4"
              items={ctx.branches.map((b) => ({
                href: href({ branch: b.id }),
                label: b.name,
                active: b.id === branch.id,
              }))}
            />
          ) : null}
          <CardTitle>{t('scorecardTitle', { branch: branch.name })}</CardTitle>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <li key={r.measure} className="glass-tile rounded-input px-4 py-3">
                <p className="text-xs font-medium tracking-wide text-secondary uppercase">
                  {t(`measure.${r.measure}`)}
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">{show(r.measure, r.value)}</p>
                <p className="text-xs text-secondary">
                  {r.rank == null
                    ? t('noRank')
                    : t('rank', { rank: num(r.rank), of: num(r.branches) })}
                </p>
              </li>
            ))}
          </ul>
          <Hint className="mt-3">{t('scorecardHint')}</Hint>
        </Card>
      );
    }
  } else {
    const { data } = await supabase.rpc('metric_transfer_audit', {
      p_org: ctx.org.id,
      p_branch: ctx.selectedBranchId,
      p_from: addDays(to, -89),
      p_to: today,
    });
    const rows = (data ?? []) as Row[];
    body =
      rows.length === 0 ? (
        <EmptyState title={t('noTransfers')} />
      ) : (
        <Card className="p-4 sm:p-6">
          <CardTitle>{t('transfersTitle')}</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-xs text-secondary">
                <tr>
                  <th className="py-2 text-start font-medium">{t('sentOn')}</th>
                  <th className="py-2 text-start font-medium">{t('route')}</th>
                  <th className="py-2 text-end font-medium">{t('lines')}</th>
                  <th className="py-2 text-end font-medium">{t('short')}</th>
                  <th className="py-2 text-end font-medium">{t('daysToReceive')}</th>
                  {money ? <th className="py-2 text-end font-medium">{t('valueShort')}</th> : null}
                  <th className="py-2 text-end font-medium">{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.transfer_id as string} className="border-t border-line tabular-nums">
                    <td className="py-2.5">{r.sent_on as string}</td>
                    <td className="py-2.5">
                      {t('fromTo', { from: name(r.from_branch_id), to: name(r.to_branch_id) })}
                    </td>
                    <td className="py-2.5 text-end">{num(r.lines)}</td>
                    <td
                      className={`py-2.5 text-end ${Number(r.short_lines) > 0 ? 'font-semibold text-danger' : ''}`}
                    >
                      {num(r.short_lines)}
                    </td>
                    <td className="py-2.5 text-end">{num(r.days_to_receive)}</td>
                    {money ? (
                      <td className="py-2.5 text-end">{bdt(r.value_short_poisha)}</td>
                    ) : null}
                    <td className="py-2.5 text-end">
                      <StatusBadge
                        tone={TRANSFER_TONE[r.status as keyof typeof TRANSFER_TONE] ?? 'neutral'}
                      >
                        {t(`transferStatus.${r.status as string}`)}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Hint className="mt-3">{t('transfersHint')}</Hint>
        </Card>
      );
  }

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <PillNav
          label={t('sections')}
          items={allowed.map((x) => ({
            href: href({ tab: x }),
            label: t(`tabs.${x}`),
            active: x === tab,
          }))}
        />
        {tab !== 'transfers' ? (
          <PillNav
            label={t('period')}
            items={PERIODS.map((d) => ({
              href: href({ days: d }),
              label: t('days', { days: d }),
              active: d === days,
            }))}
          />
        ) : null}
      </div>
      {body}
    </>
  );
}

function sum(rows: Row[]): number {
  return rows.reduce((s, r) => s + Number(r.gap_poisha ?? 0), 0);
}
