import { Send } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardTitle, EmptyState, Input, Label, PageTitle } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { PurchaseEntry } from '@/components/purchase-entry';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { formatQuantity } from '@/modules/inventory/format';
import { businessToday } from '@/modules/metrics/queries';
import { addSupplierAction, voidPurchaseAction } from '@/modules/purchasing/actions';
import type { BaseUnit } from '@/modules/purchasing/lines';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';

const TABS = ['record', 'history', 'suppliers'] as const;
type Tab = (typeof TABS)[number];

/**
 * Purchases (ROADMAP Phase 5): the bazar by form or by Telegram chat (photo and voice are switched off
 * for now). Prices are money —
 * owner and purchaser record, the accountant reads, managers never see this page (ADR 0007).
 */
export default async function PurchasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ tab?: string; branch?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const has = (r: string) => ctx.roles.includes(r as never);
  if (!['owner', 'purchaser', 'accountant'].some(has)) notFound();
  const canBuy = has('owner') || has('purchaser');
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as Tab)
    : canBuy
      ? 'record'
      : 'history';
  const branch = pickBranch(ctx, sp.branch);
  const [t, tu, locale] = await Promise.all([
    getTranslations('purchases'),
    getTranslations('units'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const money = (p: number) => formatBDT(p, loc);
  const { date: today } = await businessToday(ctx.org.id);
  const supabase = await createClient();
  const [{ data: ingredients }, { data: suppliers }, { data: aliases }] = await Promise.all([
    supabase
      .from('ingredients')
      .select('id, name, name_bn, base')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('suppliers')
      .select('id, name, phone')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('name'),
    // Spellings learnt from purchasers' picks (ADR 0028): typing one finds its item.
    tab === 'record'
      ? supabase.from('ingredient_aliases').select('ingredient_id, alias').eq('org_id', ctx.org.id)
      : Promise.resolve({ data: [] as { ingredient_id: string; alias: string }[] }),
  ]);
  const aliasesBy = new Map<string, string[]>();
  for (const a of aliases ?? []) {
    const list = aliasesBy.get(a.ingredient_id as string) ?? [];
    list.push(a.alias as string);
    aliasesBy.set(a.ingredient_id as string, list);
  }
  const ingName = (i: { name: string; name_bn: string | null }) =>
    loc === 'bn' && i.name_bn ? i.name_bn : i.name;
  const ingredientBy = new Map((ingredients ?? []).map((i) => [i.id as string, i]));
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <PillNav
        label={t('sections')}
        className="mb-6"
        items={TABS.filter((x) => canBuy || x !== 'record').map((x) => ({
          href: `/${ctx.org.slug}/purchases?tab=${x}`,
          label: t(`tabs.${x}`),
          active: x === tab,
        }))}
      />

      {tab === 'record' && canBuy ? (
        <Card className="mb-4 flex max-w-3xl flex-wrap items-center gap-4">
          <Send aria-hidden className="size-6 shrink-0 text-purple" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('telegramTitle')}</p>
            <p className="text-sm text-secondary">{t('telegramBody')}</p>
          </div>
          {ctx.isOwner ? (
            <Link
              href={`/${ctx.org.slug}/settings/telegram`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              {t('telegramSetup')}
            </Link>
          ) : null}
        </Card>
      ) : null}

      {tab === 'record' && canBuy ? (
        <Card className="max-w-3xl">
          <CardTitle>{t('recordTitle')}</CardTitle>
          <PurchaseEntry
            orgId={ctx.org.id}
            orgSlug={ctx.org.slug}
            branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
            defaultBranchId={branch?.id ?? ctx.branches[0]?.id ?? ''}
            today={today}
            suppliers={(suppliers ?? []).map((s) => ({
              id: s.id as string,
              name: s.name as string,
            }))}
            ingredients={(ingredients ?? []).map((i) => ({
              id: i.id as string,
              name: i.name as string,
              nameBn: (i.name_bn as string | null) ?? null,
              base: i.base as BaseUnit,
              aliases: aliasesBy.get(i.id as string) ?? [],
            }))}
            days={[1, 2, 3, 4, 5, 6, 7, 10, 14, 30]}
          />
        </Card>
      ) : null}

      {tab === 'history'
        ? await (async () => {
            const { data: purchases } = await supabase
              .from('purchases')
              .select(
                'id, branch_id, purchased_on, status, source, total_poisha, suppliers(name), purchase_lines(ingredient_id, qty_base, line_total_poisha)',
              )
              .eq('org_id', ctx.org.id)
              .order('purchased_on', { ascending: false })
              .order('created_at', { ascending: false })
              .limit(60);
            const list = (purchases ?? []) as unknown as {
              id: string;
              branch_id: string;
              purchased_on: string;
              status: 'confirmed' | 'void' | 'draft';
              source: string;
              total_poisha: number;
              suppliers: { name: string } | null;
              purchase_lines: {
                ingredient_id: string;
                qty_base: number;
                line_total_poisha: number;
              }[];
            }[];
            return list.length === 0 ? (
              <EmptyState title={t('noPurchases')} />
            ) : (
              <ul className="space-y-3">
                {list.map((p) => (
                  <li key={p.id}>
                    <Card className="p-4">
                      <details>
                        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold">
                              {p.suppliers?.name ?? t('noSupplier')} ·{' '}
                              {ctx.branches.find((b) => b.id === p.branch_id)?.name ?? ''}
                            </p>
                            <p className="text-xs text-secondary">
                              {p.purchased_on} · {t(`source.${p.source}`)} ·{' '}
                              {t('lineCount', { count: p.purchase_lines.length })}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {p.status === 'void' ? (
                              <StatusBadge tone="danger">{t('voided')}</StatusBadge>
                            ) : null}
                            <span
                              className={cn(
                                'font-semibold tabular-nums',
                                p.status === 'void' && 'line-through opacity-60',
                              )}
                            >
                              {money(Number(p.total_poisha))}
                            </span>
                          </div>
                        </summary>
                        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                          {p.purchase_lines.map((l, i) => {
                            const ing = ingredientBy.get(l.ingredient_id);
                            return (
                              <li key={i} className="flex justify-between gap-2">
                                <span>
                                  {ing
                                    ? ingName(ing as { name: string; name_bn: string | null })
                                    : '—'}
                                </span>
                                <span className="text-secondary tabular-nums">
                                  {ing
                                    ? formatQuantity(
                                        Number(l.qty_base),
                                        ing.base as BaseUnit,
                                        loc,
                                        (u) => tu(u),
                                      )
                                    : ''}{' '}
                                  · {money(Number(l.line_total_poisha))}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                        {ctx.isOwner && p.status === 'confirmed' ? (
                          <ActionForm
                            action={voidPurchaseAction}
                            successKey="purchases.voidedOk"
                            className="mt-3 flex flex-wrap items-end gap-2"
                          >
                            {hidden}
                            <input type="hidden" name="purchaseId" value={p.id} />
                            <Input
                              name="reason"
                              required
                              maxLength={500}
                              placeholder={t('voidReason')}
                              aria-label={t('voidReason')}
                              className="min-h-9 max-w-xs"
                            />
                            <Button type="submit" size="sm" variant="danger">
                              {t('void')}
                            </Button>
                          </ActionForm>
                        ) : null}
                      </details>
                    </Card>
                  </li>
                ))}
              </ul>
            );
          })()
        : null}

      {tab === 'suppliers' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {ctx.isOwner ? (
            <Card>
              <CardTitle>{t('addSupplier')}</CardTitle>
              <ActionForm
                action={addSupplierAction}
                successKey="common.saved"
                className="space-y-3"
              >
                {hidden}
                <div>
                  <Label htmlFor="s-name">{t('supplierName')}</Label>
                  <Input id="s-name" name="name" required maxLength={120} />
                </div>
                <div>
                  <Label htmlFor="s-phone">{t('supplierPhone')}</Label>
                  <Input id="s-phone" name="phone" inputMode="tel" maxLength={20} />
                </div>
                <Button type="submit">{t('addSupplier')}</Button>
              </ActionForm>
            </Card>
          ) : null}
          <Card>
            <CardTitle>{t('suppliersTitle')}</CardTitle>
            {(suppliers ?? []).length === 0 ? (
              <EmptyState title={t('noSuppliers')} />
            ) : (
              <ul className="space-y-2">
                {(suppliers ?? []).map((s) => (
                  <li
                    key={s.id}
                    className="glass-tile flex justify-between gap-2 rounded-input p-3"
                  >
                    <span className="font-semibold">{s.name}</span>
                    <span className="text-sm text-secondary">
                      {(s.phone as string | null) ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
