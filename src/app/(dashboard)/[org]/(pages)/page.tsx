import {
  ArrowRight,
  ClipboardList,
  Droplet,
  MonitorSmartphone,
  Package,
  PartyPopper,
  UtensilsCrossed,
} from 'lucide-react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { AskBox } from '@/components/chat/chat-view';
import { BarList } from '@/components/metrics/bar-list';
import { StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/form';
import {
  formatBDT,
  formatBps,
  formatDhakaDate,
  formatNumber,
  type Locale,
} from '@/lib/i18n/format';
import { addDays } from '@/lib/time/business-date';
import { cn } from '@/lib/utils';
import {
  discipline,
  stockStatus,
  type CoverBand,
  type StockRow,
} from '@/modules/inventory/queries';
import {
  businessToday,
  findings,
  flashPnl,
  itemVelocity,
  pace,
  sales,
  type PaceRow,
} from '@/modules/metrics/queries';
import { getOrgContext } from '@/modules/tenancy/context';

const RAG_TONE = { green: 'success', amber: 'warning', red: 'danger', none: 'neutral' } as const;
const BAND_TONE: Record<CoverBand, 'success' | 'warning' | 'danger' | 'neutral'> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
  none: 'neutral',
};
const RAG_ORDER = { red: 0, amber: 1, green: 2, none: 3 } as const;

/**
 * Home (ADR 0024): answers "How is my restaurant doing?" and "What needs attention?" in one screen.
 * Every figure comes from a metric function (CLAUDE.md #1); this page only picks and formats.
 */
