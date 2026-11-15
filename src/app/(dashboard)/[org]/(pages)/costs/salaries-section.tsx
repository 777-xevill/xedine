import { ChevronLeft, ChevronRight, CopyPlus } from 'lucide-react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, EmptyState, Hint, Input, Label, Select } from '@/components/ui/form';
import {
  formatBDT,
  formatDhakaDate,
  formatDhakaMonth,
  formatNumber,
  type Locale,
} from '@/lib/i18n/format';
import {
  copySalariesAction,
  markAllSalariesPaidAction,
  markSalaryPaidAction,
  setSalaryAction,
  unmarkSalaryPaidAction,
} from '@/modules/costs/actions';

const METHODS = ['cash', 'bkash', 'nagad', 'bank', 'other'] as const;

export interface SalaryEntryRow {
  staff_id: string;
  salary_poisha: number | string;
  allowances_poisha: number | string;
  paid_poisha: number | string;
  paid_on: string | null;
  paid_method: (typeof METHODS)[number] | null;
  notes: string | null;
}

export interface StaffRow {
  id: string;
  display_name: string;
  role: string;
  branch_id: string;
}

/** A business date "2026-11-14" as noon in Dhaka, for the shared date formatters. */
const noon = (day: string) => new Date(`${day}T12:00:00+06:00`);

/**
 * Costs → Salaries (ADR 0060): one month at a time. The owner types each person's pay, marks who has been
 * paid (all, part or none) with the day and the way, and sees what is still owed, so no paper is needed.
 * Owner only: every figure here is money (ADR 0007). Marking paid never changes a profit figure.
 */
