import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, Hint, Input, PageTitle, Select } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { type Locale } from '@/lib/i18n/format';
import { saveCountAction } from '@/modules/inventory/actions';
import { formatQuantity } from '@/modules/inventory/format';
import { splitQuantity, unitsFor, type BaseUnit } from '@/modules/purchasing/lines';
import { getOrgContext } from '@/modules/tenancy/context';

interface SheetRow {
  ingredient_id: string;
  name: string;
  name_bn: string | null;
  base: BaseUnit;
  suggested: boolean;
  rank: number;
  counted_qty: number | null;
}

/**
 * The count sheet (ROADMAP Phase 5): mobile-first, the costliest ingredients first, and blind — it
 * never shows what the system expects, so the count is an observation, not a confirmation.
 */
export default async function CountPage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org, id } = await params;
  const ctx = await getOrgContext(org);
  const supabase = await createClient();
  const { data: count } = await supabase
    .from('stock_counts')
    .select('id, branch_id, counted_on, kind, status')
    .eq('org_id', ctx.org.id)
    .eq('id', id)
    .maybeSingle();
  if (!count) notFound();
  const { data, error } = await supabase.rpc('stock_count_sheet', { p_count: id });
  if (error) notFound();
  const sheet = (data ?? []) as SheetRow[];
  const [t, tu, locale] = await Promise.all([
    getTranslations('stock'),
    getTranslations('units'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const label = (r: SheetRow) => (loc === 'bn' && r.name_bn ? r.name_bn : r.name);
  const open = count.status === 'open';
  const branchName = ctx.branches.find((b) => b.id === count.branch_id)?.name ?? '';
  const back = `/${ctx.org.slug}/stock?branch=${count.branch_id as string}`;
  const done = sheet.filter((r) => r.counted_qty !== null).length;

  const row = (r: SheetRow) => {
    const current = r.counted_qty === null ? null : splitQuantity(Number(r.counted_qty), r.base);
    return (
      <li
        key={r.ingredient_id}
        className="glass-tile flex flex-wrap items-center gap-2 rounded-input p-3"
      >
        <label htmlFor={`qty-${r.ingredient_id}`} className="min-w-36 flex-1 font-medium">
          {label(r)}
        </label>
        {open ? (
          <>
            <Input
              id={`qty-${r.ingredient_id}`}
              name={`qty-${r.ingredient_id}`}
              inputMode="decimal"
              className="min-h-11 w-28 text-end"
              defaultValue={current ? String(Math.round(current.value * 1000) / 1000) : ''}
            />
            {current !== null ? (
              <input type="hidden" name={`touched-${r.ingredient_id}`} value="1" />
            ) : null}
            <Select
              name={`unit-${r.ingredient_id}`}
              aria-label={t('unit')}
              defaultValue={
                current?.unit ?? (r.base === 'g' ? 'kg' : r.base === 'ml' ? 'l' : 'pcs')
              }
              className="w-24"
            >
              {unitsFor(r.base).map((u) => (
                <option key={u} value={u}>
                  {tu(u)}
                </option>
              ))}
            </Select>
          </>
        ) : (
          <span className="tabular-nums">
            {r.counted_qty === null
              ? '—'
              : formatQuantity(Number(r.counted_qty), r.base, loc, (u) => tu(u))}
          </span>
        )}
      </li>
    );
  };

  return (
    <>
      <PageTitle
        title={t(`start.${count.kind as string}`)}
        subtitle={t('countSubtitle', { branch: branchName, date: count.counted_on as string })}
        actions={
          <Link href={back} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            {t('back')}
          </Link>
        }
      />
      <Card className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-secondary">
            {t('countProgress', { done, total: sheet.length })}
          </p>
          <StatusBadge tone={open ? 'info' : 'success'}>
            {t(`countStatus.${count.status as string}`)}
          </StatusBadge>
        </div>
        {open ? <Hint className="-mt-2 mb-4">{t('blindHint')}</Hint> : null}
        <ActionForm action={saveCountAction} successKey="common.saved" className="space-y-4">
          <input type="hidden" name="orgId" value={ctx.org.id} />
          <input type="hidden" name="orgSlug" value={ctx.org.slug} />
          <input type="hidden" name="countId" value={id} />
          <ul className="space-y-2">{sheet.filter((r) => r.suggested).map(row)}</ul>
          {sheet.some((r) => !r.suggested) ? (
            <details open={count.kind !== 'guided_weekly'}>
              <summary className="cursor-pointer text-sm font-semibold text-secondary">
                {t('otherIngredients', { count: sheet.filter((r) => !r.suggested).length })}
              </summary>
              <ul className="mt-2 space-y-2">{sheet.filter((r) => !r.suggested).map(row)}</ul>
            </details>
          ) : null}
          {open ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Button type="submit" name="submit" value="0" variant="secondary">
                {t('saveCount')}
              </Button>
              <Button type="submit" name="submit" value="1">
                {t('submitCount')}
              </Button>
            </div>
          ) : null}
        </ActionForm>
        {open ? <Hint className="mt-3">{t('submitHint')}</Hint> : null}
      </Card>
    </>
  );
}
