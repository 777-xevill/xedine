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
import { markAttendanceAction, recordAdvanceAction } from '@/modules/staff/actions';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';

type Tab = 'attendance' | 'advances' | 'sales';
const STATUSES = ['present', 'half_day', 'leave', 'absent'] as const;

/**
 * Staff-lite (ROADMAP Phase 10): today's attendance with a 30-day summary, the advances ledger (owner and
 * accountant — money), and sales per staff member from the same metric the leak detector uses.
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
    body = (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>{t('todayTitle', { date: today })}</CardTitle>
          {(staff ?? []).length === 0 ? (
            <EmptyState title={t('noStaff')} />
          ) : (
            <ul className="space-y-2">
              {(staff ?? []).map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2"
                >
                  <span className="font-medium">{s.display_name}</span>
                  {canMark ? (
                    <span className="flex flex-wrap gap-1">
                      {STATUSES.map((st) => (
                        <form key={st} action={markAttendanceAction}>
                          <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                          <input type="hidden" name="staffId" value={s.id} />
                          <input type="hidden" name="date" value={today} />
                          <input type="hidden" name="status" value={st} />
                          <Button
                            type="submit"
                            size="sm"
                            variant={marked.get(s.id) === st ? 'primary' : 'ghost'}
                            aria-pressed={marked.get(s.id) === st}
                          >
                            {t(`status.${st}`)}
                          </Button>
                        </form>
                      ))}
                    </span>
                  ) : (
                    <span className="text-sm text-secondary">
                      {marked.get(s.id) ? t(`status.${marked.get(s.id)}`) : t('unmarked')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>{t('summaryTitle')}</CardTitle>
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-secondary">
              <tr>
                <th className="py-2 text-start font-medium">{t('name')}</th>
                {STATUSES.map((st) => (
                  <th key={st} className="py-2 text-end font-medium">
                    {t(`status.${st}`)}
                  </th>
                ))}
                <th className="py-2 text-end font-medium">{t('unmarked')}</th>
              </tr>
            </thead>
            <tbody>
              {((summary ?? []) as Record<string, unknown>[]).map((r) => (
                <tr key={r.staff_id as string} className="border-t border-line">
                  <td className="py-2">{r.display_name as string}</td>
                  <td className="py-2 text-end">{num(r.present)}</td>
                  <td className="py-2 text-end">{num(r.half_day)}</td>
                  <td className="py-2 text-end">{num(r.on_leave)}</td>
                  <td className="py-2 text-end">{num(r.absent)}</td>
                  <td className="py-2 text-end text-secondary">{num(r.unmarked)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Hint className="mt-3">{t('summaryHint')}</Hint>
        </Card>
      </div>
    );
  } else if (tab === 'advances') {
    const { data } = await supabase.rpc('metric_advance_balances', {
      p_org: ctx.org.id,
      p_branch: branch.id,
    });
    const rows = (data ?? []) as Record<string, unknown>[];
    body = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle>{t('advancesTitle')}</CardTitle>
          {rows.length === 0 ? (
            <EmptyState title={t('noAdvances')} />
          ) : (
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-secondary">
                <tr>
                  <th className="py-2 text-start font-medium">{t('name')}</th>
                  <th className="py-2 text-end font-medium">{t('given')}</th>
                  <th className="py-2 text-end font-medium">{t('repaid')}</th>
                  <th className="py-2 text-end font-medium">{t('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.staff_id as string} className="border-t border-line">
                    <td className="py-2">{r.display_name as string}</td>
                    <td className="py-2 text-end">{bdt(r.given_poisha)}</td>
                    <td className="py-2 text-end">{bdt(r.repaid_poisha)}</td>
                    <td className="py-2 text-end font-semibold">{bdt(r.balance_poisha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {has('owner') ? (
          <Card>
            <CardTitle>{t('recordTitle')}</CardTitle>
            <ActionForm
              action={recordAdvanceAction}
              successKey="common.saved"
              className="space-y-3"
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="adv-kind">{t('kind')}</Label>
                  <Select id="adv-kind" name="kind" defaultValue="given">
                    <option value="given">{t('given')}</option>
                    <option value="repaid">{t('repaid')}</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="adv-amount">{t('amount')}</Label>
                  <Input
                    id="adv-amount"
                    name="amount"
                    inputMode="decimal"
                    required
                    maxLength={20}
                  />
                </div>
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
              <Button type="submit">{t('record')}</Button>
            </ActionForm>
            <Hint className="mt-3">{t('advancesHint')}</Hint>
          </Card>
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
        <Card className="p-4 sm:p-6">
          <CardTitle>{t('salesTitle')}</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm tabular-nums">
              <thead className="text-xs text-secondary">
                <tr>
                  <th className="py-2 text-start font-medium">{t('name')}</th>
                  <th className="py-2 text-end font-medium">{t('orders')}</th>
                  <th className="py-2 text-end font-medium">{t('sales')}</th>
                  <th className="py-2 text-end font-medium">{t('voids')}</th>
                  <th className="py-2 text-end font-medium">{t('discounts')}</th>
                  <th className="py-2 text-end font-medium">{t('refunds')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.staff_id as string} className="border-t border-line">
                    <td className="py-2">{r.staff_name as string}</td>
                    <td className="py-2 text-end">{num(r.orders)}</td>
                    <td className="py-2 text-end">{bdt(r.completed_net_poisha)}</td>
                    <td className="py-2 text-end">{num(r.void_after_kot_count)}</td>
                    <td className="py-2 text-end">{num(r.discount_count)}</td>
                    <td className="py-2 text-end">{num(r.refund_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Hint className="mt-3">{t('salesHint')}</Hint>
        </Card>
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
