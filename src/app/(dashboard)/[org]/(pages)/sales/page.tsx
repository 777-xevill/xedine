import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { PageAgent } from '@/components/chat/page-agent';
import { BarList } from '@/components/metrics/bar-list';
import { ColumnChart } from '@/components/metrics/column-chart';
import { daySeries, hour12, hourPeriod, hourSeries, peakKey } from '@/components/metrics/series';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState, Label, PageTitle, Select, Stat } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { aiConfigured } from '@/lib/llm-gateway';
import {
  formatBDT,
  formatDhakaDate,
  formatDhakaDay,
  formatDhakaDayMonth,
  formatNumber,
  type Locale,
} from '@/lib/i18n/format';
import { DEFAULT_CUTOFF_MINUTES } from '@/lib/time/business-date';
import {
  itemVelocity,
  sales,
  salesSplit,
  WINDOWS,
  type VelocityWindow,
} from '@/modules/metrics/queries';
import { getOrgContext } from '@/modules/tenancy/context';

const asDate = (d: string) => new Date(`${d}T06:00:00Z`);
const UUID = /^[0-9a-f-]{36}$/;
const METHODS = ['cash', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'bank'];
const TOP_ITEMS = 10;

function ChartCard({
  title,
  body,
  className,
  children,
}: {
  title: string;
  body: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={className ? `p-5 ${className}` : 'p-5'}>
      <CardTitle className="mb-1">{title}</CardTitle>
      <p className="mb-4 text-sm text-secondary">{body}</p>
      {children}
    </Card>
  );
}

