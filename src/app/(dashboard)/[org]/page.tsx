import { ChefHat, ClipboardList, MonitorSmartphone, Store, Users } from 'lucide-react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { InsightActions } from '@/components/leak-forms';
import { BarList } from '@/components/metrics/bar-list';
import { StatusBadge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle, EmptyState, PageTitle, Stat } from '@/components/ui/form';
import {
  formatBDT,
  formatBps,
  formatDhakaDate,
  formatNumber,
  type Locale,
} from '@/lib/i18n/format';
import {
  businessToday,
  findings,
  flashPnl,
  itemVelocity,
  pace,
  sales,
  salesSplit,
  type FlashPnlRow,
  type PaceRow,
} from '@/modules/metrics/queries';
import { createClient } from '@/lib/db/supabase-server';
import { addDays } from '@/lib/time/business-date';
import { discipline } from '@/modules/inventory/queries';
import { getOrgContext } from '@/modules/tenancy/context';

const RAG_TONE = { green: 'success', amber: 'warning', red: 'danger', none: 'neutral' } as const;

export default async function OverviewPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const [ctx, t, th, roles, locale] = await Promise.all([
    getOrgContext(org),
    getTranslations('dashboard'),
    getTranslations('health'),
    getTranslations('roles'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const money = (p: number) => formatBDT(p, loc, { poisha: 'never' });
  const isAllBranches = ctx.branches.length > 0 && ctx.isOwner;
  const has = (r: (typeof ctx.roles)[number]) => ctx.roles.includes(r);
  const canSeeMoney = has('owner') || has('accountant');
  const seesSales = canSeeMoney || has('manager');
  const base = `/${ctx.org.slug}`;
  const scope = ctx.selectedBranchId;
  const branchName = (id: string | null) => ctx.branches.find((b) => b.id === id)?.name ?? '';

  // Every figure below comes from a metric function (CLAUDE.md #1); this page only formats.
  const today = seesSales && ctx.branches.length > 0 ? await businessToday(ctx.org.id) : null;
  const [salesToday, paceToday, channels, topItems, pnl, openFindings] = today
    ? await Promise.all([
        sales(ctx.org.id, scope, today.date, today.date),
        pace(ctx.org.id, scope),
        salesSplit(ctx.org.id, scope, today.date, today.date, 'channel'),
        itemVelocity(ctx.org.id, scope, 'today'),
        canSeeMoney ? flashPnl(ctx.org.id, scope).catch(() => null) : Promise.resolve(null),
        canSeeMoney ? findings(ctx.org.id, { limit: 3 }).catch(() => null) : Promise.resolve(null),
      ])
    : [null, null, null, null, null, null];

  // Today's proactive insights (max three, ranked in SQL); money rows, so owner/accountant only.
  const insights =
    today && canSeeMoney
      ? (((
          await (
            await createClient()
          )
            .from('insight_feed')
            .select('id, finding_id, payload')
            .eq('org_id', ctx.org.id)
            .eq('shown_on', today.date)
            .eq('status', 'shown')
            .order('rank', { ascending: false })
        ).data ?? []) as { id: string; finding_id: string; payload: Record<string, unknown> }[])
      : [];
  // Today's habits (METRICS.md "Discipline score"): what is still missing, per branch, as a nudge.
  const habits =
    today && (ctx.isOwner || has('manager'))
      ? await discipline(ctx.org.id, scope, addDays(today.date, -1), today.date).catch(() => [])
      : [];
  const habitBranches = [...new Set(habits.map((h) => h.branch_id))];
  const subjectOf = (s: unknown) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return [o.staff_name, o.item_name, o.channel_name]
      .filter((v) => typeof v === 'string' && v)
      .join(' · ');
  };
  const branchRows = (salesToday?.rows ?? []).filter((r) => r.branch_id !== null);
  const totalRow = salesToday?.rows.find((r) => r.branch_id === null) ?? null;
  const paceBy = new Map((paceToday?.rows ?? []).map((p) => [p.branch_id, p]));
  const pnlBy = new Map((pnl?.rows ?? []).map((p) => [p.branch_id, p]));
  const hasAnySales =
    (totalRow?.orders_completed ?? 0) > 0 ||
    (paceToday?.rows ?? []).some((p) => p.typical_net_poisha);

  const actions = [
    ...(ctx.isOwner || has('manager') || has('cashier')
      ? [
          {
            href: '/pos',
            icon: <MonitorSmartphone />,
            title: t('actionPos'),
            body: t('actionPosBody'),
          },
        ]
      : []),
    ...(ctx.isOwner || has('manager') || has('kitchen')
      ? [{ href: '/kds', icon: <ChefHat />, title: t('actionKds'), body: t('actionKdsBody') }]
      : []),
    ...(ctx.isOwner
      ? [
          {
            href: `${base}/menu`,
            icon: <ClipboardList />,
            title: t('actionMenu'),
            body: t('actionMenuBody'),
          },
        ]
      : []),
    ...(ctx.isOwner || has('manager')
      ? [
          {
            href: `${base}/staff`,
            icon: <Users />,
            title: t('actionStaff'),
            body: t('actionStaffBody'),
          },
          {
            href: `${base}/branch`,
            icon: <Store />,
            title: t('actionBranch'),
            body: t('actionBranchBody'),
          },
        ]
      : []),
  ];

  const paceText = (p: PaceRow | undefined) =>
    !p || p.rag === 'none' || p.pace_bps === null
      ? th('paceNone')
      : th('paceOf', { pct: formatBps(p.pace_bps, loc) });

  const moneyBlock = (p: FlashPnlRow | undefined) =>
    p ? (
      <div className="mt-4 space-y-2 border-t border-line pt-3">
        <p className="text-sm">
          {p.breakeven_remaining_poisha > 0 ? (
            <span className="font-semibold">
              {th('breakevenRemaining', { amount: money(p.breakeven_remaining_poisha) })}
            </span>
          ) : (
            <span className="font-semibold text-success">{th('breakevenReached')}</span>
          )}
        </p>
        <p className="text-sm text-secondary">
          {th('estimatedProfit')}{' '}
          <span className="font-semibold text-foreground tabular-nums">
            {money(p.estimated_profit_poisha)}
          </span>
        </p>
        <p className="text-xs text-muted">
          {th('assumedCogs', { pct: formatBps(p.assumed_food_cost_bps, loc) })}
        </p>
      </div>
    ) : null;

  return (
    <>
      <PageTitle
        title={t('welcome', { name: ctx.fullName })}
        subtitle={
          today
            ? th('subtitle', { date: formatDhakaDate(new Date(`${today.date}T06:00:00Z`), loc) })
            : t('subtitle')
        }
      />

      {today && hasAnySales ? (
        <section aria-labelledby="today-heading" className="mb-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 id="today-heading" className="text-lg font-bold tracking-tight">
              {th('today')}
            </h2>
            <Link
              href={`${base}/sales`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              {th('openExplorer')}
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {branchRows.map((r) => {
              const p = paceBy.get(r.branch_id!);
              return (
                <Card key={r.branch_id} className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold">{branchName(r.branch_id)}</h3>
                    <StatusBadge tone={RAG_TONE[p?.rag ?? 'none']}>
                      {th(`rag.${p?.rag ?? 'none'}`)}
                    </StatusBadge>
                  </div>
                  <p className="mt-3 text-xs font-medium tracking-wide text-secondary uppercase">
                    {th('netSales')}
                  </p>
                  <p className="text-3xl font-extrabold tabular-nums">{money(r.net_poisha)}</p>
                  <p className="mt-1 text-sm text-secondary">{paceText(p)}</p>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-secondary">{th('orders')}</dt>
                      <dd className="font-semibold tabular-nums">
                        {formatNumber(r.orders_completed, loc)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-secondary">{th('aov')}</dt>
                      <dd className="font-semibold tabular-nums">
                        {r.aov_poisha === null ? '—' : money(r.aov_poisha)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-secondary">{th('covers')}</dt>
                      <dd className="font-semibold tabular-nums">
                        {r.covers_orders > 0 ? formatNumber(r.covers, loc) : '—'}
                      </dd>
                    </div>
                  </dl>
                  {moneyBlock(pnlBy.get(r.branch_id))}
                </Card>
              );
            })}
            {branchRows.length > 1 && totalRow ? (
              <Card className="p-5">
                <h3 className="font-bold">{th('allBranches')}</h3>
                <p className="mt-3 text-xs font-medium tracking-wide text-secondary uppercase">
                  {th('netSales')}
                </p>
                <p className="text-3xl font-extrabold tabular-nums">{money(totalRow.net_poisha)}</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Stat label={th('orders')} value={formatNumber(totalRow.orders_completed, loc)} />
                  <Stat
                    label={th('aov')}
                    value={totalRow.aov_poisha === null ? '—' : money(totalRow.aov_poisha)}
                  />
                </div>
                {moneyBlock(pnlBy.get(null))}
              </Card>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <CardTitle>{th('channelMix')}</CardTitle>
              {(channels?.rows ?? []).length === 0 ? (
                <p className="text-sm text-secondary">{th('noSalesYet')}</p>
              ) : (
                <BarList
                  label={th('channelMix')}
                  items={(channels?.rows ?? []).map((c) => ({
                    key: c.key,
                    label: c.label || c.key,
                    value: c.net_poisha,
                    display: money(c.net_poisha),
                    hint: th('ordersCount', { count: c.orders }),
                  }))}
                />
              )}
            </Card>
            <Card className="p-5">
              <CardTitle>{th('topItems')}</CardTitle>
              {(topItems?.rows ?? []).length === 0 ? (
                <p className="text-sm text-secondary">{th('noSalesYet')}</p>
              ) : (
                <BarList
                  label={th('topItems')}
                  items={(topItems?.rows ?? []).slice(0, 6).map((i) => ({
                    key: i.menu_item_id ?? i.name,
                    label: i.name,
                    value: i.qty,
                    display: formatNumber(i.qty, loc),
                  }))}
                />
              )}
            </Card>
          </div>

          {insights.length > 0 ? (
            <Card className="mt-4 p-5">
              <CardTitle>{th('insightsTitle')}</CardTitle>
              <ul className="space-y-3">
                {insights.map((i) => (
                  <li key={i.id} className="glass-tile rounded-input p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`${base}/leaks/${i.finding_id}`}
                        className="text-sm font-semibold hover:underline"
                      >
                        {th(`findingType.${String(i.payload.type).replace('.', '_')}`)}
                        {subjectOf(i.payload.subject) ? ` · ${subjectOf(i.payload.subject)}` : ''}
                        {i.payload.branch_id
                          ? ` · ${branchName(i.payload.branch_id as string)}`
                          : ''}
                      </Link>
                      <span className="font-bold tabular-nums">
                        {money(Number(i.payload.impact_poisha ?? 0))}
                      </span>
                    </div>
                    {ctx.isOwner ? (
                      <InsightActions insightId={i.id} orgSlug={ctx.org.slug} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {openFindings && openFindings.rows.length > 0 ? (
            <Card className="mt-4 p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="mb-0">{th('leaksTitle')}</CardTitle>
                <Link
                  href={`${base}/leaks`}
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                >
                  {th('seeAllLeaks')}
                </Link>
              </div>
              <ul className="space-y-2">
                {openFindings.rows.map((f) => (
                  <li
                    key={f.id}
                    className="glass-tile flex flex-wrap items-center justify-between gap-2 rounded-input p-3"
                  >
                    <span className="text-sm">
                      {th(`findingType.${f.type.replace('.', '_')}`)}
                      {f.subject.staff_name || f.subject.channel_name
                        ? ` · ${String(f.subject.staff_name ?? f.subject.channel_name)}`
                        : ''}
                      {f.branch_id ? ` · ${branchName(f.branch_id)}` : ''}
                    </span>
                    <span className="font-bold tabular-nums">{money(f.impact_poisha)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </section>
      ) : null}

      {habitBranches.length > 0 && today ? (
        <Card className="mb-8 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="mb-0">{th('habitsTitle')}</CardTitle>
            <Link
              href={`${base}/stock`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              {th('openStock')}
            </Link>
          </div>
          <p className="-mt-1 mb-3 text-sm text-secondary">{th('habitsBody')}</p>
          <ul className="space-y-2">
            {habitBranches.map((b) => {
              const now_ = habits.find((h) => h.branch_id === b && h.business_date === today.date);
              const prev = habits.find((h) => h.branch_id === b && h.business_date !== today.date);
              const missing = now_?.open_day
                ? (
                    [
                      ['bazar', now_.bazar === 0],
                      ['waste', now_.waste === 0],
                      ['count', now_.count === 0],
                      ['coverage', now_.coverage === 0],
                    ] as const
                  )
                    .filter(([, m]) => m)
                    .map(([k]) => k)
                : [];
              return (
                <li
                  key={b}
                  className="glass-tile flex flex-wrap items-center justify-between gap-2 rounded-input p-3"
                >
                  <div>
                    <p className="font-semibold">{branchName(b)}</p>
                    <p className="text-xs text-secondary">
                      {prev?.score !== null && prev?.score !== undefined
                        ? th('habitsYesterday', { score: formatNumber(prev.score, loc) })
                        : th('habitsNoYesterday')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {missing.length === 0 ? (
                      <StatusBadge tone="success">{th('habitsDone')}</StatusBadge>
                    ) : (
                      missing.map((m) => (
                        <StatusBadge key={m} tone="warning">
                          {th(`habitMissing.${m}`)}
                        </StatusBadge>
                      ))
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-medium text-secondary">{t('yourRole')}</h2>
          <p className="mt-1 text-xl font-bold" data-testid="role">
            {ctx.roles.map((r) => roles(r)).join(' · ')}
          </p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium text-secondary">{t('yourBranches')}</h2>
          <p className="mt-1 text-xl font-bold" data-testid="branches">
            {isAllBranches ? t('everyBranch') : ctx.branches.map((b) => b.name).join(' · ')}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5 text-sm text-secondary">
            {ctx.branches.map((b) => (
              <li key={b.id} className="glass-tile rounded-full px-2.5 py-0.5">
                {b.name}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {actions.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold tracking-tight">{t('quickActions')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="glass group rounded-card p-5 transition hover:border-edge-strong"
              >
                <span
                  aria-hidden
                  className="glass-tile inline-flex size-11 items-center justify-center rounded-input text-cyan transition group-hover:text-foreground [&>svg]:size-5"
                >
                  {a.icon}
                </span>
                <p className="mt-4 font-bold">{a.title}</p>
                <p className="mt-1 text-sm text-secondary">{a.body}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {!hasAnySales ? (
        <EmptyState className="mt-8" title={t('emptyTitle')} body={t('emptyBody')} />
      ) : null}
    </>
  );
}
