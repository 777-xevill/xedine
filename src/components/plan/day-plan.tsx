import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  ChefHat,
  Circle,
  ClipboardCheck,
  Clock,
  HandCoins,
  Info,
  Minus,
  PackageMinus,
  PartyPopper,
  Scale,
  ShoppingBasket,
  Trash2,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, Hint, Input, Label, Select, Textarea } from '@/components/ui/form';
import { formatNumber, formatTime, type Locale } from '@/lib/i18n/format';
import { addDays } from '@/lib/time/business-date';
import { savePlannedOrderAction, setPlannedOrderStatusAction } from '@/modules/forecasting/actions';
import type { DayPlanStep, DayStep, PlannedOrder, StepState } from '@/modules/forecasting/queries';

/** One dish on the party-order form, with its sizes (value "itemId" or "itemId:sizeId"). */
export interface PartyDish {
  id: string;
  name: string;
  sizes: { id: string; name: string }[];
}

const STATE_LOOK: Record<StepState, { tone: BadgeTone; icon: React.ReactNode }> = {
  done: { tone: 'success', icon: <CheckCircle2 /> },
  todo: { tone: 'warning', icon: <Circle /> },
  attention: { tone: 'warning', icon: <AlertTriangle /> },
  later: { tone: 'neutral', icon: <Clock /> },
  info: { tone: 'info', icon: <Info /> },
  none: { tone: 'neutral', icon: <Minus /> },
};

const STEP_ICON: Record<DayStep | 'cook', React.ComponentType<{ className?: string }>> = {
  party_orders: PartyPopper,
  use_first: TriangleAlert,
  running_low: PackageMinus,
  checks: ClipboardCheck,
  cook: ChefHat,
  bazar: ShoppingBasket,
  unpaid: HandCoins,
  cash_close: Wallet,
  waste: Trash2,
  count: Scale,
  tomorrow_bazar: CalendarCheck,
};

const PARTY_ROWS = 6;
/** Steps that count towards "N of M done": the ones a person acts on. */
const COUNTED: StepState[] = ['done', 'todo', 'attention', 'later'];