/** M4 Item velocity & sales explorer: "how many kebabs in the last 2 hours / today / this week…". */
export default async function SalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ window?: string; channel?: string; daypart?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const allowed = ['owner', 'accountant', 'manager'] as const;
  if (!ctx.roles.some((r) => (allowed as readonly string[]).includes(r))) notFound();

  const [t, tp, locale] = await Promise.all([
    getTranslations('sales'),
    getTranslations('pos.methods'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const money = (p: number) => formatBDT(p, loc, { poisha: 'never' });
  const window: VelocityWindow = (WINDOWS as readonly string[]).includes(sp.window ?? '')
    ? (sp.window as VelocityWindow)
    : 'today';
  const channelId = sp.channel && UUID.test(sp.channel) ? sp.channel : null;
  const supabase = await createClient();
  const [{ data: channels }, { data: settings }, { data: menu }] = await Promise.all([
    supabase.from('channels').select('id, name').eq('org_id', ctx.org.id).order('name'),
    supabase
      .from('org_settings')
      .select('dayparts, default_cutoff_minutes')
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
    supabase.from('menu_items').select('id, name').eq('org_id', ctx.org.id).eq('is_active', true),
  ]);
  // A restaurant that never sold takeaway/delivery should not see channel options: list only the
  // channels that have at least one order, and show the filter only when there is a real choice.
  const used = await Promise.all(
    (channels ?? []).map(async (c) => {
      const { data } = await supabase
        .from('orders')
        .select('id')
        .eq('org_id', ctx.org.id)
        .eq('channel_id', c.id)
        .limit(1);
      return (data?.length ?? 0) > 0 || c.id === channelId;
    }),
  );
  const activeChannels = (channels ?? []).filter((_, i) => used[i]);
  const showChannels = activeChannels.length > 1 || channelId !== null;
  const dayparts = ((settings?.dayparts as { key: string }[] | null) ?? []).map((d) => d.key);
  const daypart = sp.daypart && dayparts.includes(sp.daypart) ? sp.daypart : null;
  const cutoff = settings?.default_cutoff_minutes ?? DEFAULT_CUTOFF_MINUTES;
  const scope = ctx.selectedBranchId;

  const items = await itemVelocity(ctx.org.id, scope, window, { channelId, daypart });
  const from = items.from;
  const to = items.to;
  // Totals and splits are business-date metrics; last_2h is a rolling window of items only, and a
  // channel or time-of-day filter narrows the items list alone.
  const dated = window !== 'last_2h' && from && to;
  const splits = dated && !channelId && !daypart;
  const days = splits && from !== to ? daySeries(from, to) : [];
  const [summary, byDaypart, byHour, byChannel, byPayment, daily] = splits
    ? await Promise.all([
        sales(ctx.org.id, scope, from, to),
        salesSplit(ctx.org.id, scope, from, to, 'daypart'),
        salesSplit(ctx.org.id, scope, from, to, 'hour'),
        salesSplit(ctx.org.id, scope, from, to, 'channel'),
        salesSplit(ctx.org.id, scope, from, to, 'payment_method'),
        Promise.all(days.map((d) => sales(ctx.org.id, scope, d, d))),
      ])
    : [null, null, null, null, null, []];
  const total = summary?.rows.find((r) => r.branch_id === null) ?? null;
  const sold = new Set(items.rows.map((i) => i.menu_item_id));
  const notSold = (menu ?? [])
    .filter((m) => !sold.has(m.id))
    .map((m) => m.name)
    .sort();

  const clock = (h: number) => t(`clock.${hourPeriod(h)}`, { hour: formatNumber(hour12(h), loc) });
  const hours = byHour ? hourSeries(byHour.rows, cutoff) : [];
  const busiestHour = peakKey(
    hours,
    (h) => h.net_poisha,
    (h) => String(h.hour),
  );
  const dayPoints = days.map((d, i) => ({
    date: d,
    net: daily[i]?.rows.find((r) => r.branch_id === null)?.net_poisha ?? 0,
  }));
  const bestDay = peakKey(
    dayPoints,
    (d) => d.net,
    (d) => d.date,
  );
  const branchRows =
    scope === null
      ? (summary?.rows ?? [])
          .filter((r) => r.branch_id !== null && r.net_poisha > 0)
          .sort((a, b) => b.net_poisha - a.net_poisha)
      : [];
  const branchName = (id: string | null) => ctx.branches.find((b) => b.id === id)?.name ?? '';
  const selectedBranch = scope === null ? null : branchName(scope) || null;
  const period = t(`agent.period.${window}`);
  const ordersHint = (n: number) => t('charts.ordersHint', { count: n, n: formatNumber(n, loc) });

  const itemBars = items.rows.map((i) => ({
    key: i.menu_item_id ?? i.name,
    label: i.name,
    value: i.qty,
    display: t('charts.sold', { n: formatNumber(i.qty, loc) }),
    hint: money(i.net_poisha),
  }));

  const href = (w: string) => {
    const q = new URLSearchParams({ window: w });
    if (channelId) q.set('channel', channelId);
    if (daypart) q.set('daypart', daypart);
    return `/${ctx.org.slug}/sales?${q.toString()}`;
  };

  const timeCharts = [
    dayPoints.length > 1 ? (
      <ChartCard key="days" title={t('charts.byDay')} body={t('charts.byDayBody')}>
        {bestDay ? (
          <p className="text-sm font-medium text-foreground">
            {t('charts.bestDay', {
              day: formatDhakaDay(asDate(bestDay), loc),
              amount: money(dayPoints.find((d) => d.date === bestDay)?.net ?? 0),
            })}
          </p>
        ) : null}
        <ColumnChart
          label={t('charts.byDay')}
          peak={bestDay}
          items={dayPoints.map((d) => ({
            key: d.date,
            axisLabel: formatDhakaDayMonth(asDate(d.date), loc),
            label: formatDhakaDay(asDate(d.date), loc),
            value: d.net,
            display: money(d.net),
          }))}
        />
      </ChartCard>
    ) : null,
    hours.length > 0 ? (
      <ChartCard key="hours" title={t('charts.hours')} body={t('charts.hoursBody')}>
        {busiestHour !== null ? (
          <p className="text-sm font-medium text-foreground">
            {t('charts.busiest', {
              hour: clock(Number(busiestHour)),
              amount: money(hours.find((h) => String(h.hour) === busiestHour)?.net_poisha ?? 0),
            })}
          </p>
        ) : null}
        <ColumnChart
          label={t('charts.hours')}
          peak={busiestHour}
          items={hours.map((h) => ({
            key: String(h.hour),
            axisLabel: clock(h.hour),
            label: clock(h.hour),
            value: h.net_poisha,
            display: money(h.net_poisha),
          }))}
        />
      </ChartCard>
    ) : null,
  ].filter(Boolean);

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <PillNav
        label={t('window')}
        className="mb-4"
        items={WINDOWS.map((w) => ({
          href: href(w),
          label: t(`windows.${w}`),
          active: w === window,
        }))}
      />
      <form method="get" className="glass mb-6 flex flex-wrap items-end gap-3 rounded-card p-4">
        <input type="hidden" name="window" value={window} />
        {showChannels ? (
          <div>
            <Label htmlFor="channel">{t('channel')}</Label>
            <Select id="channel" name="channel" defaultValue={channelId ?? ''}>
              <option value="">{t('allChannels')}</option>
              {activeChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div>
          <Label htmlFor="daypart">{t('daypart')}</Label>
          <Select id="daypart" name="daypart" defaultValue={daypart ?? ''}>
            <option value="">{t('allDayparts')}</option>
            {dayparts.map((d) => (
              <option key={d} value={d}>
                {t(`dayparts.${d}`)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          {t('apply')}
        </Button>
        {from && to ? (
          <p className="ms-auto text-sm text-secondary">
            {from === to
              ? formatDhakaDate(asDate(from), loc)
              : t('range', {
                  from: formatDhakaDate(asDate(from), loc),
                  to: formatDhakaDate(asDate(to), loc),
                })}
          </p>
        ) : null}
      </form>

      {total ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat label={t('netSales')} value={money(total.net_poisha)} />
          <Stat label={t('orders')} value={formatNumber(total.orders_completed, loc)} />
          <Stat
            label={t('aov')}
            value={total.aov_poisha === null ? '—' : money(total.aov_poisha)}
          />
        </div>
      ) : null}

      {timeCharts.length > 0 ? (
        <div className="mb-4">
          <div className={timeCharts.length > 1 ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'}>
            {timeCharts}
          </div>
          <p className="mt-2 text-xs text-muted">{t('charts.tapHint')}</p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ChartCard title={t('itemsTitle')} body={t('charts.itemsBody')} className="self-start">
          {itemBars.length === 0 ? (
            <EmptyState title={t('noSales')} />
          ) : (
            <>
              <BarList label={t('itemsTitle')} items={itemBars.slice(0, TOP_ITEMS)} />
              {itemBars.length > TOP_ITEMS ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-purple">
                    {t('charts.showAll', { n: formatNumber(itemBars.length, loc) })}
                  </summary>
                  <BarList
                    className="mt-3"
                    label={t('itemsTitle')}
                    items={itemBars.slice(TOP_ITEMS)}
                  />
                </details>
              ) : null}
            </>
          )}
        </ChartCard>

        <div className="space-y-4">
          {byDaypart && byDaypart.rows.length > 0 ? (
            <ChartCard title={t('byDaypart')} body={t('charts.daypartBody')}>
              <BarList
                label={t('byDaypart')}
                items={byDaypart.rows.map((r) => ({
                  key: r.key,
                  label: t(`dayparts.${r.key}`),
                  value: r.net_poisha,
                  display: money(r.net_poisha),
                  hint: ordersHint(r.orders),
                }))}
              />
            </ChartCard>
          ) : null}
          {byChannel && byChannel.rows.length > 1 ? (
            <ChartCard title={t('charts.byChannel')} body={t('charts.byChannelBody')}>
              <BarList
                label={t('charts.byChannel')}
                items={byChannel.rows.map((r) => ({
                  key: `${r.key}:${r.label}`,
                  label: r.label,
                  value: r.net_poisha,
                  display: money(r.net_poisha),
                  hint: ordersHint(r.orders),
                }))}
              />
            </ChartCard>
          ) : null}
          {byPayment && byPayment.rows.length > 0 ? (
            <ChartCard title={t('charts.byPayment')} body={t('charts.byPaymentBody')}>
              <BarList
                label={t('charts.byPayment')}
                items={byPayment.rows.map((r) => ({
                  key: r.key,
                  label: METHODS.includes(r.key) ? tp(r.key) : r.label,
                  value: r.net_poisha,
                  display: money(r.net_poisha),
                  hint: ordersHint(r.orders),
                }))}
              />
            </ChartCard>
          ) : null}
          {branchRows.length > 1 ? (
            <ChartCard title={t('charts.byBranch')} body={t('charts.byBranchBody')}>
              <BarList
                label={t('charts.byBranch')}
                items={branchRows.map((r) => ({
                  key: r.branch_id ?? '',
                  label: branchName(r.branch_id),
                  value: r.net_poisha,
                  display: money(r.net_poisha),
                  hint: ordersHint(r.orders_completed),
                }))}
              />
            </ChartCard>
          ) : null}
          {notSold.length > 0 ? (
            <Card className="p-5">
              <CardTitle>{t('notSold')}</CardTitle>
              <ul className="flex flex-wrap gap-1.5 text-sm">
                {notSold.map((name) => (
                  <li key={name} className="glass-tile rounded-full px-2.5 py-0.5 text-secondary">
                    {name}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
      {/* Room under the last card so the helper button never covers it. */}
      <div aria-hidden className="h-20" />
      <PageAgent
        key={`${window}:${scope ?? 'all'}`}
        orgId={ctx.org.id}
        orgSlug={ctx.org.slug}
        aiOn={aiConfigured()}
        summaryQuestion={
          selectedBranch
            ? t('agent.summaryBranch', { period, branch: selectedBranch })
            : t('agent.summary', { period })
        }
        followUps={[
          t('agent.leastSold', { period }),
          t('agent.channels', { period }),
          ...(scope === null && ctx.branches.length > 1 ? [t('agent.branches', { period })] : []),
          t('agent.push'),
        ]}
      />
    </>
  );
}
