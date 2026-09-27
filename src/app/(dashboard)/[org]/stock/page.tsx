import { ArrowLeftRight, ClipboardList, Package, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardTitle,
  EmptyState,
  Hint,
  Input,
  Label,
  PageTitle,
  Select,
} from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { addDays, weekday } from '@/lib/time/business-date';
import {
  logWasteAction,
  receiveTransferAction,
  sendTransferAction,
  startCountAction,
} from '@/modules/inventory/actions';
import { formatQuantity } from '@/modules/inventory/format';
import {
  stockStatus,
  stockVariance,
  varianceBand,
  wasteBoard,
  type CoverBand,
} from '@/modules/inventory/queries';
import { businessToday } from '@/modules/metrics/queries';
import { splitQuantity, type BaseUnit, type PurchaseUnit } from '@/modules/purchasing/lines';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';

const TABS = ['status', 'variance', 'waste', 'transfers'] as const;
type Tab = (typeof TABS)[number];
const BAND_TONE: Record<CoverBand, 'success' | 'warning' | 'danger' | 'neutral'> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
  none: 'neutral',
};
const VARIANCE_TONE = {
  healthy: 'success',
  watch: 'warning',
  problem: 'danger',
  none: 'neutral',
} as const;
const TRANSFER_TONE = {
  draft: 'neutral',
  sent: 'info',
  received: 'success',
  disputed: 'warning',
} as const;

