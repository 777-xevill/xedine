import {
  CalendarDays,
  ChefHat,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  MapPin,
  ShoppingBasket,
  Sun,
  Thermometer,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { UnitField } from '@/components/unit-field';
import { StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert, Card, CardTitle, EmptyState, Hint, Input, PageTitle } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import {
  formatBps,
  formatDhakaDay,
  formatDhakaTime,
  formatNumber,
  type Locale,
} from '@/lib/i18n/format';
import { addDays } from '@/lib/time/business-date';
import {
  approveBazarAction,
  flagDayAction,
  generateBazarAction,
  reconcileBazarAction,
  sendBazarAction,
} from '@/modules/forecasting/actions';
import { branchOutlook, forecast, forecastAccuracy, prepPlan } from '@/modules/forecasting/queries';
import { formatQuantity } from '@/modules/inventory/format';
import { businessToday } from '@/modules/metrics/queries';
import { splitQuantity, type BaseUnit } from '@/modules/purchasing/lines';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';

const TABS = ['forecast', 'prep', 'bazar'] as const;
type Tab = (typeof TABS)[number];
const SKY_ICON = {
  clear: Sun,
  cloudy: Cloud,
  rain: CloudRain,
  storm: CloudLightning,
  fog: CloudFog,
} as const;
const noonDhaka = (date: string) => new Date(`${date}T06:00:00Z`);
const STATUS_TONE = {
  draft: 'neutral',
  approved: 'info',
  sent: 'warning',
  reconciled: 'success',
} as const;

/** Plan (ROADMAP Phase 7): what tomorrow will sell, what to cook, and what to buy. */
export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ tab?: string; branch?: string; date?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const has = (r: string) => ctx.roles.includes(r as never);
  if (!['owner', 'manager', 'kitchen', 'purchaser', 'accountant'].some(has)) notFound();
  const canDraft = ['owner', 'manager', 'kitchen', 'purchaser'].some(has);
  const canApprove = has('owner') || has('manager');
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as Tab)
    : 'forecast';
  const branch = pickBranch(ctx, sp.branch);
  const [t, tu, to, tk, locale] = await Promise.all([
    getTranslations('plan'),
    getTranslations('units'),
    getTranslations('outlook'),
    getTranslations('calendar'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const qty = (q: number, b: BaseUnit) => formatQuantity(q, b, loc, (u) => tu(u));
  const label = (name: string, bn: string | null) => (loc === 'bn' && bn ? bn : name);
  if (!branch) return <EmptyState title={t('noBranch')} />;
  const { date: today } = await businessToday(ctx.org.id);
  const date =
    sp.date && sp.date >= today && sp.date <= addDays(today, 7) ? sp.date : addDays(today, 1);
  const href = (over: Record<string, string>) =>
    `/${ctx.org.slug}/plan?${new URLSearchParams({ tab, branch: branch.id, date, ...over }).toString()}`;
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const outlook = await branchOutlook(ctx.org.id, branch.id, today);
  const weatherOn = new Map(outlook.days.map((d) => [d.date, d]));
  const eventsOn = (d: string) =>
    outlook.events.filter((e) => e.kind !== 'weather' && e.starts_on <= d && e.ends_on >= d);
  const rainFlagged = (d: string) =>
    outlook.events.some((e) => e.kind === 'weather' && e.starts_on <= d && e.ends_on >= d);
  const dayLabel = (d: string) =>
    d === today
      ? to('today')
      : d === addDays(today, 1)
        ? to('tomorrow')
        : formatDhakaDay(noonDhaka(d), loc);
  const n1 = (v: number) => formatNumber(v, loc, { fractionDigits: Number.isInteger(v) ? 0 : 1 });
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, i));

  return (
    <>
      <PageTitle
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Link
            href={`/${ctx.org.slug}/calendar`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <CalendarDays aria-hidden className="size-4" />
            {t('calendar')}
          </Link>
        }
      />
      {ctx.branches.length > 1 ? (
        <PillNav
          label={t('branches')}
          className="mb-3"
          items={ctx.branches.map((b) => ({
            href: href({ branch: b.id }),
            label: b.name,
            active: b.id === branch.id,
          }))}
        />
      ) : null}
      <Card className="mb-6 p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="mb-0">{to('title', { branch: branch.name })}</CardTitle>
          <p className="text-xs text-secondary">
            {outlook.updatedAt
              ? to('updated', { time: formatDhakaTime(new Date(outlook.updatedAt), loc) })
              : to('noWeather')}
          </p>
        </div>
        <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {days.map((d) => {
            const w = weatherOn.get(d);
            const Icon = w ? SKY_ICON[w.sky] : null;
            const ev = eventsOn(d);
            const active = d === date;
            return (
              <li key={d} className="min-w-[6.5rem] flex-1">
                <Link
                  href={href({ date: d })}
                  aria-current={active ? 'date' : undefined}
                  className={`flex h-full flex-col gap-1 rounded-input border p-3 text-sm transition hover:bg-surface-elevated ${
                    active ? 'border-purple ring-1 ring-purple/40' : 'border-line'
                  }`}
                >
                  <span className="font-semibold">{dayLabel(d)}</span>
                  {w && Icon ? (
                    <span className="flex items-center gap-1.5">
                      <Icon
                        aria-label={to(`sky.${w.sky}`)}
                        className={`size-5 ${w.sky === 'rain' || w.sky === 'storm' ? 'text-info' : 'text-warning'}`}
                      />
                      {w.maxC !== null ? (
                        <span className="tabular-nums">{to('maxTemp', { c: n1(w.maxC) })}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                  {w && w.rainMm >= 1 ? (
                    <span className="text-xs text-info tabular-nums">
                      {to('rainMm', { mm: n1(w.rainMm) })}
                    </span>
                  ) : null}
                  {w?.hot ? (
                    <span className="flex items-center gap-1 text-xs text-danger">
                      <Thermometer aria-hidden className="size-3.5" />
                      {to('hot')}
                    </span>
                  ) : null}
                  {ev.slice(0, 2).map((e) => (
                    <span
                      key={`${e.kind}-${e.starts_on}-${e.name}`}
                      className="truncate rounded-full bg-surface-elevated px-2 py-0.5 text-xs"
                      title={e.name}
                    >
                      {e.name || tk(`kinds.${e.kind as 'holiday'}`)}
                    </span>
                  ))}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-sm font-semibold">{to('nextHours')}</p>
          <p className={`mb-2 text-sm ${outlook.rainSoon ? 'text-info' : 'text-secondary'}`}>
            {outlook.rainSoon
              ? to('rainSoon', {
                  start: formatDhakaTime(new Date(outlook.rainSoon.start), loc),
                  end: formatDhakaTime(new Date(outlook.rainSoon.end), loc),
                  mm: n1(outlook.rainSoon.rainMm),
                })
              : outlook.hours.length > 0
                ? to('noRainSoon')
                : to('noWeather')}
          </p>
          {outlook.hours.length > 0 ? (
            <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {outlook.hours.map((h) => {
                const sky =
                  h.rainMm >= 0.5
                    ? h.symbol?.includes('thunder')
                      ? 'storm'
                      : 'rain'
                    : h.symbol?.includes('cloudy') && !h.symbol.includes('partly')
                      ? 'cloudy'
                      : h.symbol?.includes('fog')
                        ? 'fog'
                        : 'clear';
                const Icon = SKY_ICON[sky];
                return (
                  <li
                    key={h.at}
                    className="flex min-w-[3.5rem] flex-col items-center gap-0.5 rounded-input bg-surface-elevated px-2 py-1.5 text-xs"
                  >
                    <span className="text-secondary tabular-nums">
                      {formatDhakaTime(new Date(h.at), loc)}
                    </span>
                    <Icon
                      aria-label={to(`sky.${sky}`)}
                      className={`size-4 ${sky === 'rain' || sky === 'storm' ? 'text-info' : 'text-warning'}`}
                    />
                    <span className="tabular-nums">
                      {h.tempC === null ? '—' : to('maxTemp', { c: n1(Math.round(h.tempC)) })}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
          {!outlook.exactLocation ? (
            <span className="flex items-center gap-1.5">
              <MapPin aria-hidden className="size-3.5" />
              {to('approxLocation')}
              {ctx.isOwner ? (
                <Link
                  href={`/${ctx.org.slug}/branch?branch=${branch.id}`}
                  className="font-medium text-purple hover:underline"
                >
                  {to('setLocation')}
                </Link>
              ) : null}
            </span>
          ) : (
            <span />
          )}
          <span>{to('attribution')}</span>
        </div>
      </Card>

      <PillNav
        label={t('sections')}
        className="mb-6"
        items={[
          { key: 'forecast' as const, icon: <CalendarDays /> },
          { key: 'prep' as const, icon: <ChefHat /> },
          { key: 'bazar' as const, icon: <ShoppingBasket /> },
        ].map((x) => ({
          href: href({ tab: x.key }),
          label: t(`tabs.${x.key}`),
          active: x.key === tab,
          icon: x.icon,
        }))}
      />

      {canApprove ? (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="max-w-xl text-sm text-secondary">{t('flagBody')}</p>
          <div className="flex flex-wrap gap-2">
            {(['hartal', 'cricket', 'weather'] as const).map((kind) => (
              <ActionForm key={kind} action={flagDayAction} successKey="plan.flagged">
                {hidden}
                <input
                  type="hidden"
                  name="date"
                  value={date === addDays(today, 1) ? date : today}
                />
                <input type="hidden" name="kind" value={kind} />
                <Button type="submit" size="sm" variant="secondary">
                  {t(`flag.${kind}`)}
                </Button>
              </ActionForm>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === 'forecast'
        ? await (async () => {
            const [rows, acc] = await Promise.all([
              forecast(ctx.org.id, branch.id, date),
              forecastAccuracy(ctx.org.id, branch.id).catch(() => []),
            ]);
            const a = acc.find((x) => x.branch_id === branch.id);
            const parts = [...new Set(rows.map((r) => r.daypart))];
            const items = [...new Map(rows.map((r) => [r.menu_item_id, r])).values()];
            const cell = (item: string, part: string) =>
              rows.find((r) => r.menu_item_id === item && r.daypart === part)?.qty ?? 0;
            const total = (item: string) =>
              rows.filter((r) => r.menu_item_id === item).reduce((s, r) => s + r.qty, 0);
            items.sort((x, y) => total(y.menu_item_id) - total(x.menu_item_id));
            const fmt = (v: number) =>
              formatNumber(Math.round(v * 10) / 10, loc, {
                fractionDigits: Number.isInteger(Math.round(v * 10) / 10) ? 0 : 1,
              });
            const grand = items.reduce((sum, i) => sum + total(i.menu_item_id), 0);
            const naive = rows.reduce((sum, r) => sum + r.naive_qty, 0);
            const reasons = [
              ...eventsOn(date).map((e) => e.name || tk(`kinds.${e.kind as 'holiday'}`)),
              ...(rainFlagged(date) ? [tk('kinds.weather')] : []),
              ...(Number(date.slice(8, 10)) <= 7 ? [t('salaryWeek')] : []),
            ];
            const w = weatherOn.get(date);
            return (
              <Card className="p-4 sm:p-6">
                {items.length === 0 ? (
                  <EmptyState title={t('noForecast')} body={t('noForecastBody')} />
                ) : (
                  <>
                    <h2 className="text-xl font-bold">
                      {t('forecastHeadline', {
                        day: dayLabel(date),
                        total: formatNumber(Math.round(grand), loc),
                      })}
                    </h2>
                    <p className="mt-1 text-sm text-secondary">
                      {t('forecastCompare', { naive: formatNumber(Math.round(naive), loc) })}
                    </p>
                    {reasons.length > 0 ? (
                      <p className="mt-1 text-sm">
                        {t('forecastReasons', { reasons: reasons.join(', ') })}
                      </p>
                    ) : null}
                    {w?.rainy ? (
                      <p className="mt-1 text-sm text-info">{to('rainCounted')}</p>
                    ) : null}

                    <p className="mt-5 mb-2 text-sm font-semibold">{t('topDishes')}</p>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {items.map((i) => (
                        <li
                          key={i.menu_item_id}
                          className="flex items-center justify-between gap-3 rounded-input border border-line px-3 py-2.5"
                        >
                          <span className="font-medium">{label(i.name, i.name_bn)}</span>
                          <span className="text-lg font-bold tabular-nums">
                            {formatNumber(Math.round(total(i.menu_item_id)), loc)}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <details className="mt-5 text-sm">
                      <summary className="cursor-pointer font-medium text-secondary">
                        {t('byTimeOfDay')}
                      </summary>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[32rem] text-sm">
                          <thead className="text-xs text-secondary">
                            <tr>
                              <th className="py-2 text-start font-medium">{t('item')}</th>
                              {parts.map((p) => (
                                <th key={p} className="py-2 text-end font-medium">
                                  {t(`dayparts.${p}`)}
                                </th>
                              ))}
                              <th className="py-2 text-end font-medium">{t('total')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((i) => (
                              <tr key={i.menu_item_id} className="border-t border-line">
                                <td className="py-2 font-medium">{label(i.name, i.name_bn)}</td>
                                {parts.map((p) => (
                                  <td key={p} className="py-2 text-end tabular-nums">
                                    {fmt(cell(i.menu_item_id, p))}
                                  </td>
                                ))}
                                <td className="py-2 text-end font-semibold tabular-nums">
                                  {fmt(total(i.menu_item_id))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>

                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer font-medium text-secondary">
                        {t('howAccurate')}
                      </summary>
                      <div className="mt-2 space-y-2">
                        {a ? (
                          <StatusBadge tone={a.is_shown ? 'success' : 'neutral'}>
                            {a.is_shown ? t('modelShown') : t('naiveShown')}
                          </StatusBadge>
                        ) : null}
                        {a && a.wape_bps !== null && a.naive_wape_bps !== null ? (
                          <p className="text-secondary">
                            {t('accuracyPlain', {
                              model: formatBps(a.wape_bps, loc),
                              naive: formatBps(a.naive_wape_bps, loc),
                              days: formatNumber(a.days, loc),
                            })}
                          </p>
                        ) : null}
                        <Hint>{t('forecastHint')}</Hint>
                      </div>
                    </details>
                  </>
                )}
              </Card>
            );
          })()
        : null}

      {tab === 'prep'
        ? await (async () => {
            const rows = await prepPlan(ctx.org.id, branch.id, date);
            return rows.length === 0 ? (
              <EmptyState title={t('noForecast')} body={t('noForecastBody')} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((r) => (
                  <Card key={r.menu_item_id} className="p-5">
                    <p className="font-bold">{label(r.name, r.name_bn)}</p>
                    <p className="mt-2 text-3xl font-extrabold tabular-nums">
                      {r.batches !== null && r.batch_unit
                        ? t('batches', { count: r.batches, unit: t(`batchUnits.${r.batch_unit}`) })
                        : t('portions', { count: formatNumber(Math.ceil(r.portions), loc) })}
                    </p>
                    <p className="text-sm text-secondary">
                      {r.batches !== null
                        ? t('portionsPerBatch', {
                            portions: formatNumber(Math.ceil(r.portions), loc),
                            per: formatNumber(r.batch_portions ?? 0, loc),
                          })
                        : t('forecastPortions')}
                    </p>
                    {r.key_ingredients.length > 0 ? (
                      <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                        {r.key_ingredients.map((k) => (
                          <li key={k.name} className="flex justify-between gap-2">
                            <span>{label(k.name, k.name_bn)}</span>
                            <span className="tabular-nums text-secondary">
                              {qty(k.qty, k.base)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </Card>
                ))}
              </div>
            );
          })()
        : null}

      {tab === 'bazar'
        ? await (async () => {
            const supabase = await createClient();
            const { data: list } = await supabase
              .from('bazar_lists')
              .select('id, status, generated_at, approved_at, sent_at')
              .eq('org_id', ctx.org.id)
              .eq('branch_id', branch.id)
              .eq('for_date', date)
              .maybeSingle();
            const { data: lines } = list
              ? await supabase
                  .from('bazar_list_lines')
                  .select(
                    'id, suggested_qty_base, approved_qty_base, purchased_qty_base, forecast_qty, stock_qty, safety_qty, adjust_bps, suppliers(name), ingredients(name, name_bn, base)',
                  )
                  .eq('bazar_list_id', list.id)
              : { data: [] };
            type L = {
              id: string;
              suggested_qty_base: number;
              approved_qty_base: number | null;
              purchased_qty_base: number | null;
              forecast_qty: number;
              stock_qty: number | null;
              safety_qty: number;
              adjust_bps: number;
              suppliers: { name: string } | null;
              ingredients: { name: string; name_bn: string | null; base: BaseUnit } | null;
            };
            const ls = (lines ?? []) as unknown as L[];
            const status = (list?.status as keyof typeof STATUS_TONE | undefined) ?? null;
            const regen = (
              <form action={generateBazarAction}>
                {hidden}
                <input type="hidden" name="branchId" value={branch.id} />
                <input type="hidden" name="forDate" value={date} />
                <Button type="submit" size="sm" variant={list ? 'secondary' : 'primary'}>
                  {list ? t('regenerate') : t('generate')}
                </Button>
              </form>
            );
            return (
              <Card className="p-4 sm:p-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="mb-0">{t('bazarTitle', { date })}</CardTitle>
                  <div className="flex items-center gap-2">
                    {status ? (
                      <StatusBadge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</StatusBadge>
                    ) : null}
                    {canDraft && (!status || status === 'draft') ? regen : null}
                  </div>
                </div>
                <p className="-mt-1 mb-4 max-w-3xl text-sm text-secondary">{t('bazarBody')}</p>
                {!list ? (
                  <EmptyState title={t('noList')} body={canDraft ? t('noListBody') : undefined} />
                ) : ls.length === 0 ? (
                  <Alert tone="success">{t('nothingToBuy')}</Alert>
                ) : status === 'draft' ? (
                  <ActionForm
                    action={approveBazarAction}
                    successKey="plan.approved"
                    className="space-y-3"
                  >
                    {hidden}
                    <input type="hidden" name="listId" value={list.id as string} />
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[40rem] text-sm">
                        <thead className="text-xs text-secondary uppercase">
                          <tr>
                            <th className="py-2 text-start font-medium">{t('ingredient')}</th>
                            <th className="py-2 text-end font-medium">{t('need')}</th>
                            <th className="py-2 text-end font-medium">{t('inStock')}</th>
                            <th className="py-2 text-end font-medium">{t('suggested')}</th>
                            <th className="py-2 text-end font-medium">
                              {canApprove ? t('approveQty') : t('supplier')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {ls.map((l) => {
                            const b = l.ingredients?.base ?? 'g';
                            const shown = splitQuantity(Number(l.suggested_qty_base), b);
                            return (
                              <tr key={l.id} className="border-t border-line align-middle">
                                <td className="py-2.5">
                                  <p className="font-medium">
                                    {label(
                                      l.ingredients?.name ?? '',
                                      l.ingredients?.name_bn ?? null,
                                    )}
                                  </p>
                                  <p className="text-xs text-secondary">
                                    {l.suppliers?.name ?? t('noSupplier')}
                                    {Number(l.adjust_bps) !== 0
                                      ? ` · ${t('tuned', { pct: formatBps(Number(l.adjust_bps), loc) })}`
                                      : ''}
                                  </p>
                                </td>
                                <td className="py-2.5 text-end tabular-nums">
                                  {qty(Number(l.forecast_qty), b)}
                                  {Number(l.safety_qty) > 0 ? (
                                    <span className="block text-xs text-secondary">
                                      {t('plusSafety', { qty: qty(Number(l.safety_qty), b) })}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="py-2.5 text-end tabular-nums">
                                  {l.stock_qty === null
                                    ? t('notCounted')
                                    : qty(Number(l.stock_qty), b)}
                                </td>
                                <td className="py-2.5 text-end font-semibold tabular-nums">
                                  {qty(Number(l.suggested_qty_base), b)}
                                </td>
                                <td className="py-2.5 text-end">
                                  {canApprove ? (
                                    <div className="flex justify-end gap-1">
                                      <Input
                                        name={`qty-${l.id}`}
                                        inputMode="decimal"
                                        aria-label={t('approveQty')}
                                        placeholder={String(Math.round(shown.value * 1000) / 1000)}
                                        className="min-h-9 w-20 text-end"
                                      />
                                      <UnitField
                                        name={`unit-${l.id}`}
                                        ariaLabel={t('unit')}
                                        base={b}
                                        defaultValue={shown.unit}
                                        className="w-24"
                                        selectClassName="min-h-9 w-full"
                                      />
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {canApprove ? (
                      <>
                        <Hint>{t('approveHint')}</Hint>
                        <Button type="submit">{t('approve')}</Button>
                      </>
                    ) : (
                      <Hint>{t('managerApproves')}</Hint>
                    )}
                  </ActionForm>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {ls.map((l) => {
                        const b = l.ingredients?.base ?? 'g';
                        const bought = l.purchased_qty_base;
                        return (
                          <li
                            key={l.id}
                            className="glass-tile flex flex-wrap items-center justify-between gap-2 rounded-input p-3 text-sm"
                          >
                            <span className="font-medium">
                              {label(l.ingredients?.name ?? '', l.ingredients?.name_bn ?? null)}
                              <span className="ms-2 text-xs text-secondary">
                                {l.suppliers?.name ?? ''}
                              </span>
                            </span>
                            <span className="tabular-nums">
                              {qty(Number(l.approved_qty_base ?? 0), b)}
                              {bought !== null ? (
                                <span
                                  className={`ms-2 ${Number(bought) < Number(l.approved_qty_base) ? 'text-warning' : 'text-success'}`}
                                >
                                  {t('bought', { qty: qty(Number(bought), b) })}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {status === 'approved' && canApprove ? (
                      <ActionForm
                        action={sendBazarAction}
                        successKey="plan.sent"
                        className="mt-4 flex flex-wrap items-end gap-2"
                      >
                        {hidden}
                        <input type="hidden" name="listId" value={list.id as string} />
                        <div>
                          <label
                            htmlFor="purchaser-phone"
                            className="mb-1.5 block text-sm font-medium"
                          >
                            {t('purchaserPhone')}
                          </label>
                          <Input
                            id="purchaser-phone"
                            name="purchaserPhone"
                            inputMode="tel"
                            maxLength={20}
                            className="w-48"
                          />
                        </div>
                        <Button type="submit">{t('send')}</Button>
                        <Hint className="basis-full">{t('sendHint')}</Hint>
                      </ActionForm>
                    ) : null}
                    {status === 'sent' || status === 'reconciled' || status === 'approved' ? (
                      <form action={reconcileBazarAction} className="mt-4">
                        {hidden}
                        <input type="hidden" name="listId" value={list.id as string} />
                        <Button type="submit" size="sm" variant="secondary">
                          {t('reconcile')}
                        </Button>
                        <Hint>{t('reconcileHint')}</Hint>
                      </form>
                    ) : null}
                  </>
                )}
              </Card>
            );
          })()
        : null}
    </>
  );
}