export async function SalariesSection({
  orgId,
  orgSlug,
  month,
  prevMonth,
  nextMonth,
  today,
  hasPrevious,
  staff,
  entries,
  branches,
}: {
  orgId: string;
  orgSlug: string;
  month: string;
  prevMonth: string;
  nextMonth: string | null;
  today: string;
  hasPrevious: boolean;
  staff: StaffRow[];
  entries: SalaryEntryRow[];
  branches: { id: string; name: string }[];
}) {
  const [t, tr, locale] = await Promise.all([
    getTranslations('costs'),
    getTranslations('roles'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const money = (p: number) => formatBDT(p, loc);
  const plain = (p: number) => formatBDT(p, 'en', { symbol: false });
  const by = new Map(entries.map((e) => [e.staff_id, e]));
  const totalOf = (e: SalaryEntryRow) => Number(e.salary_poisha) + Number(e.allowances_poisha);
  const base = `/${orgSlug}/costs?tab=salaries`;

  // What is entered, added up (nothing is estimated).
  const entered = staff.filter((s) => by.has(s.id));
  const totalPay = entered.reduce((n, s) => n + totalOf(by.get(s.id)!), 0);
  const totalPaid = entered.reduce((n, s) => n + Number(by.get(s.id)!.paid_poisha), 0);
  const fullyPaid = entered.filter((s) => {
    const e = by.get(s.id)!;
    return totalOf(e) > 0 && Number(e.paid_poisha) >= totalOf(e);
  }).length;
  const stillOwed = entered.some((s) => {
    const e = by.get(s.id)!;
    return Number(e.paid_poisha) < totalOf(e);
  });
  const missing = staff.length - entered.length;
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '';
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="month" value={month} />
    </>
  );
  const methodSelect = (id: string, current: string) => (
    <Select id={id} name="method" defaultValue={current}>
      {METHODS.map((m) => (
        <option key={m} value={m}>
          {t(`methods.${m}`)}
        </option>
      ))}
    </Select>
  );
  const monthName = formatDhakaMonth(noon(`${month}-15`), loc);
  const tiles = [
    { label: t('salPeople'), value: formatNumber(staff.length, loc), hint: t('salPeopleHint') },
    { label: t('salTotal'), value: money(totalPay), hint: monthName },
    { label: t('salPaid'), value: money(totalPaid), hint: null },
    { label: t('salOwed'), value: money(Math.max(totalPay - totalPaid, 0)), hint: null },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`${base}&month=${prevMonth}`}
          aria-label={t('salPrev')}
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          <ChevronLeft aria-hidden className="size-4 rtl:rotate-180" />
        </Link>
        <h2 className="min-w-40 text-center text-lg font-semibold">{monthName}</h2>
        {nextMonth ? (
          <Link
            href={`${base}&month=${nextMonth}`}
            aria-label={t('salNext')}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <ChevronRight aria-hidden className="size-4 rtl:rotate-180" />
          </Link>
        ) : (
          <span className="size-9" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <Card key={x.label} className="p-4">
            <p className="text-sm text-secondary">{x.label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{x.value}</p>
            {x.hint ? <p className="text-xs text-secondary">{x.hint}</p> : null}
          </Card>
        ))}
      </div>

      {staff.length === 0 ? (
        <Card>
          <EmptyState title={t('noStaff')} />
        </Card>
      ) : (
        <>
          <Card className="space-y-4 p-4">
            <p className="font-semibold">
              {t('salProgress', {
                paid: formatNumber(fullyPaid, loc),
                total: formatNumber(staff.length, loc),
              })}
            </p>
            <p className="text-sm text-secondary">{t('salaryBody')}</p>
            {missing > 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-medium">
                  {t('salNoPayLine', { n: formatNumber(missing, loc) })}
                </p>
                {hasPrevious ? (
                  <form action={copySalariesAction} className="flex flex-wrap items-center gap-2">
                    {hidden}
                    <Button type="submit" size="sm" variant="secondary">
                      <CopyPlus aria-hidden className="size-4" />
                      {t('copyPrev')}
                    </Button>
                    <Hint>{t('copyPrevHint')}</Hint>
                  </form>
                ) : null}
              </div>
            ) : null}
            {stillOwed ? (
              <form
                action={markAllSalariesPaidAction}
                className="grid gap-3 rounded-input border border-line p-3 sm:grid-cols-4 sm:items-end"
              >
                {hidden}
                <div className="sm:col-span-4">
                  <p className="text-sm font-semibold">{t('markAllTitle')}</p>
                  <Hint>{t('markAllBody')}</Hint>
                </div>
                <div>
                  <Label htmlFor="all-day">{t('paidOn')}</Label>
                  <Input
                    id="all-day"
                    name="paidOn"
                    type="date"
                    max={today}
                    defaultValue={today}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="all-method">{t('method')}</Label>
                  {methodSelect('all-method', 'cash')}
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit">{t('markAllButton')}</Button>
                </div>
              </form>
            ) : null}
          </Card>

          <ul className="space-y-3">
            {staff.map((s) => {
              const e = by.get(s.id);
              const total = e ? totalOf(e) : 0;
              const paid = e ? Number(e.paid_poisha) : 0;
              const full = Boolean(e) && total > 0 && paid >= total;
              const part = Boolean(e) && paid > 0 && !full;
              const when = e?.paid_on ? formatDhakaDate(noon(e.paid_on), loc) : '';
              const how = e?.paid_method ? t(`methods.${e.paid_method}`) : '';
              return (
                <li key={s.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{s.display_name}</p>
                        <p className="text-xs text-secondary">
                          {branchName(s.branch_id)} · {tr(s.role)}
                        </p>
                      </div>
                      {!e ? (
                        <StatusBadge tone="neutral">{t('statusNoPay')}</StatusBadge>
                      ) : full ? (
                        <StatusBadge tone="success">{t('statusPaid')}</StatusBadge>
                      ) : part ? (
                        <StatusBadge tone="warning">{t('statusPart')}</StatusBadge>
                      ) : (
                        <StatusBadge tone="danger">{t('statusUnpaid')}</StatusBadge>
                      )}
                    </div>

                    {e && paid > 0 ? (
                      <p className="mt-2 text-sm">
                        {full
                          ? t('paidLine', { amount: money(paid), date: when, method: how })
                          : t('partLine', {
                              paid: money(paid),
                              total: money(total),
                              date: when,
                              method: how,
                            })}
                      </p>
                    ) : null}
                    {e && !full ? (
                      <p className="mt-1 text-sm font-semibold">
                        {t('owedLine', { amount: money(total - paid) })}
                      </p>
                    ) : null}

                    <ActionForm
                      action={setSalaryAction}
                      successKey="common.saved"
                      className="mt-3 flex flex-wrap items-end gap-2"
                    >
                      {hidden}
                      <input type="hidden" name="staffId" value={s.id} />
                      <div>
                        <Label htmlFor={`sal-${s.id}`}>{t('salary')}</Label>
                        <Input
                          id={`sal-${s.id}`}
                          name="salary"
                          inputMode="decimal"
                          required
                          className="w-32"
                          defaultValue={e ? plain(Number(e.salary_poisha)) : ''}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`alw-${s.id}`}>{t('allowances')}</Label>
                        <Input
                          id={`alw-${s.id}`}
                          name="allowances"
                          inputMode="decimal"
                          placeholder={t('allowancesPlaceholder')}
                          className="w-40"
                          defaultValue={e ? plain(Number(e.allowances_poisha)) : ''}
                        />
                      </div>
                      <div className="min-w-40 flex-1">
                        <Label htmlFor={`note-${s.id}`}>{t('note')}</Label>
                        <Input
                          id={`note-${s.id}`}
                          name="note"
                          maxLength={300}
                          placeholder={t('notePlaceholder')}
                          defaultValue={e?.notes ?? ''}
                        />
                      </div>
                      <Button type="submit" size="sm" variant="secondary">
                        {t('save')}
                      </Button>
                    </ActionForm>

                    {e ? (
                      <div className="mt-3 flex flex-wrap items-start gap-3 border-t border-line pt-3">
                        {!full ? (
                          <details className="min-w-0 flex-1">
                            <summary className="cursor-pointer text-sm font-semibold text-primary">
                              {t('markPaid')}
                            </summary>
                            <ActionForm
                              action={markSalaryPaidAction}
                              successKey="common.saved"
                              className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end"
                            >
                              {hidden}
                              <input type="hidden" name="staffId" value={s.id} />
                              <div>
                                <Label htmlFor={`pa-${s.id}`}>{t('amountPaid')}</Label>
                                <Input
                                  id={`pa-${s.id}`}
                                  name="amount"
                                  inputMode="decimal"
                                  required
                                  defaultValue={plain(total)}
                                />
                              </div>
                              <div>
                                <Label htmlFor={`pd-${s.id}`}>{t('paidOn')}</Label>
                                <Input
                                  id={`pd-${s.id}`}
                                  name="paidOn"
                                  type="date"
                                  max={today}
                                  defaultValue={today}
                                  required
                                />
                              </div>
                              <div>
                                <Label htmlFor={`pm-${s.id}`}>{t('method')}</Label>
                                {methodSelect(`pm-${s.id}`, e.paid_method ?? 'cash')}
                              </div>
                              <div className="sm:col-span-3">
                                <Button type="submit" size="sm">
                                  {t('markPaid')}
                                </Button>
                                <Hint className="mt-2">{t('amountPaidHint')}</Hint>
                              </div>
                            </ActionForm>
                          </details>
                        ) : null}
                        {paid > 0 ? (
                          <form action={unmarkSalaryPaidAction}>
                            {hidden}
                            <input type="hidden" name="staffId" value={s.id} />
                            <Button type="submit" size="sm" variant="ghost">
                              {t('undoPaid')}
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    ) : (
                      <Hint className="mt-3">{t('payFirst')}</Hint>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