/** Stock (ROADMAP Phase 5): what should be on the shelf, how long it lasts, counts, waste, transfers. */
export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{
    tab?: string;
    branch?: string;
    from?: string;
    to?: string;
    days?: string;
    counted?: string;
  }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const has = (r: string) => ctx.roles.includes(r as never);
  if (!['owner', 'manager', 'kitchen', 'purchaser', 'accountant'].some(has)) notFound();
  const canSeeMoney = has('owner') || has('accountant');
  const canCount = ['owner', 'manager', 'kitchen', 'purchaser'].some(has);
  const canWaste = ['owner', 'manager', 'kitchen'].some(has);
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'status';
  const branch = pickBranch(ctx, sp.branch);

  const [t, tu, locale] = await Promise.all([
    getTranslations('stock'),
    getTranslations('units'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const qty = (q: number, b: BaseUnit) => formatQuantity(q, b, loc, (u) => tu(u));
  const label = (name: string, nameBn: string | null) => (loc === 'bn' && nameBn ? nameBn : name);
  if (!branch) {
    return (
      <>
        <PageTitle title={t('title')} subtitle={t('subtitle')} />
        <EmptyState title={t('noBranch')} />
      </>
    );
  }
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams({ tab, branch: branch.id, ...over });
    return `/${ctx.org.slug}/stock?${q.toString()}`;
  };
  const { date: today } = await businessToday(ctx.org.id);
  const supabase = await createClient();
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const unitSelect = (name: string) => (
    <Select name={name} aria-label={t('unit')} defaultValue="kg" className="w-24">
      {(['kg', 'g', 'l', 'ml', 'pcs', 'dozen'] as PurchaseUnit[]).map((u) => (
        <option key={u} value={u}>
          {tu(u)}
        </option>
      ))}
    </Select>
  );

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {ctx.branches.length > 1 ? (
        <PillNav
          label={t('branches')}
          className="mb-3"
          items={ctx.branches.map((b) => ({
            href: `/${ctx.org.slug}/stock?${new URLSearchParams({ tab, branch: b.id }).toString()}`,
            label: b.name,
            active: b.id === branch.id,
          }))}
        />
      ) : null}
      <PillNav
        label={t('sections')}
        className="mb-6 flex"
        items={[
          { key: 'status' as const, icon: <Package /> },
          { key: 'variance' as const, icon: <ClipboardList /> },
          { key: 'waste' as const, icon: <Trash2 /> },
          { key: 'transfers' as const, icon: <ArrowLeftRight /> },
        ].map((x) => ({
          href: `/${ctx.org.slug}/stock?${new URLSearchParams({ tab: x.key, branch: branch.id }).toString()}`,
          label: t(`tabs.${x.key}`),
          active: x.key === tab,
          icon: x.icon,
        }))}
      />

      {tab === 'status'
        ? await (async () => {
            const [rows, { data: settings }, { data: counts }] = await Promise.all([
              stockStatus(ctx.org.id, branch.id),
              supabase
                .from('org_settings')
                .select('count_weekday')
                .eq('org_id', ctx.org.id)
                .maybeSingle(),
              supabase
                .from('stock_counts')
                .select('id, status, kind, counted_on')
                .eq('org_id', ctx.org.id)
                .eq('branch_id', branch.id)
                .eq('counted_on', today),
            ]);
            const due = weekday(today) === Number(settings?.count_weekday ?? 0);
            const submitted = (counts ?? []).some((c) => c.status === 'submitted');
            const open = (counts ?? []).find((c) => c.status === 'open');
            const red = rows.filter((r) => r.band === 'red').length;
            return (
              <div className="space-y-6">
                {sp.counted ? <Alert tone="success">{t('countSubmitted')}</Alert> : null}
                {due && !submitted ? <Alert tone="warning">{t('countDue')}</Alert> : null}
                {canCount ? (
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-semibold">{t('countTitle')}</p>
                      <p className="text-sm text-secondary">{t('countBody')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {open ? (
                        <Link
                          href={`/${ctx.org.slug}/stock/count/${open.id as string}`}
                          className={buttonVariants({ size: 'sm' })}
                        >
                          {t('continueCount')}
                        </Link>
                      ) : null}
                      {(['guided_weekly', 'full'] as const).map((kind) => (
                        <form key={kind} action={startCountAction}>
                          {hidden}
                          <input type="hidden" name="branchId" value={branch.id} />
                          <input type="hidden" name="kind" value={kind} />
                          <Button
                            type="submit"
                            size="sm"
                            variant={kind === 'guided_weekly' && !open ? 'primary' : 'secondary'}
                          >
                            {t(`start.${kind}`)}
                          </Button>
                        </form>
                      ))}
                    </div>
                  </Card>
                ) : null}
                <Card className="p-4 sm:p-6">
                  <CardTitle>{t('levelsTitle')}</CardTitle>
                  <p className="-mt-2 mb-4 text-sm text-secondary">
                    {red > 0 ? t('levelsRed', { count: red }) : t('levelsBody')}
                  </p>
                  {rows.length === 0 ? (
                    <EmptyState title={t('noStock')} body={t('noStockBody')} />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[36rem] text-sm">
                        <thead className="text-start text-xs text-secondary uppercase">
                          <tr>
                            <th className="py-2 text-start font-medium">{t('col.ingredient')}</th>
                            <th className="py-2 text-end font-medium">{t('col.stock')}</th>
                            <th className="py-2 text-end font-medium">{t('col.cover')}</th>
                            <th className="py-2 text-end font-medium">{t('col.lastCount')}</th>
                            <th className="py-2 text-end font-medium">{t('col.inTransit')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.ingredient_id} className="border-t border-line">
                              <td className="py-2.5 font-medium">{label(r.name, r.name_bn)}</td>
                              <td
                                className={`py-2.5 text-end tabular-nums ${r.stock_qty !== null && r.stock_qty < 0 ? 'text-danger' : ''}`}
                              >
                                {r.stock_qty === null
                                  ? t('neverCounted')
                                  : qty(r.stock_qty, r.base)}
                              </td>
                              <td className="py-2.5 text-end">
                                <StatusBadge tone={BAND_TONE[r.band]}>
                                  {r.days_of_cover === null
                                    ? t('noUsage')
                                    : t('days', {
                                        days: formatNumber(r.days_of_cover, loc, {
                                          fractionDigits: 1,
                                        }),
                                      })}
                                </StatusBadge>
                              </td>
                              <td className="py-2.5 text-end text-secondary tabular-nums">
                                {r.last_count_date ?? '—'}
                              </td>
                              <td className="py-2.5 text-end tabular-nums">
                                {r.in_transit_qty > 0 ? qty(r.in_transit_qty, r.base) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <Hint className="mt-3">{t('levelsHint')}</Hint>
                </Card>
              </div>
            );
          })()
        : null}

      {tab === 'variance'
        ? await (async () => {
            const { data: countDays } = await supabase
              .from('stock_counts')
              .select('counted_on')
              .eq('org_id', ctx.org.id)
              .eq('branch_id', branch.id)
              .eq('status', 'submitted')
              .order('counted_on', { ascending: false })
              .limit(40);
            const dates = [...new Set((countDays ?? []).map((c) => c.counted_on as string))];
            if (dates.length < 2)
              return <EmptyState title={t('needTwoCounts')} body={t('needTwoCountsBody')} />;
            const to = dates.includes(sp.to ?? '') ? sp.to! : dates[0]!;
            const from =
              dates.includes(sp.from ?? '') && sp.from! < to
                ? sp.from!
                : (dates.find((d) => d < to) ?? dates[1]!);
            const rows = await stockVariance(ctx.org.id, branch.id, from, to);
            const total = rows.reduce((s, r) => s + (r.variance_poisha ?? 0), 0);
            return (
              <div className="space-y-6">
                <Card className="p-4">
                  <form
                    className="flex flex-wrap items-end gap-3"
                    action={`/${ctx.org.slug}/stock`}
                  >
                    <input type="hidden" name="tab" value="variance" />
                    <input type="hidden" name="branch" value={branch.id} />
                    {(['from', 'to'] as const).map((k) => (
                      <div key={k}>
                        <Label htmlFor={`v-${k}`}>{t(`period.${k}`)}</Label>
                        <Select
                          id={`v-${k}`}
                          name={k}
                          defaultValue={k === 'from' ? from : to}
                          className="w-40"
                        >
                          {dates.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ))}
                    <Button type="submit" size="sm" variant="secondary">
                      {t('show')}
                    </Button>
                  </form>
                </Card>
                <Card className="p-4 sm:p-6">
                  <CardTitle>{t('varianceTitle', { from, to })}</CardTitle>
                  <p className="-mt-2 mb-4 max-w-3xl text-sm text-secondary">{t('varianceBody')}</p>
                  {canSeeMoney ? (
                    <p className="mb-4 text-sm">
                      {t('varianceTotal', { amount: formatBDT(total, loc) })}
                    </p>
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[56rem] text-sm">
                      <thead className="text-xs text-secondary uppercase">
                        <tr>
                          <th className="py-2 text-start font-medium">{t('col.ingredient')}</th>
                          <th className="py-2 text-end font-medium">{t('col.opening')}</th>
                          <th className="py-2 text-end font-medium">{t('col.bought')}</th>
                          <th className="py-2 text-end font-medium">{t('col.transfers')}</th>
                          <th className="py-2 text-end font-medium">{t('col.closing')}</th>
                          <th className="py-2 text-end font-medium">{t('col.used')}</th>
                          <th className="py-2 text-end font-medium">{t('col.shouldUse')}</th>
                          <th className="py-2 text-end font-medium">{t('col.waste')}</th>
                          <th className="py-2 text-end font-medium">{t('col.variance')}</th>
                          {canSeeMoney ? (
                            <th className="py-2 text-end font-medium">{t('col.value')}</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const band = varianceBand(r.variance_bps);
                          const net = r.transfers_in_qty - r.transfers_out_qty;
                          return (
                            <tr key={r.ingredient_id} className="border-t border-line">
                              <td className="py-2.5 font-medium">{label(r.name, r.name_bn)}</td>
                              <td className="py-2.5 text-end tabular-nums">
                                {qty(r.opening_qty, r.base)}
                              </td>
                              <td className="py-2.5 text-end tabular-nums">
                                {qty(r.purchases_qty, r.base)}
                              </td>
                              <td className="py-2.5 text-end tabular-nums">
                                {net === 0 ? '—' : `${net > 0 ? '+' : ''}${qty(net, r.base)}`}
                              </td>
                              <td className="py-2.5 text-end tabular-nums">
                                {qty(r.closing_qty, r.base)}
                              </td>
                              <td className="py-2.5 text-end tabular-nums">
                                {qty(r.usage_actual_qty, r.base)}
                              </td>
                              <td className="py-2.5 text-end tabular-nums">
                                {qty(r.usage_theoretical_qty, r.base)}
                              </td>
                              <td className="py-2.5 text-end tabular-nums">
                                {qty(r.waste_qty, r.base)}
                              </td>
                              <td className="py-2.5 text-end">
                                <StatusBadge tone={VARIANCE_TONE[band]}>
                                  {`${r.variance_qty > 0 ? '+' : ''}${qty(r.variance_qty, r.base)}`}
                                  {r.variance_bps === null
                                    ? ''
                                    : ` · ${formatBps(r.variance_bps, loc)}`}
                                </StatusBadge>
                              </td>
                              {canSeeMoney ? (
                                <td
                                  className={`py-2.5 text-end tabular-nums ${(r.variance_poisha ?? 0) > 0 ? 'text-danger' : ''}`}
                                >
                                  {r.variance_poisha === null
                                    ? '—'
                                    : formatBDT(r.variance_poisha, loc)}
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Hint className="mt-3">{t('varianceHint')}</Hint>
                </Card>
              </div>
            );
          })()
        : null}

      {tab === 'waste'
        ? await (async () => {
            const days = sp.days === '30' ? 30 : 7;
            const [board, { data: reasons }, { data: ingredients }, { data: items }] =
              await Promise.all([
                wasteBoard(ctx.org.id, branch.id, addDays(today, -(days - 1)), today).catch(
                  () => [],
                ),
                supabase
                  .from('reason_codes')
                  .select('id, label, label_bn')
                  .eq('org_id', ctx.org.id)
                  .eq('kind', 'waste')
                  .eq('is_active', true)
                  .order('label'),
                supabase
                  .from('ingredients')
                  .select('id, name, name_bn, base')
                  .eq('org_id', ctx.org.id)
                  .eq('is_active', true)
                  .order('name'),
                supabase
                  .from('menu_items')
                  .select('id, name, name_bn')
                  .eq('org_id', ctx.org.id)
                  .eq('is_active', true)
                  .order('name'),
              ]);
            const total = board.reduce((s, r) => s + (r.value_poisha ?? 0), 0);
            return (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                {canWaste ? (
                  <Card>
                    <CardTitle>{t('wasteLogTitle')}</CardTitle>
                    <ActionForm
                      action={logWasteAction}
                      successKey="stock.wasteLogged"
                      className="space-y-3"
                    >
                      {hidden}
                      <input type="hidden" name="branchId" value={branch.id} />
                      <div>
                        <Label htmlFor="w-target">{t('wasteWhat')}</Label>
                        <Select id="w-target" name="target" required defaultValue="">
                          <option value="" disabled>
                            {t('choose')}
                          </option>
                          <optgroup label={t('ingredients')}>
                            {(ingredients ?? []).map((i) => (
                              <option key={i.id} value={`ingredient:${i.id as string}`}>
                                {label(i.name as string, i.name_bn as string | null)} (
                                {tu(i.base === 'g' ? 'kg' : i.base === 'ml' ? 'l' : 'pcs')})
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label={t('dishes')}>
                            {(items ?? []).map((i) => (
                              <option key={i.id} value={`item:${i.id as string}`}>
                                {label(i.name as string, i.name_bn as string | null)} (
                                {t('portions')})
                              </option>
                            ))}
                          </optgroup>
                        </Select>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Label htmlFor="w-qty">{t('qty')}</Label>
                          <Input id="w-qty" name="qty" inputMode="decimal" required />
                        </div>
                        <div>
                          <Label htmlFor="w-unit">{t('unit')}</Label>
                          <Select id="w-unit" name="unit" defaultValue="kg" className="w-28">
                            {(['kg', 'g', 'l', 'ml', 'pcs', 'dozen'] as PurchaseUnit[]).map((u) => (
                              <option key={u} value={u}>
                                {tu(u)}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </div>
                      <Hint className="-mt-1">{t('wasteUnitHint')}</Hint>
                      <div>
                        <Label htmlFor="w-reason">{t('reason')}</Label>
                        <Select id="w-reason" name="reasonId" required defaultValue="">
                          <option value="" disabled>
                            {t('choose')}
                          </option>
                          {(reasons ?? []).map((r) => (
                            <option key={r.id} value={r.id as string}>
                              {label(r.label as string, r.label_bn as string | null)}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="w-note">{t('note')}</Label>
                        <Input id="w-note" name="note" maxLength={300} />
                      </div>
                      <Button type="submit">{t('logWaste')}</Button>
                    </ActionForm>
                  </Card>
                ) : null}
                <Card>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="mb-0">{t('wasteBoardTitle')}</CardTitle>
                    <PillNav
                      label={t('period.label')}
                      items={[7, 30].map((d) => ({
                        href: href({ days: String(d) }),
                        label: t('lastDays', { days: d }),
                        active: d === days,
                      }))}
                    />
                  </div>
                  {canSeeMoney && board.length > 0 ? (
                    <p className="mb-3 text-sm">
                      {t('wasteTotal', { amount: formatBDT(total, loc) })}
                    </p>
                  ) : null}
                  {board.length === 0 ? (
                    <EmptyState title={t('noWaste')} />
                  ) : (
                    <ol className="space-y-2">
                      {board.map((r, i) => (
                        <li
                          key={i}
                          className="glass-tile flex flex-wrap items-center justify-between gap-2 rounded-input p-3"
                        >
                          <div>
                            <p className="font-semibold">{label(r.name, r.name_bn)}</p>
                            <p className="text-xs text-secondary">
                              {label(r.reason_label ?? t('noReason'), r.reason_label_bn)} ·{' '}
                              {t('entries', { count: r.entries })}
                            </p>
                          </div>
                          <div className="text-end text-sm tabular-nums">
                            <p>
                              {r.qty_base !== null && r.base
                                ? qty(r.qty_base, r.base)
                                : t('portionCount', { count: r.qty_portions ?? 0 })}
                            </p>
                            {r.value_poisha !== null ? (
                              <p className="font-semibold">{formatBDT(r.value_poisha, loc)}</p>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              </div>
            );
          })()
        : null}

      {tab === 'transfers'
        ? await (async () => {
            const [{ data: destinations }, { data: transfers }, { data: ingredients }] =
              await Promise.all([
                canCount
                  ? supabase.rpc('transfer_destinations', { p_org: ctx.org.id })
                  : Promise.resolve({ data: [] as { id: string; name: string }[] }),
                supabase
                  .from('transfers')
                  .select(
                    'id, from_branch_id, to_branch_id, status, sent_on, received_on, notes, transfer_lines(id, qty_base_sent, qty_base_received, ingredients(name, name_bn, base))',
                  )
                  .eq('org_id', ctx.org.id)
                  .or(`from_branch_id.eq.${branch.id},to_branch_id.eq.${branch.id}`)
                  .order('created_at', { ascending: false })
                  .limit(30),
                supabase
                  .from('ingredients')
                  .select('id, name, name_bn, base')
                  .eq('org_id', ctx.org.id)
                  .eq('is_active', true)
                  .order('name'),
              ]);
            const names = new Map(
              ((destinations ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]),
            );
            for (const b of ctx.branches) names.set(b.id, b.name);
            type TLine = {
              id: string;
              qty_base_sent: number;
              qty_base_received: number | null;
              ingredients: { name: string; name_bn: string | null; base: BaseUnit } | null;
            };
            const list = (transfers ?? []) as unknown as {
              id: string;
              from_branch_id: string;
              to_branch_id: string;
              status: keyof typeof TRANSFER_TONE;
              sent_on: string | null;
              received_on: string | null;
              notes: string | null;
              transfer_lines: TLine[];
            }[];
            const incoming = list.filter(
              (x) => x.to_branch_id === branch.id && x.status === 'sent',
            );
            const others = ((destinations ?? []) as { id: string; name: string }[]).filter(
              (b) => b.id !== branch.id,
            );
            return (
              <div className="space-y-6">
                {canCount && incoming.length > 0 ? (
                  <Card>
                    <CardTitle>{t('incomingTitle')}</CardTitle>
                    <ul className="space-y-4">
                      {incoming.map((x) => (
                        <li key={x.id} className="glass-tile rounded-input p-4">
                          <p className="mb-2 text-sm font-semibold">
                            {t('fromBranch', {
                              branch: names.get(x.from_branch_id) ?? '—',
                              date: x.sent_on ?? '',
                            })}
                          </p>
                          <ActionForm
                            action={receiveTransferAction}
                            successKey="stock.received"
                            className="space-y-2"
                          >
                            {hidden}
                            <input type="hidden" name="transferId" value={x.id} />
                            {x.transfer_lines.map((l) => {
                              const b = l.ingredients?.base ?? 'g';
                              const shown = splitQuantity(Number(l.qty_base_sent), b);
                              return (
                                <div key={l.id} className="flex flex-wrap items-center gap-2">
                                  <span className="min-w-40 flex-1 text-sm">
                                    {label(
                                      l.ingredients?.name ?? '',
                                      l.ingredients?.name_bn ?? null,
                                    )}{' '}
                                    · {t('sentQty', { qty: qty(Number(l.qty_base_sent), b) })}
                                  </span>
                                  <Input
                                    name={`recv-${l.id}`}
                                    inputMode="decimal"
                                    aria-label={t('receivedQty')}
                                    placeholder={formatNumber(shown.value, 'en', {
                                      fractionDigits: Number.isInteger(shown.value) ? 0 : 3,
                                    })}
                                    className="min-h-9 w-28"
                                  />
                                  <input type="hidden" name={`unit-${l.id}`} value={shown.unit} />
                                  <span className="text-xs text-secondary">{tu(shown.unit)}</span>
                                </div>
                              );
                            })}
                            <Hint>{t('receiveHint')}</Hint>
                            <Input
                              name="note"
                              maxLength={500}
                              placeholder={t('note')}
                              aria-label={t('note')}
                            />
                            <Button type="submit" size="sm">
                              {t('receive')}
                            </Button>
                          </ActionForm>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : null}
                {canCount && others.length > 0 ? (
                  <Card>
                    <CardTitle>{t('sendTitle')}</CardTitle>
                    <ActionForm
                      action={sendTransferAction}
                      successKey="stock.sent"
                      className="space-y-3"
                    >
                      {hidden}
                      <input type="hidden" name="fromBranchId" value={branch.id} />
                      <div className="max-w-xs">
                        <Label htmlFor="t-to">{t('toBranch')}</Label>
                        <Select id="t-to" name="toBranchId" required defaultValue="">
                          <option value="" disabled>
                            {t('choose')}
                          </option>
                          {others.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-2"
                        >
                          <Select
                            name={`line-${i}-ingredient`}
                            aria-label={t('col.ingredient')}
                            defaultValue=""
                          >
                            <option value="">{t('choose')}</option>
                            {(ingredients ?? []).map((ing) => (
                              <option key={ing.id} value={ing.id as string}>
                                {label(ing.name as string, ing.name_bn as string | null)}
                              </option>
                            ))}
                          </Select>
                          <Input
                            name={`line-${i}-qty`}
                            inputMode="decimal"
                            aria-label={t('qty')}
                            placeholder={t('qty')}
                          />
                          {unitSelect(`line-${i}-unit`)}
                        </div>
                      ))}
                      <Hint>{t('sendHint')}</Hint>
                      <Input
                        name="notes"
                        maxLength={500}
                        placeholder={t('note')}
                        aria-label={t('note')}
                      />
                      <Button type="submit">{t('send')}</Button>
                    </ActionForm>
                  </Card>
                ) : null}
                <Card>
                  <CardTitle>{t('recentTransfers')}</CardTitle>
                  {list.length === 0 ? (
                    <EmptyState title={t('noTransfers')} />
                  ) : (
                    <ul className="space-y-2">
                      {list.map((x) => (
                        <li
                          key={x.id}
                          className="glass-tile flex flex-wrap items-center justify-between gap-2 rounded-input p-3 text-sm"
                        >
                          <div>
                            <p className="font-semibold">
                              {t('route', {
                                from: names.get(x.from_branch_id) ?? '—',
                                to: names.get(x.to_branch_id) ?? '—',
                              })}
                            </p>
                            <p className="text-xs text-secondary">
                              {x.transfer_lines
                                .map(
                                  (l) =>
                                    `${label(l.ingredients?.name ?? '', l.ingredients?.name_bn ?? null)} ${qty(Number(l.qty_base_sent), l.ingredients?.base ?? 'g')}` +
                                    (l.qty_base_received !== null &&
                                    Number(l.qty_base_received) !== Number(l.qty_base_sent)
                                      ? ` (${t('arrived', { qty: qty(Number(l.qty_base_received), l.ingredients?.base ?? 'g') })})`
                                      : ''),
                                )
                                .join(' · ')}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-secondary tabular-nums">
                              {x.received_on ?? x.sent_on ?? ''}
                            </span>
                            <StatusBadge tone={TRANSFER_TONE[x.status]}>
                              {t(`transferStatus.${x.status}`)}
                            </StatusBadge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            );
          })()
        : null}
    </>
  );
}
