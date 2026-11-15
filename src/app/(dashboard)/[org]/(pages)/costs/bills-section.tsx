import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState, Hint, Input, Label, Select } from '@/components/ui/form';
import { formatBDT, type Locale } from '@/lib/i18n/format';
import {
  addFixedCostAction,
  endFixedCostAction,
  updateFixedCostAction,
} from '@/modules/costs/actions';

export const FIXED_KINDS = ['rent', 'utilities', 'gas', 'fuel', 'internet', 'other'] as const;

export interface FixedCostRow {
  id: string;
  branch_id: string | null;
  kind: (typeof FIXED_KINDS)[number];
  label: string | null;
  monthly_poisha: number | string;
}

/**
 * Costs → Rent & bills: what is paid every month whatever happens at the till. The owner adds, changes
 * and ends each one; a changed amount counts from today (ADR 0060).
 */
export async function BillsSection({
  orgId,
  orgSlug,
  branches,
  rows,
}: {
  orgId: string;
  orgSlug: string;
  branches: { id: string; name: string }[];
  rows: FixedCostRow[];
}) {
  const [t, locale] = await Promise.all([getTranslations('costs'), getLocale()]);
  const money = (p: number) => formatBDT(p, locale as Locale);
  const total = rows.reduce((sum, r) => sum + Number(r.monthly_poisha), 0);
  const branchName = (id: string | null) =>
    id ? (branches.find((b) => b.id === id)?.name ?? '') : t('allBranches');
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
    </>
  );
  const plain = (poisha: number) => formatBDT(poisha, 'en', { symbol: false });

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <p className="text-sm text-secondary">{t('billsTotal')}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{money(total)}</p>
        <p className="text-xs text-secondary">
          {t('billsTotalHint')} · {t('totalLine', { count: rows.length })}
        </p>
      </Card>

      <Card>
        <CardTitle>{t('fixedTitle')}</CardTitle>
        <p className="-mt-2 mb-4 text-sm text-secondary">{t('fixedBody')}</p>
        <details className="mb-5 rounded-input border border-line p-3" open={rows.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold">{t('addTitle')}</summary>
          <ActionForm
            action={addFixedCostAction}
            successKey="common.saved"
            className="mt-3 grid gap-3 sm:grid-cols-2"
          >
            {hidden}
            <div>
              <Label htmlFor="fc-branch">{t('branch')}</Label>
              <Select id="fc-branch" name="branchId" defaultValue={branches[0]?.id ?? ''}>
                {branches.map((b) => (
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
        </details>

        {rows.length === 0 ? (
          <EmptyState title={t('noFixed')} />
        ) : (
          <ul className="space-y-2">
            {rows.map((f) => (
              <li key={f.id} className="glass-tile rounded-input p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {t(`kinds.${f.kind}`)}
                      {f.label ? ` · ${f.label}` : ''}
                    </p>
                    <p className="text-xs text-secondary">{branchName(f.branch_id)}</p>
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
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-primary">
                    {t('editCost')}
                  </summary>
                  <ActionForm
                    action={updateFixedCostAction}
                    successKey="common.saved"
                    className="mt-3 grid gap-3 sm:grid-cols-3"
                  >
                    {hidden}
                    <input type="hidden" name="id" value={f.id} />
                    <div>
                      <Label htmlFor={`ek-${f.id}`}>{t('kind')}</Label>
                      <Select id={`ek-${f.id}`} name="kind" defaultValue={f.kind}>
                        {FIXED_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {t(`kinds.${k}`)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={`el-${f.id}`}>{t('label')}</Label>
                      <Input
                        id={`el-${f.id}`}
                        name="label"
                        maxLength={120}
                        defaultValue={f.label ?? ''}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`em-${f.id}`}>{t('monthly')}</Label>
                      <Input
                        id={`em-${f.id}`}
                        name="monthly"
                        inputMode="decimal"
                        required
                        defaultValue={plain(Number(f.monthly_poisha))}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Button type="submit" size="sm" variant="secondary">
                        {t('save')}
                      </Button>
                      <Hint className="mt-2">{t('editCostHint')}</Hint>
                    </div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
