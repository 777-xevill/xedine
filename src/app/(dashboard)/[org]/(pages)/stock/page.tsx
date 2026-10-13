import { PageAgent } from '@/components/chat/page-agent';
import { CountPeriod } from '@/components/stock/count-period';
import {
  ArrowLeftRight,
  Boxes,
  ChefHat,
  CircleAlert,
  CircleCheck,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  Info,
  Lightbulb,
  ListChecks,
  PackageMinus,
  PackageSearch,
  ShoppingBasket,
  Soup,
  Trash2,
  TriangleAlert,
  UtensilsCrossed,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import {
  Banner,
  Callout,
  Chips,
  Disclosure,
  GroupHeading,
  ItemRow,
  LedgerLine,
  LevelRow,
  SectionTabs,
  ToneIcon,
  UsageSplit,
  type SplitPart,
  type Tone,
} from '@/components/stock/parts';
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
import { aiConfigured } from '@/lib/llm-gateway';
import {
  formatBDT,
  formatBps,
  formatDhakaDate,
  formatDhakaDay,
  formatNumber,
  type Locale,
} from '@/lib/i18n/format';
import { addDays, weekday } from '@/lib/time/business-date';
import { logWasteAction, setLossLineAction, startCountAction } from '@/modules/inventory/actions';
import { formatQuantity } from '@/modules/inventory/format';
import {
  stockLots,
  stockStatus,
  stockVariance,
  varianceBridge,
  wasteBoard,
  type LotRow,
  type StockRow,
  type VarianceRow,
} from '@/modules/inventory/queries';
import {
  daysInclusive,
  DEFAULT_LOSS_LINE_BPS,
  groupLevels,
  lossKind,
  lossTotal,
  splitLoss,
  staffFoodTotal,
} from '@/modules/inventory/simple';
import { businessToday } from '@/modules/metrics/queries';
import type { BaseUnit, PurchaseUnit } from '@/modules/purchasing/lines';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';
import { StockGuardCard } from '@/components/stock/guard-card';

const TABS = ['status', 'variance', 'waste'] as const;
type Tab = (typeof TABS)[number];

/**
 * Stock (ROADMAP Phase 5, simplified in ADR 0026). Three plain questions, each with its own icon:
 * what do I have, is anything missing, what did I throw away. Every figure still comes from the
 * Phase 5 metrics; this page only chooses words, icons and order — it never calculates a quantity.
 */
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

  const [t, tu, ta, locale] = await Promise.all([
    getTranslations('stock'),
    getTranslations('units'),
    getTranslations('agent'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const unit = (u: PurchaseUnit) => tu(u);
  // "6.4 kg" for a quick read; two decimals where a sum has to add up on screen.
  const qty = (q: number, b: BaseUnit) => formatQuantity(q, b, loc, unit, { maxDecimals: 1 });
  const qtyExact = (q: number, b: BaseUnit) => formatQuantity(q, b, loc, unit, { maxDecimals: 2 });
  // The loss view shows quantities in full (ADR 0027): the exact difference, never a rounded one.
  const qtyFull = (q: number, b: BaseUnit) => formatQuantity(q, b, loc, unit);
  const label = (name: string, nameBn: string | null) => (loc === 'bn' && nameBn ? nameBn : name);
  // A business day as a date in the reader's language and digits (06:00Z is midday in Dhaka).
  const day = (d: string) => formatDhakaDate(new Date(`${d}T06:00:00Z`), loc);
  // The same, short and with its weekday, for a lot's countdown ("Sat, 28 Sept").
  const shortDay = (d: string) => formatDhakaDay(new Date(`${d}T06:00:00Z`), loc);
  const title = (
    <PageTitle title={t('title')} subtitle={t('subtitle')} actions={<LocaleSwitcher />} />
  );

  if (!branch) {
    return (
      <>
        {title}
        <EmptyState title={t('noBranch')} />
      </>
    );
  }
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams({ tab, branch: branch.id, ...over });
    return `/${ctx.org.slug}/stock?${q.toString()}`;
  };
  const tabHref = (key: Tab) =>
    `/${ctx.org.slug}/stock?${new URLSearchParams({ tab: key, branch: branch.id }).toString()}`;
  const { date: today } = await businessToday(ctx.org.id);
  const supabase = await createClient();
  /** Every ingredient of the org, paged past the API's row cap so none is left out of a picker. */
  const allIngredients = async () => {
    const rows: { id: string; name: string; name_bn: string | null; base: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from('ingredients')
        .select('id, name, name_bn, base')
        .eq('org_id', ctx.org.id)
        .order('name')
        .order('id')
        .range(from, from + 999);
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < 1000) return { data: rows };
    }
  };
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );

  // Today's counts decide whether to offer "continue"; the weekday decides whether today is count day.
  const [{ data: settings }, { data: todaysCounts }] = await Promise.all([
    supabase
      .from('org_settings')
      .select('count_weekday, loss_line_bps, guided_count_size')
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
    supabase
      .from('stock_counts')
      .select('id, status, kind, counted_on')
      .eq('org_id', ctx.org.id)
      .eq('branch_id', branch.id)
      .eq('counted_on', today),
  ]);
  const lossLine = Number(settings?.loss_line_bps ?? DEFAULT_LOSS_LINE_BPS);
  const quickSize = Number(settings?.guided_count_size ?? 12);
  const openCount = (todaysCounts ?? []).find((c) => c.status === 'open');
  const countDue =
    weekday(today) === Number(settings?.count_weekday ?? 0) &&
    !(todaysCounts ?? []).some((c) => c.status === 'submitted');

  /** "Count your shelf": the one thing the owner does by hand, in two plain buttons. */
  const countCard = (lastCounted: string | null) => {
    if (!canCount) return null;
    // How long ago, in words: "today", "3 days ago". A week or more is the nudge to count again.
    const daysAgo = lastCounted ? Math.max(daysInclusive(lastCounted, today) - 1, 0) : null;
    const stale = daysAgo === null || daysAgo >= 8;
    const options = [
      {
        kind: 'guided_weekly',
        icon: <ListChecks />,
        hint: t('count.quickHint', { count: quickSize }),
      },
      { kind: 'full', icon: <ClipboardList />, hint: t('count.fullHint') },
    ] as const;
    return (
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <ToneIcon
            tone={stale ? 'warning' : 'info'}
            icon={<ClipboardCheck />}
            className="size-12"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{t('count.title')}</h2>
            <p className="mt-0.5 text-sm text-secondary">{t('count.body')}</p>
            <p className={`mt-1.5 text-sm font-medium ${stale ? 'text-warning' : ''}`}>
              {lastCounted && daysAgo !== null
                ? `${t('count.last', { date: day(lastCounted) })} · ${
                    daysAgo === 0 ? t('count.today') : t('count.ago', { days: daysAgo })
                  }`
                : t('count.never')}
            </p>
          </div>
        </div>
        {openCount ? (
          <Link
            href={`/${ctx.org.slug}/stock/count/${openCount.id as string}`}
            className={`${buttonVariants()} mt-4 w-full`}
          >
            {t('continueCount')}
          </Link>
        ) : null}
        <p className="mt-4 mb-2 text-sm font-semibold">{t('count.choose')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map(({ kind, icon, hint }) => (
            <form key={kind} action={startCountAction}>
              {hidden}
              <input type="hidden" name="branchId" value={branch.id} />
              <input type="hidden" name="kind" value={kind} />
              <button
                type="submit"
                className="glass-tile flex w-full items-center gap-3 rounded-input p-3 text-start transition hover:border-purple/40 focus-visible:outline-2 focus-visible:outline-purple"
              >
                <ToneIcon tone="info" icon={icon} className="size-10" solid />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{t(`start.${kind}`)}</span>
                  <span className="block text-sm text-secondary">{hint}</span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-5 shrink-0 text-secondary rtl:rotate-180"
                />
              </button>
            </form>
          ))}
        </div>
      </Card>
    );
  };

  /** The whole idea in three pictures, for someone who has never kept a stock book. */
  const howItWorks = (open: boolean) => (
    <Card className="p-4 sm:p-5">
      <Disclosure summary={t('how.title')} icon={<Lightbulb />} open={open}>
        <ol className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['buy', <ShoppingBasket key="buy" />, 'info'],
              ['sell', <UtensilsCrossed key="sell" />, 'warning'],
              ['count', <ClipboardCheck key="count" />, 'success'],
            ] as const
          ).map(([key, icon, tone], i) => (
            <li key={key} className="glass-tile flex items-start gap-3 rounded-input p-3.5">
              <ToneIcon tone={tone} icon={icon} className="size-11" solid />
              <div className="min-w-0">
                <p className="font-semibold">
                  {`${formatNumber(i + 1, loc)}. ${t(`how.${key}Title`)}`}
                </p>
                <p className="mt-0.5 text-sm text-secondary">{t(`how.${key}Body`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </Disclosure>
    </Card>
  );

  return (
    <>
      {title}
      {ctx.branches.length > 1 ? (
        <PillNav
          label={t('branches')}
          className="mb-4"
          items={ctx.branches.map((b) => ({
            href: `/${ctx.org.slug}/stock?${new URLSearchParams({ tab, branch: b.id }).toString()}`,
            label: b.name,
            active: b.id === branch.id,
          }))}
        />
      ) : null}
      <SectionTabs
        label={t('sections')}
        tabs={(
          [
            { key: 'status', icon: <Boxes />, tone: 'info' },
            { key: 'variance', icon: <PackageSearch />, tone: 'warning' },
            { key: 'waste', icon: <Trash2 />, tone: 'danger' },
          ] satisfies { key: Tab; icon: React.ReactNode; tone: Tone }[]
        ).map((x) => ({
          ...x,
          href: tabHref(x.key),
          label: t(`tabs.${x.key}`),
          hint: t(`tabHints.${x.key}`),
          active: x.key === tab,
        }))}
      />

      {tab === 'status'
        ? await (async () => {
            const [rows, lotRows] = await Promise.all([
              stockStatus(ctx.org.id, branch.id),
              stockLots(ctx.org.id, branch.id).catch(() => [] as LotRow[]),
            ]);
            const groups = groupLevels(rows);
            const lots = new Map(
              lotRows.filter((l) => l.branch_id === branch.id).map((l) => [l.ingredient_id, l]),
            );
            /** ADR 0029: the latest lot, as the purchaser said it — a countdown, then "days are up". */
            const lotNote = (l: LotRow | undefined): { text: string; tone: Tone } | undefined => {
              if (!l) return undefined;
              const bought = t('lot.bought', {
                date: shortDay(l.bought_on),
                days: t('lot.days', { count: l.for_days }),
              });
              if (l.status === 'ended')
                return { text: `${bought} · ${t('lot.ended')}`, tone: 'neutral' };
              const short =
                l.prev_for_days !== null &&
                l.prev_lasted_days !== null &&
                l.prev_lasted_days < l.prev_for_days;
              return {
                text: [
                  bought,
                  // "day 2 of 3", so it is never mixed up with how long the shelf will last.
                  l.days_left <= 1
                    ? t('lot.lastDay')
                    : t('lot.dayOf', {
                        n: formatNumber(l.for_days - l.days_left + 1, loc),
                        total: formatNumber(l.for_days, loc),
                      }),
                  short
                    ? t('lot.lastTimeShort', {
                        lasted: t('lot.days', { count: l.prev_lasted_days! }),
                        planned: t('lot.days', { count: l.prev_for_days! }),
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                tone: short ? 'warning' : 'info',
              };
            };
            /** ADR 0030: what the recipes used over the same days as the daily average, and ≈. */
            const usedNote = (r: StockRow) => {
              const days = r.since_on ? daysInclusive(r.since_on, r.as_of) : 0;
              return [
                r.used_since_qty !== null && r.used_since_qty > 0 && days > 0
                  ? t('level.used', {
                      qty: qty(r.used_since_qty, r.base),
                      days: t('lot.days', { count: days }),
                    })
                  : null,
                r.avg_daily_qty !== null && r.avg_daily_qty > 0
                  ? t('level.perDay', { qty: qty(r.avg_daily_qty, r.base) })
                  : null,
                r.estimated ? t('level.estimate') : null,
              ]
                .filter(Boolean)
                .join(' · ');
            };
            const anyEstimate = rows.some((r) => r.estimated);
            const neverCounted = rows.length > 0 && rows.every((r) => r.stock_qty === null);
            const lastCounted = rows.reduce<string | null>(
              (latest, r) =>
                r.last_count_date && (!latest || r.last_count_date > latest)
                  ? r.last_count_date
                  : latest,
              null,
            );
            const names = groups.low.map((r) => label(r.name, r.name_bn));
            // How long it lasts, in a sentence: whole days once it is comfortable, a decimal when it is tight.
            const lasts = (d: number) =>
              d < 1
                ? t('level.lessThanDay')
                : t('level.daysLeft', { days: d < 10 ? Math.round(d * 10) / 10 : Math.round(d) });
            const sections = [
              { key: 'low', tone: 'danger', icon: <CircleAlert /> },
              { key: 'getting', tone: 'warning', icon: <TriangleAlert /> },
              { key: 'enough', tone: 'success', icon: <CircleCheck /> },
              { key: 'notCounted', tone: 'neutral', icon: <CircleHelp /> },
            ] as const;
            return (
              <div className="space-y-5">
                {sp.counted ? <Alert tone="success">{t('countSubmitted')}</Alert> : null}
                {countDue ? <Alert tone="warning">{t('countDue')}</Alert> : null}
                {rows.length > 0 ? (
                  neverCounted ? (
                    <Banner
                      tone="info"
                      icon={<ClipboardCheck />}
                      title={t('summary.neverTitle')}
                      body={t('summary.neverBody')}
                    />
                  ) : groups.low.length > 0 ? (
                    <Banner
                      tone="danger"
                      icon={<CircleAlert />}
                      title={t('summary.low', { count: groups.low.length })}
                      body={t('summary.lowBody')}
                    >
                      <Chips
                        items={names.slice(0, 6)}
                        more={
                          names.length > 6
                            ? t('summary.more', { count: names.length - 6 })
                            : undefined
                        }
                      />
                    </Banner>
                  ) : (
                    <Banner
                      tone="success"
                      icon={<CircleCheck />}
                      title={t('summary.ok')}
                      body={t('summary.okBody')}
                    />
                  )
                ) : null}
                {neverCounted ? howItWorks(true) : null}
                {countCard(lastCounted)}
                <StockGuardCard
                  orgId={ctx.org.id}
                  orgSlug={ctx.org.slug}
                  branchId={branch.id}
                  canHide={ctx.isOwner}
                />
                {rows.length === 0 ? (
                  <EmptyState title={t('noStock')} body={t('noStockBody')} />
                ) : (
                  <Card className="p-4 sm:p-6">
                    <CardTitle className={anyEstimate ? 'mb-1 text-lg' : 'mb-5 text-lg'}>
                      {t('levelsTitle')}
                    </CardTitle>
                    {anyEstimate ? <Hint className="mb-5">{t('level.estimateHint')}</Hint> : null}
                    <div className="space-y-6">
                      {sections.map(({ key, tone, icon }) =>
                        groups[key].length === 0 ? null : (
                          <section key={key}>
                            <GroupHeading tone={tone} icon={icon}>
                              {t(`level.${key}`)} ({formatNumber(groups[key].length, loc)})
                            </GroupHeading>
                            <ul className="space-y-2">
                              {groups[key].map((r) => {
                                const negative = r.stock_qty !== null && r.stock_qty < 0;
                                const counted = r.stock_qty !== null;
                                return (
                                  <LevelRow
                                    key={r.ingredient_id}
                                    tone={negative ? 'danger' : tone}
                                    icon={negative ? <CircleAlert /> : icon}
                                    name={label(r.name, r.name_bn)}
                                    note={
                                      !counted
                                        ? t('level.countIt')
                                        : negative
                                          ? t('level.negative')
                                          : r.days_of_cover === null
                                            ? t('noUsage')
                                            : lasts(r.days_of_cover)
                                    }
                                    noteTone={
                                      negative ? 'danger' : key === 'enough' ? 'neutral' : tone
                                    }
                                    detail={usedNote(r) || undefined}
                                    amount={
                                      counted
                                        ? `${r.estimated ? '≈ ' : ''}${qty(r.stock_qty!, r.base)}`
                                        : '—'
                                    }
                                    amountTone={negative ? 'danger' : 'neutral'}
                                    lot={lotNote(lots.get(r.ingredient_id))}
                                  />
                                );
                              })}
                            </ul>
                          </section>
                        ),
                      )}
                    </div>
                  </Card>
                )}
                {neverCounted ? null : howItWorks(false)}
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
              return (
                <div className="space-y-5">
                  <Banner
                    tone="info"
                    icon={<PackageSearch />}
                    title={t('needTwoCounts')}
                    body={t('needTwoCountsBody')}
                  />
                  {countCard(dates[0] ?? null)}
                  {howItWorks(true)}
                </div>
              );
            const to = dates.includes(sp.to ?? '') ? sp.to! : dates[0]!;
            const from =
              dates.includes(sp.from ?? '') && sp.from! < to
                ? sp.from!
                : (dates.find((d) => d < to) ?? dates[1]!);
            const rows = await stockVariance(ctx.org.id, branch.id, from, to);
            const groups = splitLoss(rows, lossLine);
            const overCount = groups.loss.length + groups.small.length;
            const total = lossTotal(rows);
            const staffTotal = staffFoodTotal(rows);
            const staffItems = rows.filter((r) => r.staff_food_qty > 0).length;
            const lineText = formatBps(lossLine, loc);
            const bridge = canSeeMoney
              ? ((await varianceBridge(ctx.org.id, branch.id, from, to).catch(() => [])).find(
                  (b) => b.branch_id === branch.id,
                ) ?? null)
              : null;

            /**
             * One ingredient (ADR 0027): the exact over- or under-usage, its ৳, and the sum behind it.
             * Quantities are shown in full (no rounding to one decimal) so the sums can be checked.
             */
            const row = (r: VarianceRow, open = false) => {
              const kind = lossKind(r, lossLine);
              const rowTone: Tone =
                kind === 'loss'
                  ? 'danger'
                  : kind === 'small'
                    ? 'warning'
                    : kind === 'under'
                      ? 'info'
                      : 'success';
              const Icon =
                kind === 'loss'
                  ? CircleAlert
                  : kind === 'small'
                    ? TriangleAlert
                    : kind === 'under'
                      ? Info
                      : CircleCheck;
              const moved = r.transfers_in_qty - r.transfers_out_qty;
              const amount = qtyFull(Math.abs(r.over_qty), r.base);
              const pct = r.over_bps === null ? null : formatBps(Math.abs(r.over_bps), loc);
              const over = kind === 'loss' || kind === 'small';
              const money =
                over && canSeeMoney && r.over_poisha !== null
                  ? formatBDT(r.over_poisha, loc)
                  : null;
              // ADR 0029: staff food is written-down waste kept out of over-usage, shown on its own.
              const staff = r.staff_food_qty > 0;
              const otherWaste = r.waste_qty - r.staff_food_qty;
              // The picture (UsageSplit): what the dishes needed, then the extra, which the zoom splits into
              // waste written down and what nobody explained. Quantities only, straight from the metric.
              const needText = qtyFull(r.usage_theoretical_qty, r.base);
              const reallyText = qtyFull(r.usage_actual_qty, r.base);
              const needed: SplitPart = {
                key: 'needed',
                label: t('loss.chart.needed'),
                value: needText,
                qty: r.usage_theoretical_qty,
                tone: 'success',
              };
              const chartMain: SplitPart[] =
                kind === 'under'
                  ? [
                      {
                        key: 'used',
                        label: t('loss.reallyUsed'),
                        value: reallyText,
                        qty: r.usage_actual_qty,
                        tone: 'success',
                      },
                      {
                        key: 'less',
                        label: t('loss.chart.less'),
                        value: amount,
                        qty: Math.abs(r.over_qty),
                        tone: 'info',
                      },
                    ]
                  : over
                    ? [
                        needed,
                        {
                          key: 'extra',
                          label: t('loss.chart.extra'),
                          value: amount,
                          qty: r.over_qty,
                          tone: rowTone,
                        },
                      ]
                    : [{ ...needed, value: reallyText, qty: r.usage_actual_qty }];
              // Written-down waste first; whatever is left of the extra was not explained. When more waste
              // was written down than the extra, all of the extra is explained.
              const explained = r.variance_qty >= 0 ? otherWaste : r.over_qty;
              const chartZoom = over
                ? {
                    title: t('loss.chart.zoomTitle'),
                    total: amount,
                    parts: [
                      {
                        key: 'waste',
                        label: t('loss.chart.waste'),
                        value: qtyFull(explained, r.base),
                        qty: explained,
                        tone: 'warning' as const,
                      },
                      {
                        key: 'unexplained',
                        label: t('loss.chart.unexplained'),
                        value: qtyFull(Math.max(r.variance_qty, 0), r.base),
                        qty: Math.max(r.variance_qty, 0),
                        tone: 'danger' as const,
                      },
                    ],
                  }
                : undefined;
              const chartAria =
                kind === 'under'
                  ? t('loss.chart.ariaUnder', { used: reallyText, needed: needText, less: amount })
                  : over
                    ? t('loss.chart.ariaOver', {
                        used: reallyText,
                        needed: needText,
                        extra: amount,
                      })
                    : t('loss.chart.ariaOn', { used: reallyText });
              const verdict =
                kind === 'onRecipe'
                  ? t('loss.verdict.onRecipe')
                  : kind === 'under'
                    ? t('loss.verdict.under', { qty: amount, pct: pct ?? '—' })
                    : pct === null
                      ? t('loss.verdict.overNoRecipe', { qty: amount })
                      : t('loss.verdict.over', { qty: amount, pct });
              const checks = over
                ? r.variance_qty > 0
                  ? (['portions', 'waste', 'moved'] as const)
                  : null
                : kind === 'under'
                  ? (['portions', 'bazar', 'count'] as const)
                  : null;
              return (
                <ItemRow
                  key={r.ingredient_id}
                  tone={rowTone}
                  icon={<Icon />}
                  name={label(r.name, r.name_bn)}
                  note={verdict}
                  noteTone={rowTone}
                  aside={money ?? undefined}
                  open={open}
                >
                  <UsageSplit
                    title={
                      kind === 'under' ? t('loss.chart.recipesTitle') : t('loss.chart.allTitle')
                    }
                    total={kind === 'under' ? needText : reallyText}
                    main={chartMain}
                    zoom={chartZoom}
                    ariaLabel={chartAria}
                  />
                  <div className="mt-4">
                    <Callout tone={rowTone} icon={<Icon />}>
                      {over ? null : (
                        <p className="font-medium">
                          {kind === 'under'
                            ? t('loss.underExplain', { qty: amount })
                            : t('loss.onRecipeExplain')}
                        </p>
                      )}
                      {money ? (
                        <p className="font-semibold">{t('loss.lossMoney', { amount: money })}</p>
                      ) : null}
                      {checks ? (
                        <>
                          <p className="mt-2 text-secondary">{t('loss.checksTitle')}</p>
                          <ul className="mt-1 list-disc space-y-1 ps-5 text-secondary">
                            {checks.map((c) => (
                              <li key={c}>
                                {t(`loss.checks.${kind === 'under' ? 'under' : 'over'}.${c}`)}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </Callout>
                    {staff ? (
                      <p className="mt-2 flex items-start gap-1.5 text-sm text-secondary">
                        <Soup aria-hidden className="mt-0.5 size-4 shrink-0" />
                        <span>
                          {canSeeMoney && r.staff_food_poisha !== null
                            ? t('loss.staffFoodMoney', {
                                qty: qtyFull(r.staff_food_qty, r.base),
                                amount: formatBDT(r.staff_food_poisha, loc),
                              })
                            : t('loss.staffFood', { qty: qtyFull(r.staff_food_qty, r.base) })}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  <Hint className="mt-2">{t('loss.rule', { pct: lineText })}</Hint>
                  <Disclosure
                    summary={t('loss.worked')}
                    className="mt-3 border-t border-line pt-1.5"
                  >
                    <div className="rounded-input bg-surface-elevated/60 px-3.5 py-1.5">
                      <LedgerLine
                        icon={<ClipboardCheck />}
                        label={t('loss.ledger.before', { date: day(r.opening_date) })}
                        value={qtyFull(r.opening_qty, r.base)}
                      />
                      <LedgerLine
                        icon={<ShoppingBasket />}
                        label={t('loss.ledger.bought')}
                        value={`+ ${qtyFull(r.purchases_qty, r.base)}`}
                      />
                      {moved === 0 ? null : (
                        <LedgerLine
                          icon={<ArrowLeftRight />}
                          label={t('loss.ledger.moved')}
                          value={`${moved > 0 ? '+' : '−'} ${qtyFull(Math.abs(moved), r.base)}`}
                        />
                      )}
                      <LedgerLine
                        icon={<ClipboardCheck />}
                        label={t('loss.ledger.after', { date: day(r.closing_date) })}
                        value={`− ${qtyFull(r.closing_qty, r.base)}`}
                      />
                      <LedgerLine
                        strong
                        icon={<PackageMinus />}
                        label={t('loss.ledger.used')}
                        value={qtyFull(r.usage_actual_qty, r.base)}
                      />
                      <LedgerLine
                        icon={<ChefHat />}
                        label={t('loss.ledger.recipes')}
                        value={`− ${qtyFull(r.usage_theoretical_qty, r.base)}`}
                      />
                      {staff ? (
                        <LedgerLine
                          icon={<Soup />}
                          label={t('loss.ledgerStaff')}
                          value={`− ${qtyFull(r.staff_food_qty, r.base)}`}
                        />
                      ) : null}
                      <LedgerLine
                        strong
                        tone={rowTone}
                        icon={<PackageSearch />}
                        label={t('loss.ledger.over')}
                        value={qtyFull(r.over_qty, r.base)}
                      />
                      <LedgerLine
                        icon={<Trash2 />}
                        label={t('loss.ledger.waste')}
                        value={qtyFull(otherWaste, r.base)}
                      />
                      <LedgerLine
                        icon={<CircleHelp />}
                        label={t('loss.ledger.unexplained')}
                        value={qtyFull(r.variance_qty, r.base)}
                      />
                    </div>
                  </Disclosure>
                </ItemRow>
              );
            };

            return (
              <div className="space-y-5">
                <div className="space-y-1">
                  <p className="text-sm text-secondary">
                    {t('loss.between', { from: day(from), to: day(to) })}
                  </p>
                  <Disclosure summary={t('loss.changeDates')}>
                    <CountPeriod
                      dates={dates}
                      from={from}
                      to={to}
                      basePath={`/${ctx.org.slug}/stock`}
                      params={{ tab: 'variance', branch: branch.id }}
                      locale={loc}
                      labels={{
                        presets: {
                          last: t('period.last'),
                          month: t('period.month'),
                          quarter: t('period.quarter'),
                          all: t('period.all'),
                        },
                        pickLast: t('period.pickLast'),
                        chosen: t.raw('period.chosen') as string,
                        show: t('show'),
                        prev: t('period.prev'),
                        next: t('period.next'),
                        legend: t('period.legend'),
                      }}
                    />
                  </Disclosure>
                </div>

                {overCount > 0 ? (
                  <Banner
                    tone={groups.loss.length > 0 ? 'danger' : 'warning'}
                    icon={groups.loss.length > 0 ? <CircleAlert /> : <TriangleAlert />}
                    title={
                      canSeeMoney
                        ? t('loss.titleMoney', { amount: formatBDT(total, loc) })
                        : t('loss.titleItems', { count: overCount })
                    }
                    body={canSeeMoney ? t('loss.bodyItems', { count: overCount }) : t('loss.body')}
                  />
                ) : (
                  <Banner
                    tone="success"
                    icon={<CircleCheck />}
                    title={t('loss.noLoss')}
                    body={t('loss.noLossBody')}
                  />
                )}

                {staffItems > 0 ? (
                  <Banner
                    tone="neutral"
                    icon={<Soup />}
                    title={
                      canSeeMoney
                        ? t('loss.staffTitleMoney', { amount: formatBDT(staffTotal, loc) })
                        : t('loss.staffTitleItems', { count: staffItems })
                    }
                    body={t('loss.staffBody')}
                  />
                ) : null}

                <Card className="p-4 sm:p-5">
                  <p className="text-sm">{t('loss.definition')}</p>
                  <p className="mt-1 text-sm font-semibold">{t('loss.line', { pct: lineText })}</p>
                  {ctx.isOwner ? (
                    <Disclosure summary={t('loss.lineChange')} className="mt-1">
                      <ActionForm
                        action={setLossLineAction}
                        successKey="stock.loss.lineSaved"
                        className="flex flex-wrap items-end gap-3"
                      >
                        {hidden}
                        <div>
                          <Label htmlFor="loss-line">{t('loss.lineLabel')}</Label>
                          <Input
                            id="loss-line"
                            name="pct"
                            inputMode="decimal"
                            defaultValue={String(lossLine / 100)}
                            className="w-28"
                            required
                          />
                        </div>
                        <Button type="submit" variant="secondary">
                          {t('loss.lineSave')}
                        </Button>
                        <Hint className="basis-full">{t('loss.lineHint')}</Hint>
                      </ActionForm>
                    </Disclosure>
                  ) : null}
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
                    {(
                      [
                        ['needed', 'neededHint', <ChefHat key="s" />],
                        ['extra', 'extraHint', <PackageMinus key="r" />],
                      ] as const
                    ).map(([name, hint, icon]) => (
                      <div
                        key={name}
                        className="glass-tile flex items-center gap-2.5 rounded-input p-2.5 sm:gap-3 sm:p-3"
                      >
                        <ToneIcon tone="neutral" icon={icon} className="size-9 sm:size-10" solid />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{t(`loss.chart.${name}`)}</p>
                          <p className="text-xs text-secondary">{t(`loss.chart.${hint}`)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                {groups.loss.length > 0 ? (
                  <section>
                    <GroupHeading tone="danger" icon={<CircleAlert />}>
                      {`${t('loss.groupLoss', { pct: lineText })} (${formatNumber(groups.loss.length, loc)})`}
                    </GroupHeading>
                    <ul className="space-y-3">{groups.loss.map((r, i) => row(r, i < 3))}</ul>
                  </section>
                ) : null}

                {groups.small.length > 0 ? (
                  <section>
                    <GroupHeading tone="warning" icon={<TriangleAlert />}>
                      {`${t('loss.groupSmall', { pct: lineText })} (${formatNumber(groups.small.length, loc)})`}
                    </GroupHeading>
                    <ul className="space-y-3">{groups.small.map((r) => row(r))}</ul>
                  </section>
                ) : null}

                {groups.under.length > 0 ? (
                  <section>
                    <GroupHeading tone="info" icon={<Info />}>
                      {`${t('loss.groupUnder')} (${formatNumber(groups.under.length, loc)})`}
                    </GroupHeading>
                    <p className="-mt-1 mb-2 text-sm text-secondary">{t('loss.underBody')}</p>
                    <ul className="space-y-3">{groups.under.map((r) => row(r))}</ul>
                  </section>
                ) : null}

                {groups.onRecipe.length > 0 ? (
                  <Card className="p-4 sm:p-5">
                    <Disclosure
                      icon={<CircleCheck />}
                      summary={t('loss.groupOnRecipe', { count: groups.onRecipe.length })}
                    >
                      <ul className="space-y-3">{groups.onRecipe.map((r) => row(r))}</ul>
                    </Disclosure>
                  </Card>
                ) : null}

                {bridge ? (
                  <Card className="p-4 sm:p-5">
                    <Disclosure summary={t('bridgeTitle')} icon={<ChefHat />}>
                      <p className="mb-3 max-w-3xl text-sm text-secondary">{t('bridgeBody')}</p>
                      <dl className="space-y-2 text-sm">
                        {(
                          [
                            ['tfc', bridge.tfc_standard_poisha, false],
                            ['waste', bridge.waste_poisha, true],
                            ['price', bridge.price_effect_poisha, true],
                            ['unexplained', bridge.unexplained_poisha, true],
                          ] as const
                        ).map(([k, v, signed]) => (
                          <div
                            key={k}
                            className="glass-tile flex justify-between gap-2 rounded-input px-4 py-2.5"
                          >
                            <dt>{t(`bridge.${k}`)}</dt>
                            <dd
                              className={`font-semibold tabular-nums ${signed && v > 0 ? 'text-danger' : ''}`}
                            >
                              {signed && v > 0 ? '+' : ''}
                              {formatBDT(v, loc)}
                            </dd>
                          </div>
                        ))}
                        <div className="flex justify-between gap-2 rounded-input border-t border-line px-4 pt-3">
                          <dt className="font-bold">{t('bridge.actual')}</dt>
                          <dd className="text-lg font-extrabold tabular-nums">
                            {formatBDT(bridge.cogs_actual_poisha, loc)}
                          </dd>
                        </div>
                      </dl>
                      <p className="mt-3 text-sm text-secondary">
                        {t('bridgeFoot', {
                          band: formatBDT(bridge.uncertainty_poisha, loc),
                          pct:
                            bridge.cogs_pct_of_sales_bps === null
                              ? '—'
                              : formatBps(bridge.cogs_pct_of_sales_bps, loc),
                        })}
                      </p>
                      {bridge.uncosted_ingredients > 0 ? (
                        <Hint>{t('bridgeUncosted', { count: bridge.uncosted_ingredients })}</Hint>
                      ) : null}
                    </Disclosure>
                  </Card>
                ) : null}
              </div>
            );
          })()
        : null}

      {tab === 'waste'
        ? await (async () => {
            const days = sp.days === '30' ? 30 : 7;
            const [
              board,
              { data: reasons },
              { data: ingredients },
              { data: items },
              { data: noteRows },
            ] = await Promise.all([
              wasteBoard(ctx.org.id, branch.id, addDays(today, -(days - 1)), today).catch(() => []),
              supabase
                .from('reason_codes')
                .select('id, label, label_bn')
                .eq('org_id', ctx.org.id)
                .eq('kind', 'waste')
                .eq('is_active', true)
                .order('label'),
              // Every item, straight from the records on each visit: a new ingredient is here the
              // moment it exists, even with nothing wasted yet. Hidden (retired) items stay listed
              // too, so a spill of something no longer bought can still be written down.
              allIngredients(),
              supabase
                .from('menu_items')
                .select('id, name, name_bn')
                .eq('org_id', ctx.org.id)
                .eq('is_active', true)
                .order('name'),
              supabase
                .from('waste_logs')
                .select('note, menu_item_id, ingredient_id, reason_code_id')
                .eq('org_id', ctx.org.id)
                .eq('branch_id', branch.id)
                .not('note', 'is', null)
                .gte('business_date', addDays(today, -(days - 1)))
                .lte('business_date', today)
                .order('logged_at', { ascending: false }),
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
                        label: t('lastDays', { days: formatNumber(d, loc) }),
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
                            {(noteRows ?? [])
                              .filter(
                                (n) =>
                                  n.reason_code_id === r.reason_code_id &&
                                  (n.menu_item_id ?? n.ingredient_id) ===
                                    (r.menu_item_id ?? r.ingredient_id),
                              )
                              .map((n, k) => (
                                <p key={k} className="mt-1 text-sm">
                                  {`“${n.note}”`}
                                </p>
                              ))}
                          </div>
                          <div className="text-end text-sm tabular-nums">
                            <p>
                              {r.qty_base !== null && r.base
                                ? qtyExact(r.qty_base, r.base)
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
      {/* The AI helper is for the people who can use the assistant (owner, manager, accountant). */}
      {['owner', 'manager', 'accountant'].some(has) ? (
        <>
          {/* Room under the last card so the helper button never covers it. */}
          <div aria-hidden className="h-20" />
          <PageAgent
            page="stock"
            pageNote={`${tab} tab, ${branch.name}`}
            key={`${tab}:${branch.id}`}
            orgId={ctx.org.id}
            orgSlug={ctx.org.slug}
            aiOn={aiConfigured()}
            labels={{
              open: ta('stock.open'),
              title: ta('stock.title'),
              subtitle: ta('stock.subtitle'),
              placeholder: ta('stock.placeholder'),
            }}
            summaryQuestion={ta(`stockAsk.${tab}`, { branch: branch.name })}
            followUps={(
              {
                status: ['lowFirst', 'buy', 'bought'],
                variance: ['lossWhy', 'check'],
                waste: ['wasteWhy', 'wasteCut'],
              } satisfies Record<Tab, string[]>
            )[tab].map((k) => ta(`stockAsk.${k}`))}
          />
        </>
      ) : null}
    </>
  );
}
