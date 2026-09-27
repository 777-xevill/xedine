import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardTitle,
  EmptyState,
  Hint,
  Input,
  Label,
  PageTitle,
  Select,
  Stat,
} from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { parseTakaToPoisha } from '@/lib/money';
import { addDays } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import { businessToday } from '@/modules/metrics/queries';
import { getOrgContext } from '@/modules/tenancy/context';

const WINDOWS = ['last_7d', 'last_30d', 'month_to_date'] as const;
type Window = (typeof WINDOWS)[number];
const CLASSES = ['star', 'plowhorse', 'puzzle', 'dog'] as const;
const CLASS_TONE = {
  star: 'success',
  plowhorse: 'info',
  puzzle: 'warning',
  dog: 'danger',
} as const;
const UUID = /^[0-9a-f-]{36}$/;

interface MatrixRow {
  menu_item_id: string;
  name: string;
  qty: number;
  net_poisha: number;
  cm_per_unit_poisha: number | null;
  food_cost_bps: number | null;
  class: string;
}

/** M5 Menu Profit Intelligence: food cost, menu engineering and a price & portion simulator. */
export default async function MenuProfitPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ window?: string; item?: string; price?: string; portion?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('accountant')) notFound();

  const [t, locale] = await Promise.all([getTranslations('menuProfit'), getLocale()]);
  const loc = locale as Locale;
  const money = (p: number) => formatBDT(p, loc, { poisha: 'never' });
  const window: Window = (WINDOWS as readonly string[]).includes(sp.window ?? '')
    ? (sp.window as Window)
    : 'last_30d';
  const { date: today } = await businessToday(ctx.org.id);
  const from =
    window === 'last_7d'
      ? addDays(today, -6)
      : window === 'last_30d'
        ? addDays(today, -29)
        : `${today.slice(0, 8)}01`;
  const scope = ctx.selectedBranchId;
  const supabase = await createClient();
  const [{ data: food }, { data: matrix }, { data: items }] = await Promise.all([
    supabase.rpc('metric_food_cost', {
      p_org: ctx.org.id,
      p_branch: scope,
      p_from: from,
      p_to: today,
    }),
    supabase.rpc('metric_menu_matrix', {
      p_org: ctx.org.id,
      p_branch: scope,
      p_from: from,
      p_to: today,
    }),
    supabase
      .from('menu_items')
      .select('id, name, base_price_poisha')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('name'),
  ]);
  const total = ((food ?? []) as Record<string, number | null>[]).find((r) => r.branch_id === null);
  const rows = (matrix ?? []) as MatrixRow[];

  const simItem = sp.item && UUID.test(sp.item) ? sp.item : null;
  const simPrice = sp.price ? parseTakaToPoisha(sp.price) : null;
  const simPortion = sp.portion ? Math.round(Number(sp.portion) * 100) : 10000;
  const sim =
    simItem && Number.isFinite(simPortion) && simPortion > 0
      ? await supabase.rpc('metric_simulate_item', {
          p_org: ctx.org.id,
          p_item: simItem,
          p_price: simPrice,
          p_portion_bps: simPortion,
          p_now: now().toISOString(),
        })
      : null;
  const simRow = (sim?.data as Record<string, number>[] | null)?.[0];

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <PillNav
        label={t('window')}
        className="mb-6"
        items={WINDOWS.map((w) => ({
          href: `/${ctx.org.slug}/menu-profit?window=${w}`,
          label: t(`windows.${w}`),
          active: w === window,
        }))}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label={t('tfc')} value={money(Number(total?.tfc_poisha ?? 0))} />
        <Stat
          label={t('tfcPct')}
          value={total?.tfc_pct_bps == null ? '—' : formatBps(Number(total.tfc_pct_bps), loc)}
        />
        <Stat
          label={t('coverage')}
          value={total?.coverage_bps == null ? '—' : formatBps(Number(total.coverage_bps), loc)}
        />
      </div>
      {total?.coverage_bps != null && Number(total.coverage_bps) < 9000 ? (
        <Hint className="-mt-4 mb-6">
          {t('coverageHint')}{' '}
          <Link href={`/${ctx.org.slug}/recipes`} className="text-cyan hover:underline">
            {t('addRecipes')}
          </Link>
        </Hint>
      ) : null}

      <section aria-labelledby="matrix-h" className="mb-8">
        <h2 id="matrix-h" className="mb-3 text-lg font-bold">
          {t('matrixTitle')}
        </h2>
        {rows.length === 0 ? (
          <EmptyState title={t('noSales')} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {CLASSES.map((cls) => {
              const inClass = rows.filter((r) => r.class === cls);
              return (
                <Card key={cls} className="p-5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <CardTitle className="mb-0">{t(`classes.${cls}.name`)}</CardTitle>
                    <StatusBadge tone={CLASS_TONE[cls]}>
                      {formatNumber(inClass.length, loc)}
                    </StatusBadge>
                  </div>
                  <p className="mb-3 text-sm text-secondary">{t(`classes.${cls}.advice`)}</p>
                  {inClass.length === 0 ? (
                    <p className="text-sm text-muted">{t('none')}</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-secondary">
                          <th scope="col" className="py-1 text-start font-medium">
                            {t('col.item')}
                          </th>
                          <th scope="col" className="py-1 text-end font-medium">
                            {t('col.qty')}
                          </th>
                          <th scope="col" className="py-1 text-end font-medium">
                            {t('col.cm')}
                          </th>
                          <th scope="col" className="py-1 text-end font-medium">
                            {t('col.foodCost')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {inClass.map((r) => (
                          <tr key={r.menu_item_id} className="border-t border-line/60">
                            <td className="py-1.5">{r.name}</td>
                            <td className="py-1.5 text-end tabular-nums">
                              {formatNumber(Number(r.qty), loc)}
                            </td>
                            <td className="py-1.5 text-end tabular-nums">
                              {money(Number(r.cm_per_unit_poisha ?? 0))}
                            </td>
                            <td className="py-1.5 text-end tabular-nums">
                              {r.food_cost_bps === null
                                ? '—'
                                : formatBps(Number(r.food_cost_bps), loc)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              );
            })}
          </div>
        )}
        {rows.some((r) => r.class === 'unknown') ? (
          <p className="mt-3 text-sm text-secondary">
            {t('unknown', {
              items: rows
                .filter((r) => r.class === 'unknown')
                .map((r) => r.name)
                .join(', '),
            })}
          </p>
        ) : null}
      </section>

      <Card>
        <CardTitle>{t('simTitle')}</CardTitle>
        <p className="-mt-2 mb-4 max-w-2xl text-sm text-secondary">{t('simBody')}</p>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="window" value={window} />
          <div>
            <Label htmlFor="sim-item">{t('col.item')}</Label>
            <Select id="sim-item" name="item" defaultValue={simItem ?? ''} required>
              <option value="">{t('chooseItem')}</option>
              {(items ?? []).map((i) => (
                <option key={i.id} value={i.id as string}>
                  {i.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sim-price">{t('newPrice')}</Label>
            <Input
              id="sim-price"
              name="price"
              inputMode="decimal"
              defaultValue={sp.price ?? ''}
              className="w-28"
            />
          </div>
          <div>
            <Label htmlFor="sim-portion">{t('portionPct')}</Label>
            <Input
              id="sim-portion"
              name="portion"
              inputMode="decimal"
              defaultValue={sp.portion ?? '100'}
              className="w-24"
            />
          </div>
          <Button type="submit" variant="secondary">
            {t('simulate')}
          </Button>
        </form>
        {sim?.error ? <p className="mt-4 text-sm text-danger">{t('simError')}</p> : null}
        {simRow ? (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="text-xs text-secondary">
                  <th scope="col" className="py-1 text-start font-medium" />
                  <th scope="col" className="py-1 text-end font-medium">
                    {t('now')}
                  </th>
                  <th scope="col" className="py-1 text-end font-medium">
                    {t('then')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['price', 'current_price_poisha', 'new_price_poisha', 'money'],
                    ['netPrice', 'current_net_unit_poisha', 'new_net_unit_poisha', 'money'],
                    ['cost', 'current_cost_poisha', 'new_cost_poisha', 'money'],
                    ['cm', 'current_cm_poisha', 'new_cm_poisha', 'money'],
                    ['foodCost', 'current_food_cost_bps', 'new_food_cost_bps', 'bps'],
                  ] as const
                ).map(([label, a, b, kind]) => (
                  <tr key={label} className="border-t border-line/60">
                    <th scope="row" className="py-1.5 text-start font-normal text-secondary">
                      {t(`sim.${label}`)}
                    </th>
                    {[a, b].map((k) => (
                      <td key={k} className="py-1.5 text-end tabular-nums">
                        {simRow[k] == null
                          ? '—'
                          : kind === 'money'
                            ? formatBDT(Number(simRow[k]), loc)
                            : formatBps(Number(simRow[k]), loc)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-sm">
              {t('simImpact', {
                qty: formatNumber(Number(simRow.qty_28d ?? 0), loc),
                change: formatBDT(Number(simRow.cm_change_28d_poisha ?? 0), loc),
              })}
            </p>
            <Hint>{t('simAssumption')}</Hint>
          </div>
        ) : null}
        <p className="mt-6 text-sm">
          <Link
            href={`/${ctx.org.slug}/leaks`}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            {t('seeMarginLeaks')}
          </Link>
        </p>
      </Card>
    </>
  );
}