export default async function HomePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const [ctx, t, th, ts, locale] = await Promise.all([
    getOrgContext(org),
    getTranslations('dashboard'),
    getTranslations('health'),
    getTranslations('stock'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const money = (p: number) => formatBDT(p, loc, { poisha: 'never' });
  const has = (r: (typeof ctx.roles)[number]) => ctx.roles.includes(r);
  const canSeeMoney = has('owner') || has('accountant');
  const seesSales = canSeeMoney || has('manager');
  const seesStock = (['owner', 'manager', 'kitchen', 'purchaser', 'accountant'] as const).some(has);
  const canChat = seesSales;
  const base = `/${ctx.org.slug}`;
  const scope = ctx.selectedBranchId;
  const multiBranch = ctx.branches.length > 1 && scope === null;
  const branchName = (id: string | null) => ctx.branches.find((b) => b.id === id)?.name ?? '';
  const ingredient = (r: StockRow) => (loc === 'bn' && r.name_bn ? r.name_bn : r.name);

  const today = ctx.branches.length > 0 ? await businessToday(ctx.org.id) : null;
  const [salesToday, paceToday, topItems, pnl, openFindings, stock, habits] = today
    ? await Promise.all([
        seesSales ? sales(ctx.org.id, scope, today.date, today.date) : null,
        seesSales ? pace(ctx.org.id, scope) : null,
        seesSales ? itemVelocity(ctx.org.id, scope, 'today') : null,
        canSeeMoney ? flashPnl(ctx.org.id, scope).catch(() => null) : null,
        canSeeMoney ? findings(ctx.org.id, { limit: 3 }).catch(() => null) : null,
        seesStock ? stockStatus(ctx.org.id, scope).catch(() => []) : [],
        ctx.isOwner || has('manager')
          ? discipline(ctx.org.id, scope, addDays(today.date, -1), today.date).catch(() => [])
          : [],
      ])
    : [null, null, null, null, null, [], []];

  const totalRow =
    salesToday?.rows.find((r) => r.branch_id === null) ??
    (salesToday?.rows.length === 1 ? salesToday.rows[0] : undefined);
  const branchRows = (salesToday?.rows ?? []).filter((r) => r.branch_id !== null);
  const paceRows = paceToday?.rows ?? [];
  const paceBy = new Map(paceRows.map((p) => [p.branch_id, p]));
  // The headline status: the selected branch's pace, or the branch that is furthest behind.
  const headlinePace: PaceRow | undefined = [...paceRows].sort(
    (a, b) => RAG_ORDER[a.rag] - RAG_ORDER[b.rag],
  )[0];
  const pnlTotal = (pnl?.rows ?? []).find((p) => p.branch_id === scope) ?? pnl?.rows[0];
  const hasAnySales =
    (totalRow?.orders_completed ?? 0) > 0 || paceRows.some((p) => p.typical_net_poisha);

  // "What needs attention", most urgent first: stock running out, money leaks, missing habits.
  const low = stock
    .filter((r) => r.band === 'red' || r.band === 'yellow')
    .sort((a, b) => (a.days_of_cover ?? Infinity) - (b.days_of_cover ?? Infinity));
  const redStock = low.filter((r) => r.band === 'red');
  const todayHabits = today
    ? habits.filter((h) => h.business_date === today.date && h.open_day)
    : [];
  const missingHabits = todayHabits.flatMap((h) =>
    (['bazar', 'waste', 'count'] as const)
      .filter((k) => h[k] === 0)
      .map((k) => ({ branch: h.branch_id, key: k })),
  );
  const leakRows = openFindings?.rows ?? [];
  const attentionCount =
    (redStock.length > 0 ? 1 : 0) + leakRows.length + (missingHabits.length > 0 ? 1 : 0);

  const paceText = (p: PaceRow | undefined) =>
    !p || p.rag === 'none' || p.pace_bps === null
      ? th('paceNone')
      : th('paceOf', { pct: formatBps(p.pace_bps, loc) });

  const days = (r: StockRow) =>
    r.days_of_cover === null
      ? ts('noUsage')
      : ts('days', { days: formatNumber(r.days_of_cover, loc, { fractionDigits: 1 }) });

  const subtitle = today
    ? th('subtitle', { date: formatDhakaDate(new Date(`${today.date}T06:00:00Z`), loc) })
    : t('subtitle');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
            {t('welcome', { name: ctx.fullName })}
          </h1>
          <p className="mt-1.5 text-secondary">{subtitle}</p>
        </div>
        {today && hasAnySales ? (
          <StatusBadge
            tone={attentionCount > 0 ? 'warning' : 'success'}
            className="min-h-8 px-3 text-sm"
          >
            {attentionCount > 0 ? t('attentionCount', { count: attentionCount }) : t('allClear')}
          </StatusBadge>
        ) : null}
      </header>

      {canChat ? (
        <div className="max-w-3xl">
          <AskBox orgId={ctx.org.id} orgSlug={ctx.org.slug} />
        </div>
      ) : null}

      {seesSales && !hasAnySales ? (
        <GetStarted
          title={t('emptyTitle')}
          body={t('emptyBody')}
          steps={[
            ...(ctx.isOwner
              ? [
                  {
                    href: `${base}/menu`,
                    icon: <UtensilsCrossed />,
                    title: t('actionMenu'),
                    body: t('actionMenuBody'),
                  },
                ]
              : []),
            ...(ctx.isOwner || has('manager')
              ? [
                  {
                    href: '/pos',
                    icon: <MonitorSmartphone />,
                    title: t('actionPos'),
                    body: t('actionPosBody'),
                  },
                ]
              : []),
            ...(ctx.isOwner
              ? [
                  {
                    href: `${base}/setup`,
                    icon: <ClipboardList />,
                    title: t('actionSetup'),
                    body: t('actionSetupBody'),
                  },
                ]
              : []),
          ]}
        />
      ) : null}

      {today && hasAnySales && totalRow ? (
        <section aria-labelledby="today-heading">
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="today-heading" className="text-base font-semibold">
                  {t('howDoing')}
                </h2>
                <p className="mt-0.5 text-sm text-secondary">{paceText(headlinePace)}</p>
              </div>
              <StatusBadge tone={RAG_TONE[headlinePace?.rag ?? 'none']}>
                {th(`rag.${headlinePace?.rag ?? 'none'}`)}
              </StatusBadge>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Figure label={th('netSales')} value={money(totalRow.net_poisha)} strong />
              <Figure label={th('orders')} value={formatNumber(totalRow.orders_completed, loc)} />
              <Figure
                label={th('aov')}
                value={totalRow.aov_poisha === null ? '—' : money(totalRow.aov_poisha)}
              />
              {canSeeMoney && pnlTotal ? (
                <Figure
                  label={t('estimatedProfit')}
                  value={money(pnlTotal.estimated_profit_poisha)}
                  tone={pnlTotal.estimated_profit_poisha < 0 ? 'danger' : undefined}
                />
              ) : (
                <Figure
                  label={th('covers')}
                  value={totalRow.covers_orders > 0 ? formatNumber(totalRow.covers, loc) : '—'}
                />
              )}
            </dl>

            {canSeeMoney && pnlTotal ? (
              <p className="mt-4 text-sm text-secondary">
                {pnlTotal.breakeven_remaining_poisha > 0 ? (
                  th('breakevenRemaining', { amount: money(pnlTotal.breakeven_remaining_poisha) })
                ) : (
                  <span className="font-medium text-success">{th('breakevenReached')}</span>
                )}
                <span className="text-muted">
                  {' · '}
                  {pnlTotal.cogs_basis === 'recipes'
                    ? th('recipeCogs')
                    : pnlTotal.cogs_basis === 'mixed'
                      ? th('mixedCogs', { pct: formatBps(pnlTotal.assumed_food_cost_bps, loc) })
                      : th('assumedCogs', { pct: formatBps(pnlTotal.assumed_food_cost_bps, loc) })}
                </span>
              </p>
            ) : null}

            {multiBranch && branchRows.length > 1 ? (
              <ul className="mt-5 divide-y divide-line border-t border-line">
                {branchRows.map((r) => {
                  const p = paceBy.get(r.branch_id!);
                  return (
                    <li
                      key={r.branch_id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
                    >
                      <span className="font-medium">{branchName(r.branch_id)}</span>
                      <span className="flex items-center gap-3 text-sm">
                        <span className="font-semibold tabular-nums">{money(r.net_poisha)}</span>
                        <span className="text-secondary tabular-nums">
                          {th('ordersCount', { count: r.orders_completed })}
                        </span>
                        <StatusBadge tone={RAG_TONE[p?.rag ?? 'none']}>
                          {th(`rag.${p?.rag ?? 'none'}`)}
                        </StatusBadge>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Card>
        </section>
      ) : null}

      {today && (hasAnySales || stock.length > 0) ? (
        <div className="grid gap-6 lg:grid-cols-5">
          <section aria-labelledby="attention-heading" className="lg:col-span-3">
            <Card className="h-full p-5 sm:p-6">
              <h2 id="attention-heading" className="text-base font-semibold">
                {t('needsAttention')}
              </h2>
              {attentionCount === 0 ? (
                <div className="mt-6 flex flex-col items-center py-6 text-center">
                  <span className="inline-flex size-11 items-center justify-center rounded-full bg-success/10 text-success">
                    <PartyPopper aria-hidden className="size-5" />
                  </span>
                  <p className="mt-3 font-medium">{t('allClear')}</p>
                  <p className="mt-1 max-w-xs text-sm text-secondary">{t('allClearBody')}</p>
                </div>
              ) : (
                <ul className="mt-4 space-y-2">
                  {redStock.length > 0 ? (
                    <AttentionRow
                      href={`${base}/stock`}
                      icon={<Package />}
                      tone="danger"
                      title={t('stockRunningOut', { count: redStock.length })}
                      body={redStock
                        .slice(0, 3)
                        .map((r) => ingredient(r))
                        .join(', ')}
                    />
                  ) : null}
                  {leakRows.map((f) => (
                    <AttentionRow
                      key={f.id}
                      href={`${base}/leaks/${f.id}`}
                      icon={<Droplet />}
                      tone="warning"
                      title={th(`findingType.${f.type.replace('.', '_')}`)}
                      body={[
                        f.subject.staff_name ?? f.subject.item_name ?? f.subject.channel_name,
                        f.branch_id ? branchName(f.branch_id) : null,
                      ]
                        .filter((v) => typeof v === 'string' && v)
                        .join(' · ')}
                      figure={money(f.impact_poisha)}
                    />
                  ))}
                  {missingHabits.length > 0 ? (
                    <AttentionRow
                      href={`${base}/stock`}
                      icon={<ClipboardList />}
                      tone="warning"
                      title={th('habitsTitle')}
                      body={[
                        ...new Set(missingHabits.map((m) => th(`habitMissing.${m.key}`))),
                      ].join(' · ')}
                    />
                  ) : null}
                </ul>
              )}
            </Card>
          </section>

          <section aria-labelledby="stock-heading" className="lg:col-span-2">
            <Card className="h-full p-5 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 id="stock-heading" className="text-base font-semibold">
                  {t('stockWatch')}
                </h2>
                {seesStock ? (
                  <Link
                    href={`${base}/stock`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-purple hover:underline"
                  >
                    {th('openStock')}
                    <ArrowRight aria-hidden className="size-3.5 rtl:rotate-180" />
                  </Link>
                ) : null}
              </div>
              {stock.length === 0 ? (
                <p className="mt-4 text-sm text-secondary">{t('stockEmpty')}</p>
              ) : low.length === 0 ? (
                <p className="mt-4 text-sm text-secondary">{t('stockHealthy')}</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {low.slice(0, 6).map((r) => (
                    <li
                      key={`${r.branch_id}:${r.ingredient_id}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{ingredient(r)}</span>
                        {multiBranch ? (
                          <span className="block truncate text-xs text-secondary">
                            {branchName(r.branch_id)}
                          </span>
                        ) : null}
                      </span>
                      <StatusBadge tone={BAND_TONE[r.band]}>{days(r)}</StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
              {low.length > 6 ? (
                <p className="mt-2 text-xs text-secondary">
                  {t('stockMore', { count: low.length - 6 })}
                </p>
              ) : null}
            </Card>
          </section>
        </div>
      ) : null}

      {today && hasAnySales && (topItems?.rows ?? []).length > 0 ? (
        <section aria-labelledby="top-heading">
          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 id="top-heading" className="text-base font-semibold">
                {th('topItems')}
              </h2>
              <Link
                href={`${base}/sales`}
                className="inline-flex items-center gap-1 text-sm font-medium text-purple hover:underline"
              >
                {th('openExplorer')}
                <ArrowRight aria-hidden className="size-3.5 rtl:rotate-180" />
              </Link>
            </div>
            <BarList
              label={th('topItems')}
              items={(topItems?.rows ?? []).slice(0, 5).map((i) => ({
                key: i.menu_item_id ?? i.name,
                label: i.name,
                value: i.qty,
                display: formatNumber(i.qty, loc),
              }))}
            />
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'danger';
}) {
  return (
    <div className="rounded-input bg-surface-elevated px-4 py-3">
      <dt className="text-xs font-medium text-secondary">{label}</dt>
      <dd
        className={cn(
          'mt-1 font-semibold tabular-nums',
          strong ? 'text-2xl' : 'text-xl',
          tone === 'danger' ? 'text-danger' : 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function AttentionRow({
  href,
  icon,
  tone,
  title,
  body,
  figure,
}: {
  href: string;
  icon: React.ReactNode;
  tone: 'danger' | 'warning';
  title: string;
  body?: string;
  figure?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 rounded-input border border-line px-3.5 py-3 transition hover:border-line-strong hover:bg-surface-elevated"
      >
        <span
          aria-hidden
          className={cn(
            'inline-flex size-9 shrink-0 items-center justify-center rounded-full [&>svg]:size-4',
            tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning/12 text-warning',
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          {body ? <span className="block truncate text-xs text-secondary">{body}</span> : null}
        </span>
        {figure ? (
          <span className="shrink-0 text-sm font-semibold tabular-nums">{figure}</span>
        ) : null}
        <ArrowRight
          aria-hidden
          className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 rtl:rotate-180"
        />
      </Link>
    </li>
  );
}

function GetStarted({
  title,
  body,
  steps,
}: {
  title: string;
  body: string;
  steps: { href: string; icon: React.ReactNode; title: string; body: string }[];
}) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-secondary">{body}</p>
      {steps.length > 0 ? (
        <ul className="mt-5 grid gap-3 sm:grid-cols-3">
          {steps.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="group flex h-full flex-col rounded-input border border-line p-4 transition hover:border-purple/40 hover:shadow-soft"
              >
                <span
                  aria-hidden
                  className="inline-flex size-9 items-center justify-center rounded-lg bg-purple/10 text-purple [&>svg]:size-4"
                >
                  {s.icon}
                </span>
                <span className="mt-3 text-sm font-semibold">{s.title}</span>
                <span className="mt-0.5 text-xs text-secondary">{s.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
