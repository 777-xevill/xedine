import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { BarList } from '@/components/metrics/bar-list';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState, Label, PageTitle, Select, Stat } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, formatDhakaDate, formatNumber, type Locale } from '@/lib/i18n/format';
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

  const [t, locale] = await Promise.all([getTranslations('sales'), getLocale()]);
  const loc = locale as Locale;
  const money = (p: number) => formatBDT(p, loc, { poisha: 'never' });
  const window: VelocityWindow = (WINDOWS as readonly string[]).includes(sp.window ?? '')
    ? (sp.window as VelocityWindow)
    : 'today';
  const channelId = sp.channel && UUID.test(sp.channel) ? sp.channel : null;
  const supabase = await createClient();
  const [{ data: channels }, { data: settings }, { data: menu }] = await Promise.all([
    supabase.from('channels').select('id, name').eq('org_id', ctx.org.id).order('name'),
    supabase.from('org_settings').select('dayparts').eq('org_id', ctx.org.id).maybeSingle(),
    supabase.from('menu_items').select('id, name').eq('org_id', ctx.org.id).eq('is_active', true),
  ]);
  const dayparts = ((settings?.dayparts as { key: string }[] | null) ?? []).map((d) => d.key);
  const daypart = sp.daypart && dayparts.includes(sp.daypart) ? sp.daypart : null;
  const scope = ctx.selectedBranchId;

  const items = await itemVelocity(ctx.org.id, scope, window, { channelId, daypart });
  const from = items.from;
  const to = items.to;
  // Totals, dayparts and hours are business-date metrics; last_2h is a rolling window of items only.
  const dated = window !== 'last_2h' && from && to;
  const [summary, byDaypart, byHour] = dated
    ? await Promise.all([
        sales(ctx.org.id, scope, from, to),
        salesSplit(ctx.org.id, scope, from, to, 'daypart'),
        salesSplit(ctx.org.id, scope, from, to, 'hour'),
      ])
    : [null, null, null];
  const total = summary?.rows.find((r) => r.branch_id === null) ?? null;
  const sold = new Set(items.rows.map((i) => i.menu_item_id));
  const notSold = (menu ?? [])
    .filter((m) => !sold.has(m.id))
    .map((m) => m.name)
    .sort();

  const href = (w: string) => {
    const q = new URLSearchParams({ window: w });
    if (channelId) q.set('channel', channelId);
    if (daypart) q.set('daypart', daypart);
    return `/${ctx.org.slug}/sales?${q.toString()}`;
  };

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
        <div>
          <Label htmlFor="channel">{t('channel')}</Label>
          <Select id="channel" name="channel" defaultValue={channelId ?? ''}>
            <option value="">{t('allChannels')}</option>
            {(channels ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
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

      {total && !channelId && !daypart ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat label={t('netSales')} value={money(total.net_poisha)} />
          <Stat label={t('orders')} value={formatNumber(total.orders_completed, loc)} />
          <Stat
            label={t('aov')}
            value={total.aov_poisha === null ? '—' : money(total.aov_poisha)}
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="overflow-x-auto p-0">
          <h2 className="px-5 pt-5 text-lg font-bold">{t('itemsTitle')}</h2>
          {items.rows.length === 0 ? (
            <EmptyState className="m-5" title={t('noSales')} />
          ) : (
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">{t('itemsTitle')}</caption>
              <thead>
                <tr className="border-b border-line text-xs tracking-wide text-secondary uppercase">
                  <th scope="col" className="px-5 py-2 text-start">
                    {t('col.item')}
                  </th>
                  <th scope="col" className="px-5 py-2 text-end">
                    {t('col.qty')}
                  </th>
                  <th scope="col" className="px-5 py-2 text-end">
                    {t('col.net')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.rows.map((i) => (
                  <tr
                    key={i.menu_item_id ?? i.name}
                    className="border-b border-line/60 last:border-0"
                  >
                    <td className="px-5 py-2.5">{i.name}</td>
                    <td className="px-5 py-2.5 text-end font-semibold tabular-nums">
                      {formatNumber(i.qty, loc)}
                    </td>
                    <td className="px-5 py-2.5 text-end tabular-nums">{money(i.net_poisha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="space-y-4">
          {byDaypart && byDaypart.rows.length > 0 && !daypart && !channelId ? (
            <Card className="p-5">
              <CardTitle>{t('byDaypart')}</CardTitle>
              <BarList
                label={t('byDaypart')}
                items={byDaypart.rows.map((r) => ({
                  key: r.key,
                  label: t(`dayparts.${r.key}`),
                  value: r.net_poisha,
                  display: money(r.net_poisha),
                }))}
              />
            </Card>
          ) : null}
          {byHour && byHour.rows.length > 0 && !daypart && !channelId ? (
            <Card className="p-5">
              <CardTitle>{t('byHour')}</CardTitle>
              <BarList
                label={t('byHour')}
                items={byHour.rows.map((r) => ({
                  key: r.key,
                  label: t('hour', { hour: formatNumber(Number(r.key), loc) }),
                  value: r.net_poisha,
                  display: money(r.net_poisha),
                }))}
              />
            </Card>
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
    </>
  );
}
