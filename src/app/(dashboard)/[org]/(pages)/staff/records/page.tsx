import { Check, Clock, Umbrella, Users, X } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import {
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
import { formatBDT, formatNumber, type Locale } from '@/lib/i18n/format';
import { addDays } from '@/lib/time/business-date';
import { businessToday } from '@/modules/metrics/queries';
import {
  markAllPresentAction,
  markAttendanceAction,
  recordAdvanceAction,
} from '@/modules/staff/actions';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';

type Tab = 'attendance' | 'advances' | 'sales';
const STATUSES = ['present', 'half_day', 'leave', 'absent'] as const;
const STATUS_ICON = { present: Check, half_day: Clock, leave: Umbrella, absent: X } as const;
// Summary columns come back as present, half_day, on_leave, absent.
const SUMMARY_KEY = {
  present: 'present',
  half_day: 'half_day',
  leave: 'on_leave',
  absent: 'absent',
} as const;

/**
 * Staff records (ROADMAP Phase 10), in plain words and big tap targets: who came today (one tap each, or
 * everyone at once), money advanced to staff and what is still owed (owner and accountant), and who sold
 * the most. Sales and the cancel/discount/refund counts come from the same metric the leak detector uses.
 */
export default async function StaffRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ tab?: string; branch?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const has = (r: string) => ctx.roles.includes(r as never);
  if (!['owner', 'manager', 'accountant'].some(has)) notFound();
  const money = has('owner') || has('accountant');
  const canMark = has('owner') || has('manager');
  const tabs: Tab[] = ['attendance', ...(money ? (['advances'] as const) : []), 'sales'];
  const tab = (tabs as string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : tabs[0]!;
  const branch = pickBranch(ctx, sp.branch);
  if (!branch) notFound();
  const [t, locale] = await Promise.all([getTranslations('staffRecords'), getLocale()]);
  const loc = locale as Locale;
  const { date: today } = await businessToday(ctx.org.id);
  const from = addDays(today, -29);
  const supabase = await createClient();
  const bdt = (v: unknown) => formatBDT(Number(v ?? 0), loc, { poisha: 'never' });
  const num = (v: unknown) => formatNumber(Number(v ?? 0), loc);
  const href = (x: { tab?: Tab; branch?: string }) =>
    `/${ctx.org.slug}/staff/records?tab=${x.tab ?? tab}&branch=${x.branch ?? branch.id}`;
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const { data: staff } = await supabase
    .from('staff')
    .select('id, display_name')
    .eq('org_id', ctx.org.id)
    .eq('branch_id', branch.id)
    .eq('is_active', true)
    .order('display_name');

  let body: React.ReactNode;
  if (tab === 'attendance') {
    const [{ data: todayRows }, { data: summary }] = await Promise.all([
      supabase
        .from('attendance')
        .select('staff_id, status')
        .eq('org_id', ctx.org.id)
        .eq('branch_id', branch.id)
        .eq('work_date', today),
      supabase.rpc('metric_attendance', {
        p_org: ctx.org.id,
        p_branch: branch.id,
        p_from: from,
        p_to: today,
      }),
    ]);
    const marked = new Map(
      (todayRows ?? []).map((r) => [r.staff_id as string, r.status as string]),
    );
    const total = (staff ?? []).length;
    const done = (staff ?? []).filter((s) => marked.has(s.id)).length;
    body = (
      <div className="mx-auto max-w-2xl space-y-5">
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="mb-0">{t('todayTitle', { date: today })}</CardTitle>
            {total > 0 ? (
              <span className="text-sm text-secondary">
                {done === total
                  ? t('allMarked')
                  : t('markedOf', { marked: num(done), total: num(total) })}
              </span>
            ) : null}
          </div>
          {total === 0 ? (
            <EmptyState title={t('noStaff')} body={t('noStaffBody')} />
          ) : (
            <>
              {canMark && done < total ? (
                <ActionForm
                  action={markAllPresentAction}
                  successKey="common.saved"
                  className="mb-3"
                >
                  <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                  <input type="hidden" name="branchId" value={branch.id} />
                  <input type="hidden" name="date" value={today} />
                  <Button type="submit" variant="secondary">
                    <Users aria-hidden className="size-4" />
                    {t('markAll')}
                  </Button>
                  <Hint className="mt-1">{t('markAllHint')}</Hint>
                </ActionForm>
              ) : null}
              <ul className="space-y-3">
                {(staff ?? []).map((s) => (
                  <li key={s.id} className="glass-tile rounded-input p-3">
                    <p className="mb-2 font-semibold">{s.display_name}</p>
                    {canMark ? (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {STATUSES.map((st) => {
                          const Icon = STATUS_ICON[st];
                          const on = marked.get(s.id) === st;
                          return (
                            <form key={st} action={markAttendanceAction}>
                              <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                              <input type="hidden" name="staffId" value={s.id} />
                              <input type="hidden" name="date" value={today} />
                              <input type="hidden" name="status" value={st} />
                              <Button
                                type="submit"
                                size="sm"
                                variant={on ? 'primary' : 'secondary'}
                                aria-pressed={on}
                                className="w-full"
                              >
                                <Icon aria-hidden className="size-4" />
                                {t(`status.${st}`)}
                              </Button>
                            </form>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-secondary">
                        {marked.get(s.id) ? t(`status.${marked.get(s.id)}`) : t('unmarked')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {total > 0 ? (
          <Card className="p-4 sm:p-5">
            <CardTitle>{t('summaryTitle')}</CardTitle>
            <ul className="space-y-3">
              {((summary ?? []) as Record<string, unknown>[]).map((r) => (
                <li
                  key={r.staff_id as string}
                  className="border-t border-line pt-3 first:border-t-0 first:pt-0"
                >
                  <p className="font-semibold">{r.display_name as string}</p>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                    {STATUSES.map((st) => (
                      <span key={st} className="inline-flex items-center gap-1">
                        {(() => {
                          const Icon = STATUS_ICON[st];
                          return <Icon aria-hidden className="size-3.5 text-secondary" />;
                        })()}
                        {`${t(`status.${st}`)}: `}
                        <b>{num(r[SUMMARY_KEY[st]])}</b>
                      </span>
                    ))}
                    {Number(r.unmarked ?? 0) > 0 ? (
                      <span className="text-secondary">
                        {`${t('unmarked')}: ${num(r.unmarked)}`}
                      </span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
            <Hint className="mt-3">{t('summaryHint')}</Hint>
          </Card>
        ) : null}
      </div>
    );
  } else if (tab === 'advances') {
    const { data } = await supabase.rpc('metric_advance_balances', {
      p_org: ctx.org.id,
      p_branch: branch.id,
    });
    const rows = (data ?? []) as Record<string, unknown>[];
    body = (
      <div className="mx-auto max-w-2xl space-y-5">
        <Card className="p-4 sm:p-5">
          <CardTitle>{t('advancesTitle')}</CardTitle>
          {rows.length === 0 ? (
            <EmptyState title={t('noAdvances')} body={t('noAdvancesBody')} />
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.staff_id as string} className="glass-tile rounded-input p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{r.display_name as string}</p>
                    <p className="text-end">
                      <span className="block text-lg font-bold tabular-nums">
                        {bdt(r.balance_poisha)}
                      </span>
                      <span className="block text-xs text-secondary">{t('balance')}</span>
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-secondary">
                    {`${t('given')}: ${bdt(r.given_poisha)} · ${t('repaid')}: ${bdt(r.repaid_poisha)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {has('owner') ? (
          <details className="glass-tile rounded-card p-4 sm:p-5" open={rows.length === 0}>
            <summary className="cursor-pointer font-semibold">{t('recordTitle')}</summary>
            <ActionForm
              action={recordAdvanceAction}
              successKey="common.saved"
              className="mt-3 space-y-3"
            >
              {hidden}
              <div>
                <Label htmlFor="adv-staff">{t('name')}</Label>
                <Select id="adv-staff" name="staffId" required>
                  {(staff ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="adv-kind">{t('kind')}</Label>
                <Select id="adv-kind" name="kind" defaultValue="given">
                  <option value="given">{t('kindGiven')}</option>
                  <option value="repaid">{t('kindRepaid')}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="adv-amount">{t('amount')}</Label>
                <Input id="adv-amount" name="amount" inputMode="decimal" required maxLength={20} />
              </div>
              <details>
                <summary className="cursor-pointer text-sm text-secondary">
                  {t('moreDetails')}
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="adv-date">{t('date')}</Label>
                    <Input
                      id="adv-date"
                      name="occurredOn"
                      type="date"
                      defaultValue={today}
                      max={today}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="adv-note">{t('note')}</Label>
                    <Input id="adv-note" name="note" maxLength={200} />
                  </div>
                </div>
              </details>
              <Button type="submit">{t('record')}</Button>
            </ActionForm>
            <Hint className="mt-3">{t('advancesHint')}</Hint>
          </details>
        ) : null}
      </div>
    );
  } else {
    const { data } = await supabase.rpc('metric_staff_sales', {
      p_org: ctx.org.id,
      p_branch: branch.id,
      p_from: from,
      p_to: today,
    });
    const rows = (data ?? []) as Record<string, unknown>[];
    body =
      rows.length === 0 ? (
        <EmptyState title={t('noSales')} />
      ) : (
        <div className="mx-auto max-w-2xl space-y-5">
          <Card className="p-4 sm:p-5">
            <CardTitle>{t('salesTitle')}</CardTitle>
            <ol className="space-y-3">
              {rows.map((r, i) => {
                const checks = [
                  { k: 'voidsChip', n: Number(r.void_after_kot_count ?? 0) },
                  { k: 'discountsChip', n: Number(r.discount_count ?? 0) },
                  { k: 'refundsChip', n: Number(r.refund_count ?? 0) },
                ].filter((c) => c.n > 0);
                return (
                  <li key={r.staff_id as string} className="glass-tile rounded-input p-3">
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-xs font-bold"
                      >
                        {num(i + 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{r.staff_name as string}</p>
                        <p className="text-xs text-secondary">
                          {t('ordersCount', { count: Number(r.orders ?? 0), n: num(r.orders) })}
                        </p>
                      </div>
                      <p className="text-lg font-bold tabular-nums">
                        {bdt(r.completed_net_poisha)}
                      </p>
                    </div>
                    {checks.length > 0 ? (
                      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
                        {checks.map((c) => (
                          <span key={c.k}>{t(c.k, { n: num(c.n) })}</span>
                        ))}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <Hint className="mt-3">{t('salesHint')}</Hint>
          </Card>
        </div>
      );
  }

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <PillNav
          label={t('sections')}
          items={tabs.map((x) => ({
            href: href({ tab: x }),
            label: t(`tabs.${x}`),
            active: x === tab,
          }))}
        />
        {ctx.branches.length > 1 ? (
          <PillNav
            label={t('branches')}
            items={ctx.branches.map((b) => ({
              href: href({ branch: b.id }),
              label: b.name,
              active: b.id === branch.id,
            }))}
          />
        ) : null}
      </div>
      {body}
    </>
  );
}
