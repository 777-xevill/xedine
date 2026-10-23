import { AlertTriangle, Sparkles } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { UnitField } from '@/components/unit-field';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Textarea,
} from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { VoiceTextarea } from '@/components/voice-textarea';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, type Locale } from '@/lib/i18n/format';
import { aiConfigured } from '@/lib/llm-gateway';
import { cn } from '@/lib/utils';
import { formatQuantity } from '@/modules/inventory/format';
import { businessToday } from '@/modules/metrics/queries';
import {
  addSupplierAction,
  confirmPurchaseDraftAction,
  discardPurchaseDraftAction,
  draftPurchaseAction,
  importReferencePricesAction,
  recordPurchaseAction,
  voidPurchaseAction,
} from '@/modules/purchasing/actions';
import type { BaseUnit, PurchaseUnit, ReviewLine } from '@/modules/purchasing/lines';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';

const TABS = ['record', 'drafts', 'history', 'suppliers'] as const;
type Tab = (typeof TABS)[number];
const BLANK_ROWS = 6;

/**
 * Purchases (ROADMAP Phase 5): the bazar by form, by photo of the chit, or by voice. Prices are money —
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
  const [{ data: ingredients }, { data: suppliers }] = await Promise.all([
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
  ]);
  const ingName = (i: { name: string; name_bn: string | null }) =>
    loc === 'bn' && i.name_bn ? i.name_bn : i.name;
  const ingredientBy = new Map((ingredients ?? []).map((i) => [i.id as string, i]));
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const branchField = (id: string) => (
    <div>
      <Label htmlFor={id}>{t('branch')}</Label>
      <Select id={id} name="branchId" defaultValue={branch?.id ?? ''} required>
        {ctx.branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </div>
  );
  const supplierFields = (prefix: string, defaults: { id?: string; name?: string } = {}) => (
    <>
      <div>
        <Label htmlFor={`${prefix}-sup`}>{t('supplier')}</Label>
        <Select id={`${prefix}-sup`} name="supplierId" defaultValue={defaults.id ?? ''}>
          <option value="">{t('newOrNoSupplier')}</option>
          {(suppliers ?? []).map((s) => (
            <option key={s.id} value={s.id as string}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${prefix}-supname`}>{t('newSupplier')}</Label>
        <Input
          id={`${prefix}-supname`}
          name="supplierName"
          maxLength={120}
          defaultValue={defaults.name ?? ''}
        />
      </div>
    </>
  );
  const lineRow = (i: number, l?: Partial<ReviewLine>) => {
    const flagged = (f: string) => (l?.flags ?? []).some((x) => x.includes(f));
    const warn = 'border-warning/70 ring-1 ring-warning/40';
    const unit =
      l?.unit ??
      (l?.ingredient_id ? defaultUnit(ingredientBy.get(l.ingredient_id)?.base as BaseUnit) : 'kg');
    return (
      <div
        key={i}
        className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2"
      >
        <Select
          name={`line-${i}-ingredient`}
          aria-label={t('ingredient')}
          defaultValue={l?.ingredient_id ?? ''}
          className={cn(l && (flagged('no_match') || flagged('name')) && warn)}
        >
          <option value="">
            {l?.name ? t('matchFor', { name: l.name }) : t('chooseIngredient')}
          </option>
          {(ingredients ?? []).map((ing) => (
            <option key={ing.id} value={ing.id as string}>
              {ingName(ing as { name: string; name_bn: string | null })}
            </option>
          ))}
        </Select>
        <Input
          name={`line-${i}-qty`}
          inputMode="decimal"
          aria-label={t('qty')}
          placeholder={t('qty')}
          defaultValue={l?.qty ? String(l.qty) : ''}
          className={cn(l && flagged('qty') && warn)}
        />
        <UnitField
          name={`line-${i}-unit`}
          ariaLabel={t('unit')}
          defaultValue={unit}
          selectClassName={cn(l && flagged('unit') && warn)}
        />
        <Input
          name={`line-${i}-total`}
          inputMode="decimal"
          aria-label={t('lineTotal')}
          placeholder={t('lineTotal')}
          defaultValue={
            l?.line_total_poisha ? formatBDT(l.line_total_poisha, 'en', { symbol: false }) : ''
          }
          className={cn(l && (flagged('total') || flagged('no_total')) && warn)}
        />
      </div>
    );
  };

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <PillNav
        label={t('sections')}
        className="mb-6"
        items={TABS.filter((x) => canBuy || x === 'history' || x === 'suppliers').map((x) => ({
          href: `/${ctx.org.slug}/purchases?tab=${x}`,
          label: t(`tabs.${x}`),
          active: x === tab,
        }))}
      />

      {tab === 'record' && canBuy ? (
        <Card className="max-w-3xl">
          <CardTitle>{t('recordTitle')}</CardTitle>
          <ActionForm
            action={recordPurchaseAction}
            successKey="purchases.recorded"
            className="space-y-3"
          >
            {hidden}
            <div className="grid gap-3 sm:grid-cols-2">
              {branchField('p-branch')}
              <div>
                <Label htmlFor="p-date">{t('date')}</Label>
                <Input
                  id="p-date"
                  name="purchasedOn"
                  type="date"
                  max={today}
                  defaultValue={today}
                  required
                />
              </div>
              <div>
                <Label htmlFor="p-days">{t('forDays')}</Label>
                <Select id="p-days" name="forDays" defaultValue="">
                  <option value="">{t('forDaysNone')}</option>
                  {[1, 2, 3, 4, 5, 6, 7, 10, 14, 30].map((d) => (
                    <option key={d} value={d}>
                      {t('daysOption', { count: d })}
                    </option>
                  ))}
                </Select>
                <Hint>{t('forDaysHint')}</Hint>
              </div>
              {supplierFields('p')}
            </div>
            <p className="pt-2 text-sm font-semibold">{t('lines')}</p>
            {Array.from({ length: BLANK_ROWS }, (_, i) => lineRow(i))}
            <Hint>{t('linesHint')}</Hint>
            <Button type="submit">{t('record')}</Button>
          </ActionForm>
        </Card>
      ) : null}

      {tab === 'drafts' && canBuy
        ? await (async () => {
            const { data: drafts } = await supabase
              .from('purchase_drafts')
              .select('id, branch_id, source, raw_text, extracted, created_at')
              .eq('org_id', ctx.org.id)
              .eq('status', 'pending_review')
              .order('created_at', { ascending: false });
            return (
              <div className="space-y-6">
                <Card className="max-w-3xl">
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles aria-hidden className="size-5 text-purple" />
                    {t('aiTitle')}
                  </CardTitle>
                  <p className="-mt-2 mb-4 text-sm text-secondary">{t('aiBody')}</p>
                  {!aiConfigured() ? (
                    <Alert tone="warning" className="mb-4">
                      {t('aiNotConfigured')}
                    </Alert>
                  ) : null}
                  <ActionForm
                    action={draftPurchaseAction}
                    successKey="purchases.drafted"
                    className="space-y-3"
                  >
                    {hidden}
                    {branchField('d-branch')}
                    <div>
                      <Label htmlFor="d-photo">{t('photo')}</Label>
                      <Input
                        id="d-photo"
                        name="photo"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                      />
                    </div>
                    <VoiceTextarea
                      id="d-text"
                      name="text"
                      label={t('orSay')}
                      placeholder={t('sayPlaceholder')}
                      lang={loc === 'bn' ? 'bn-BD' : 'en-US'}
                      labels={{
                        speak: t('speak'),
                        stop: t('stop'),
                        unsupported: t('voiceUnsupported'),
                        listening: t('listening'),
                      }}
                    />
                    <Button type="submit" disabled={!aiConfigured()}>
                      {t('readIt')}
                    </Button>
                  </ActionForm>
                </Card>

                {(drafts ?? []).length === 0 ? (
                  <EmptyState title={t('noDrafts')} />
                ) : (
                  <ul className="space-y-4">
                    {(drafts ?? []).map((d) => {
                      const x = d.extracted as {
                        supplier?: string;
                        date?: string;
                        notes?: string;
                        lines?: ReviewLine[];
                      };
                      const lines = x.lines ?? [];
                      const flaggedCount = lines.filter((l) => l.flags.length > 0).length;
                      const knownSupplier = (suppliers ?? []).find(
                        (s) =>
                          (s.name as string).toLowerCase() ===
                          (x.supplier ?? '').trim().toLowerCase(),
                      );
                      const date =
                        /^\d{4}-\d{2}-\d{2}$/.test(x.date ?? '') && x.date! <= today
                          ? x.date!
                          : today;
                      return (
                        <li key={d.id}>
                          <Card className="p-5">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <p className="font-semibold">
                                {ctx.branches.find((b) => b.id === d.branch_id)?.name ?? ''} ·{' '}
                                {t(`source.${d.source as string}`)}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <Badge tone="accent" icon={<Sparkles />}>
                                  {t('aiDraftBadge')}
                                </Badge>
                                {flaggedCount > 0 ? (
                                  <StatusBadge tone="warning">
                                    {t('toCheck', { count: flaggedCount })}
                                  </StatusBadge>
                                ) : null}
                              </div>
                            </div>
                            {d.raw_text ? (
                              <p className="glass-tile mb-3 rounded-input p-3 text-sm whitespace-pre-wrap">
                                {d.raw_text as string}
                              </p>
                            ) : null}
                            {x.notes ? (
                              <p className="mb-3 text-sm text-secondary">{x.notes}</p>
                            ) : null}
                            <ActionForm
                              action={confirmPurchaseDraftAction}
                              successKey="purchases.recorded"
                              className="space-y-2"
                            >
                              {hidden}
                              <input type="hidden" name="draftId" value={d.id as string} />
                              <input type="hidden" name="branchId" value={d.branch_id as string} />
                              <div className="grid gap-3 sm:grid-cols-3">
                                {supplierFields(
                                  `c-${d.id as string}`,
                                  knownSupplier
                                    ? { id: knownSupplier.id as string }
                                    : { name: x.supplier ?? '' },
                                )}
                                <div>
                                  <Label htmlFor={`c-date-${d.id as string}`}>{t('date')}</Label>
                                  <Input
                                    id={`c-date-${d.id as string}`}
                                    name="purchasedOn"
                                    type="date"
                                    max={today}
                                    defaultValue={date}
                                    required
                                  />
                                </div>
                              </div>
                              {[...lines, undefined, undefined].map((l, i) => lineRow(i, l))}
                              {flaggedCount > 0 ? (
                                <p className="flex items-center gap-1.5 text-xs text-warning">
                                  <AlertTriangle aria-hidden className="size-3.5" />
                                  {t('flaggedHint')}
                                </p>
                              ) : null}
                              <Button type="submit" size="sm">
                                {t('confirm')}
                              </Button>
                            </ActionForm>
                            <form action={discardPurchaseDraftAction} className="mt-2">
                              {hidden}
                              <input type="hidden" name="draftId" value={d.id as string} />
                              <Button type="submit" size="sm" variant="ghost">
                                {t('discard')}
                              </Button>
                            </form>
                          </Card>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })()
        : null}

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
          {ctx.isOwner ? (
            <Card className="lg:col-span-2">
              <CardTitle>{t('marketTitle')}</CardTitle>
              <p className="-mt-2 mb-4 max-w-3xl text-sm text-secondary">{t('marketBody')}</p>
              <ActionForm
                action={importReferencePricesAction}
                successKey="purchases.marketImported"
                className="space-y-3"
              >
                {hidden}
                <Textarea
                  name="csv"
                  rows={5}
                  required
                  maxLength={100000}
                  aria-label={t('marketCsv')}
                  placeholder={t('marketPlaceholder')}
                  className="font-mono text-sm"
                />
                <Button type="submit" variant="secondary">
                  {t('marketImport')}
                </Button>
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

function defaultUnit(base: BaseUnit | undefined): PurchaseUnit {
  return base === 'pcs' ? 'pcs' : base === 'ml' ? 'l' : 'kg';
}