export async function DayPlan({
  orgId,
  orgSlug,
  branchId,
  date,
  today,
  locale,
  canEdit,
  headline,
  reasons,
  busyDishes,
  steps,
  orders,
  dishes,
}: {
  orgId: string;
  orgSlug: string;
  branchId: string;
  date: string;
  today: string;
  locale: Locale;
  canEdit: boolean;
  headline: string;
  reasons: string[];
  /** The dishes that might sell the most that day, already in the screen's language. */
  busyDishes: string[];
  steps: DayPlanStep[];
  orders: PlannedOrder[];
  dishes: PartyDish[];
}) {
  const t = await getTranslations('plan');
  const num = (v: number) => formatNumber(v, locale);
  const by = new Map(steps.map((s) => [s.step, s]));
  const plan = (over: Record<string, string>) =>
    `/${orgSlug}/plan?${new URLSearchParams({ branch: branchId, date, ...over }).toString()}`;
  const stock = (tab: string) =>
    `/${orgSlug}/stock?${new URLSearchParams({ tab, branch: branchId }).toString()}`;
  const plates = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.lines.reduce((s, l) => s + l.qty, 0), 0);
  const bazarStatus = String(by.get('bazar')?.info?.status ?? 'none');

  // The steps in the day's order, each with its words and where to act on it.
  type Row = {
    key: DayStep | 'cook';
    state: StepState;
    body: string;
    href?: string;
    link?: string;
  };
  const step = (key: DayStep): DayPlanStep | undefined => by.get(key);
  const n = (key: DayStep) => step(key)?.n ?? 0;
  const before: Row[] = [
    {
      key: 'party_orders',
      state: step('party_orders')?.state ?? 'none',
      body: t('dayPlan.steps.party_orders.body', { count: n('party_orders'), plates: num(plates) }),
      href: '#party-orders',
      link: t('dayPlan.steps.party_orders.link'),
    },
    {
      key: 'use_first',
      state: step('use_first')?.state ?? 'none',
      body: t('dayPlan.steps.use_first.body', { count: n('use_first') }),
      href: `/${orgSlug}/food-safety`,
      link: t('dayPlan.steps.use_first.link'),
    },
    {
      key: 'running_low',
      state: step('running_low')?.state ?? 'none',
      body: t('dayPlan.steps.running_low.body', { count: n('running_low') }),
      href: stock('status'),
      link: t('dayPlan.steps.running_low.link'),
    },
    {
      key: 'checks',
      state: step('checks')?.state ?? 'none',
      body:
        step('checks')?.state === 'none'
          ? t('dayPlan.steps.checks.bodyNone')
          : t('dayPlan.steps.checks.body', { count: n('checks') }),
      href: `/${orgSlug}/daily-checks`,
      link: t('dayPlan.steps.checks.link'),
    },
  ];
  const cook: Row[] = [
    {
      key: 'cook',
      state: busyDishes.length > 0 ? 'info' : 'none',
      body:
        busyDishes.length > 0
          ? t('dayPlan.steps.cook.body', { dishes: busyDishes.join(', ') })
          : t('dayPlan.steps.cook.bodyNone'),
      href: plan({ tab: 'prep' }),
      link: t('dayPlan.steps.cook.link'),
    },
    {
      key: 'bazar',
      state: step('bazar')?.state ?? 'todo',
      body: t(`dayPlan.steps.bazar.${bazarStatus as 'none'}`, { count: n('bazar') }),
      href: plan({ tab: 'bazar' }),
      link: t('dayPlan.steps.bazar.link'),
    },
  ];
  const closing: Row[] =
    date === today
      ? [
          {
            key: 'unpaid' as const,
            state: step('unpaid')?.state ?? 'none',
            body: t('dayPlan.steps.unpaid.body', { count: n('unpaid') }),
            href: '/pos',
            link: t('dayPlan.steps.unpaid.link'),
          },
          {
            key: 'cash_close' as const,
            state: step('cash_close')?.state ?? 'none',
            body:
              step('cash_close')?.state === 'none'
                ? t('dayPlan.steps.cash_close.bodyNone')
                : t('dayPlan.steps.cash_close.body', { count: n('cash_close') }),
            href: '/pos',
            link: t('dayPlan.steps.cash_close.link'),
          },
          {
            key: 'waste' as const,
            state: step('waste')?.state ?? 'later',
            body: t('dayPlan.steps.waste.body', { count: n('waste') }),
            href: stock('waste'),
            link: t('dayPlan.steps.waste.link'),
          },
          ...(step('count')
            ? [
                {
                  key: 'count' as const,
                  state: step('count')!.state,
                  body:
                    step('count')!.state === 'done'
                      ? t('dayPlan.steps.count.bodyDone')
                      : t('dayPlan.steps.count.body'),
                  href: stock('status'),
                  link: t('dayPlan.steps.count.link'),
                },
              ]
            : []),
          {
            key: 'tomorrow_bazar' as const,
            state: step('tomorrow_bazar')?.state ?? 'later',
            body:
              step('tomorrow_bazar')?.state === 'done'
                ? t('dayPlan.steps.tomorrow_bazar.bodyDone')
                : t('dayPlan.steps.tomorrow_bazar.body'),
            href: plan({ tab: 'bazar', date: addDays(today, 1) }),
            link: t('dayPlan.steps.tomorrow_bazar.link'),
          },
        ]
      : [];
  const all = [...before, ...cook, ...closing];
  const counted = all.filter((r) => COUNTED.includes(r.state));
  const done = counted.filter((r) => r.state === 'done').length;

  const section = (title: string, rows: Row[]) =>
    rows.length === 0 ? null : (
      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold tracking-wide text-secondary uppercase">
          {title}
        </h3>
        <ol className="space-y-2">
          {rows.map((r) => {
            const Icon = STEP_ICON[r.key];
            const look = STATE_LOOK[r.state];
            return (
              <li key={r.key} className="glass-tile flex items-start gap-3 rounded-input p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-elevated">
                  <Icon aria-hidden className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{t(`dayPlan.steps.${r.key}.title`)}</p>
                    <Badge tone={look.tone} icon={look.icon}>
                      {t(`dayPlan.state.${r.state}`)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-secondary">{r.body}</p>
                </div>
                {r.href && r.link ? (
                  <Link
                    href={r.href}
                    className="shrink-0 self-center text-sm font-medium text-purple hover:underline"
                  >
                    {r.link}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    );

  const hidden = (
    <>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
    </>
  );
  // A time on the restaurant's clock, shown as itself.
  const timeOf = (hhmm: string) =>
    formatTime(new Date(`${date}T${hhmm.slice(0, 5)}:00Z`), locale, 'UTC');

  return (
    <>
      <Card className="mb-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold">{headline}</h2>
            {reasons.length > 0 ? (
              <p className="mt-1 text-sm text-secondary">
                {t('forecastReasons', { reasons: reasons.join(', ') })}
              </p>
            ) : null}
          </div>
          {counted.length > 0 ? (
            <div className="min-w-[10rem]">
              <p className="text-sm font-semibold">
                {t('dayPlan.progress', { done: num(done), total: num(counted.length) })}
              </p>
              <div
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-elevated"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={counted.length}
                aria-valuenow={done}
                aria-label={t('dayPlan.progressLabel')}
              >
                <div
                  className="h-full rounded-full bg-brand-yellow transition-[width] duration-500"
                  style={{ width: `${Math.round((done / counted.length) * 100)}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
        <Hint className="mt-3">{t('dayPlan.body')}</Hint>
      </Card>

      {section(t('dayPlan.sections.before'), before)}
      {section(t('dayPlan.sections.cook'), cook)}
      {section(t('dayPlan.sections.close'), closing)}

      <Card id="party-orders" className="scroll-mt-24 p-4 sm:p-6">
        <CardTitle>{t('party.title')}</CardTitle>
        <p className="-mt-1 mb-4 max-w-3xl text-sm text-secondary">{t('party.body')}</p>
        {orders.length === 0 ? (
          <p className="mb-4 text-sm text-muted">{t('party.none')}</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {orders.map((o) => (
              <li
                key={o.id}
                className={`glass-tile rounded-input p-3 text-sm ${o.status === 'cancelled' ? 'opacity-60' : ''}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {o.title}
                    {o.ready_at ? (
                      <span className="ms-2 font-normal text-secondary">
                        {t('party.readyLine', { time: timeOf(o.ready_at) })}
                      </span>
                    ) : null}
                  </p>
                  <Badge
                    tone={o.status === 'planned' ? 'warning' : 'neutral'}
                    icon={
                      o.status === 'done' ? (
                        <CheckCircle2 />
                      ) : o.status === 'cancelled' ? (
                        <Minus />
                      ) : (
                        <Clock />
                      )
                    }
                  >
                    {t(`party.status.${o.status}`)}
                  </Badge>
                </div>
                <p className="mt-1">
                  {o.lines
                    .map((l) =>
                      t('party.line', {
                        qty: num(l.qty),
                        dish: [
                          locale === 'bn' && l.name_bn ? l.name_bn : l.name,
                          locale === 'bn' && l.size_bn ? l.size_bn : l.size,
                        ]
                          .filter(Boolean)
                          .join(' — '),
                      }),
                    )
                    .join(' · ')}
                </p>
                {o.note ? <p className="mt-1 text-secondary">{o.note}</p> : null}
                {canEdit ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(o.status === 'planned'
                      ? (['done', 'cancelled'] as const)
                      : (['planned'] as const)
                    ).map((status) => (
                      <form key={status} action={setPlannedOrderStatusAction}>
                        {hidden}
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="status" value={status} />
                        <Button type="submit" size="sm" variant="secondary">
                          {t(`party.set.${status}`)}
                        </Button>
                      </form>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit && dishes.length > 0 ? (
          <details className="glass-tile rounded-input p-4 text-sm" open={orders.length === 0}>
            <summary className="cursor-pointer font-medium">{t('party.add')}</summary>
            <ActionForm
              action={savePlannedOrderAction}
              successKey="plan.party.saved"
              className="mt-3 space-y-3"
            >
              {hidden}
              <input type="hidden" name="branchId" value={branchId} />
              <input type="hidden" name="date" value={date} />
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                <div>
                  <Label htmlFor="party-title">{t('party.name')}</Label>
                  <Input
                    id="party-title"
                    name="title"
                    required
                    maxLength={120}
                    placeholder={t('party.namePlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="party-ready">{t('party.readyAt')}</Label>
                  <Input id="party-ready" name="readyAt" type="time" />
                </div>
              </div>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">{t('party.dishes')}</legend>
                {Array.from({ length: PARTY_ROWS }, (_, i) => (
                  <div key={i} className="grid grid-cols-[1fr_6rem] gap-2">
                    <Select
                      name={`dish-${i}`}
                      aria-label={t('party.dish')}
                      defaultValue=""
                      className="min-h-10 w-full"
                    >
                      <option value="">{t('party.pickDish')}</option>
                      {dishes.map((d) => [
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>,
                        ...d.sizes.map((s) => (
                          <option key={`${d.id}:${s.id}`} value={`${d.id}:${s.id}`}>
                            {`${d.name} — ${s.name}`}
                          </option>
                        )),
                      ])}
                    </Select>
                    <Input
                      name={`qty-${i}`}
                      inputMode="numeric"
                      aria-label={t('party.plates')}
                      placeholder={t('party.plates')}
                      className="min-h-10 text-end"
                    />
                  </div>
                ))}
                <Hint>{t('party.hint')}</Hint>
              </fieldset>
              <div>
                <Label htmlFor="party-note">{t('party.note')}</Label>
                <Textarea id="party-note" name="note" maxLength={300} rows={2} />
              </div>
              <Button type="submit">{t('party.save')}</Button>
            </ActionForm>
          </details>
        ) : null}
      </Card>
    </>
  );
}
