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
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, formatBps, type Locale } from '@/lib/i18n/format';
import { businessDate } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import {
  addFixedCostAction,
  endFixedCostAction,
  setAssumedFoodCostAction,
  setSalaryAction,
} from '@/modules/costs/actions';
import { getOrgContext } from '@/modules/tenancy/context';
import { SettingsNav } from '@/components/settings-nav';

const FIXED_KINDS = ['rent', 'utilities', 'gas', 'fuel', 'internet', 'other'] as const;

/** Setup behind the flash P&L (ROADMAP Phase 2). Owner-only: every row here is money (ADR 0007). */
export default async function CostsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();

  const [t, locale] = await Promise.all([getTranslations('costs'), getLocale()]);
  const loc = locale as Locale;
  const money = (p: number) => formatBDT(p, loc);
  const today = businessDate(now());
  const month = today.slice(0, 7);
  const supabase = await createClient();
  const [{ data: cost }, { data: fixed }, { data: staff }, { data: salaries }] = await Promise.all([
    supabase
      .from('org_cost_settings')
      .select('assumed_food_cost_bps')
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
    supabase
      .from('fixed_costs')
      .select('id, branch_id, kind, label, monthly_poisha, effective_from, effective_to')
      .eq('org_id', ctx.org.id)
      .order('effective_from', { ascending: false }),
    supabase
      .from('staff')
      .select('id, display_name, role, branch_id')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('display_name'),
    supabase
      .from('salary_entries')
      .select('staff_id, salary_poisha, allowances_poisha')
      .eq('org_id', ctx.org.id)
      .eq('month', `${month}-01`),
  ]);
  const branchName = (id: string | null) =>
    id ? (ctx.branches.find((b) => b.id === id)?.name ?? '') : t('allBranches');
  const salaryBy = new Map((salaries ?? []).map((s) => [s.staff_id as string, s]));
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const active = (fixed ?? []).filter((f) => !f.effective_to || f.effective_to >= today);

  return (
    <>
      <SettingsNav ctx={ctx} current="costs" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />

      <Card className="mb-6">
        <CardTitle>{t('foodCostTitle')}</CardTitle>
        <p className="-mt-2 mb-4 max-w-2xl text-sm text-secondary">{t('foodCostBody')}</p>
        <ActionForm
          action={setAssumedFoodCostAction}
          successKey="common.saved"
          className="flex flex-wrap items-end gap-3"
        >
          {hidden}
          <div>
            <Label htmlFor="pct">{t('foodCostPct')}</Label>
            <Input
              id="pct"
              name="pct"
              type="number"
              min={0}
              max={100}
              step="0.1"
              required
              defaultValue={
                cost?.assumed_food_cost_bps != null ? cost.assumed_food_cost_bps / 100 : ''
              }
              className="w-32"
            />
          </div>
          <Button type="submit">{t('save')}</Button>
          {cost?.assumed_food_cost_bps != null ? (
            <Hint className="basis-full">
              {t('currentAssumption', { pct: formatBps(cost.assumed_food_cost_bps, loc) })}
            </Hint>
          ) : null}
        </ActionForm>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>{t('fixedTitle')}</CardTitle>
          <ActionForm
            action={addFixedCostAction}
            successKey="common.saved"
            className="mb-5 grid gap-3 sm:grid-cols-2"
          >
            {hidden}
            <div>
              <Label htmlFor="fc-branch">{t('branch')}</Label>
              <Select id="fc-branch" name="branchId" defaultValue={ctx.branches[0]?.id ?? ''}>
                {ctx.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                <option value="">{t('allBranches')}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="fc-kind">{t('kind')}</Label>
              <Select id="fc-kind" name="kind" defaultValue="rent">
                {FIXED_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="fc-label">{t('label')}</Label>
              <Input id="fc-label" name="label" maxLength={120} />
            </div>
            <div>
              <Label htmlFor="fc-monthly">{t('monthly')}</Label>
              <Input id="fc-monthly" name="monthly" inputMode="decimal" required />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">{t('addFixed')}</Button>
            </div>
          </ActionForm>
          {active.length === 0 ? (
            <EmptyState title={t('noFixed')} />
          ) : (
            <ul className="space-y-2">
              {active.map((f) => (
                <li
                  key={f.id}
                  className="glass-tile flex flex-wrap items-center justify-between gap-2 rounded-input p-3"
                >
                  <div>
                    <p className="font-semibold">
                      {t(`kinds.${f.kind}`)}
                      {f.label ? ` · ${f.label}` : ''}
                    </p>
                    <p className="text-xs text-secondary">
                      {branchName(f.branch_id as string | null)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">
                      {t('perMonth', { amount: money(Number(f.monthly_poisha)) })}
                    </span>
                    <form action={endFixedCostAction}>
                      {hidden}
                      <input type="hidden" name="id" value={f.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        {t('end')}
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('salaryTitle', { month })}</CardTitle>
          <p className="-mt-2 mb-4 text-sm text-secondary">{t('salaryBody')}</p>
          {(staff ?? []).length === 0 ? (
            <EmptyState title={t('noStaff')} />
          ) : (
            <ul className="space-y-3">
              {(staff ?? []).map((s) => {
                const current = salaryBy.get(s.id as string);
                return (
                  <li key={s.id} className="glass-tile rounded-input p-3">
                    <p className="mb-2 text-sm font-semibold">
                      {s.display_name}{' '}
                      <span className="font-normal text-secondary">
                        · {branchName(s.branch_id as string)}
                      </span>
                    </p>
                    <ActionForm
                      action={setSalaryAction}
                      successKey="common.saved"
                      className="flex flex-wrap items-end gap-2"
                    >
                      {hidden}
                      <input type="hidden" name="branchId" value={s.branch_id as string} />
                      <input type="hidden" name="staffId" value={s.id as string} />
                      <input type="hidden" name="month" value={month} />
                      <div>
                        <Label htmlFor={`sal-${s.id}`}>{t('salary')}</Label>
                        <Input
                          id={`sal-${s.id}`}
                          name="salary"
                          inputMode="decimal"
                          required
                          className="w-32"
                          defaultValue={
                            current
                              ? formatBDT(Number(current.salary_poisha), 'en', { symbol: false })
                              : ''
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor={`alw-${s.id}`}>{t('allowances')}</Label>
                        <Input
                          id={`alw-${s.id}`}
                          name="allowances"
                          inputMode="decimal"
                          className="w-28"
                          defaultValue={
                            current
                              ? formatBDT(Number(current.allowances_poisha), 'en', {
                                  symbol: false,
                                })
                              : ''
                          }
                        />
                      </div>
                      <Button type="submit" size="sm" variant="secondary">
                        {t('save')}
                      </Button>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
