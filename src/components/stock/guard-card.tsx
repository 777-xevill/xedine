import {
  Archive,
  Hourglass,
  PackagePlus,
  ReceiptText,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ActionForm } from '@/components/action-form';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatBDT, formatDhakaDate, isLocale, type Locale } from '@/lib/i18n/format';
import { formatQuantity } from '@/modules/inventory/format';
import { hideItemAction } from '@/modules/inventory/guard-actions';
import { stockGuard, type GuardKind, type GuardRow } from '@/modules/inventory/guard';
import type { PurchaseUnit } from '@/modules/purchasing/lines';
import { ToneIcon, type Tone } from './parts';

/**
 * Stock Guard (ADR 0028): what in the stock records needs a person, in plain words, worst first. Every
 * figure is a metric_stock_guard field, formatted; the rules are in SQL, not here. The owner can hide
 * an item nobody buys any more straight from its row — the SQL refuses while any is on the shelf.
 */
const LOOK: Record<GuardKind, { tone: Tone; icon: ReactNode }> = {
  price_typo: { tone: 'danger', icon: <ReceiptText /> },
  below_zero: { tone: 'danger', icon: <TriangleAlert /> },
  idle_stock: { tone: 'warning', icon: <Hourglass /> },
  new_item: { tone: 'info', icon: <PackagePlus /> },
  unused: { tone: 'neutral', icon: <Archive /> },
  unused_unknown: { tone: 'neutral', icon: <Archive /> },
};

export async function StockGuardCard({
  orgId,
  orgSlug,
  branchId,
  canHide,
}: {
  orgId: string;
  orgSlug: string;
  branchId: string | null;
  canHide: boolean;
}) {
  const [rows, t, units, raw] = await Promise.all([
    stockGuard(orgId, branchId),
    getTranslations('stockGuard'),
    getTranslations('units'),
    getLocale(),
  ]);
  const locale: Locale = isLocale(raw) ? raw : 'bn';
  const unit = (u: PurchaseUnit) => units(u);
  const qty = (r: GuardRow, q: number) =>
    formatQuantity(q, r.base, locale, unit, { maxDecimals: 1 });
  const day = (d: string | null) =>
    d ? formatDhakaDate(new Date(`${d}T12:00:00+06:00`), locale) : '';
  const nameOf = (r: GuardRow) => (locale === 'bn' && r.name_bn ? r.name_bn : r.name);

  const say = (r: GuardRow): { title: string; body: string } => {
    const name = nameOf(r);
    switch (r.kind) {
      case 'price_typo':
        return {
          title: t('priceTypo.title', { name }),
          body: t('priceTypo.body', {
            paid: formatBDT(r.last_total_poisha ?? 0, locale),
            qty: qty(r, r.qty ?? 0),
            date: day(r.since),
            usual: formatBDT(r.usual_total_poisha ?? 0, locale),
          }),
        };
      case 'below_zero':
        return {
          title: t('belowZero.title', { name, qty: qty(r, r.qty ?? 0) }),
          body: t('belowZero.body'),
        };
      case 'idle_stock':
        return {
          title: t('idleStock.title', { name, qty: qty(r, r.qty ?? 0) }),
          body: t('idleStock.body', { date: day(r.since) }),
        };
      case 'new_item':
        return {
          title: t('newItem.title', { name }),
          body: r.actor
            ? t('newItem.byWhom', { who: r.actor, date: day(r.since) })
            : t('newItem.body', { date: day(r.since) }),
        };
      case 'unused':
        return {
          title: t('unused.title', { name }),
          body: t('unused.body', { date: day(r.since) }),
        };
      case 'unused_unknown':
        return {
          title: t('unusedUnknown.title', { name }),
          body: t('unusedUnknown.body', { date: day(r.since) }),
        };
    }
  };

  const hideForm = (r: GuardRow, noneLeft: boolean, label: string) => (
    <ActionForm action={hideItemAction} successKey="stockGuard.hidden" className="mt-2.5">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="ingredientId" value={r.ingredient_id} />
      <input type="hidden" name="noneLeft" value={noneLeft ? '1' : '0'} />
      <Button type="submit" variant="secondary" size="sm">
        {label}
      </Button>
    </ActionForm>
  );

  return (
    <section
      className="rounded-card border border-line bg-surface p-4 sm:p-5"
      data-testid="stock-guard"
    >
      <div className="flex items-start gap-3">
        <ToneIcon tone={rows.length === 0 ? 'success' : 'info'} icon={<ShieldCheck />} />
        <div className="min-w-0">
          <h2 className="text-base font-semibold sm:text-lg">{t('title')}</h2>
          <p className="text-sm text-secondary">
            {rows.length === 0 ? t('allClear') : t('intro', { count: rows.length })}
          </p>
        </div>
      </div>
      {rows.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {rows.map((r) => {
            const { title, body } = say(r);
            return (
              <li
                key={`${r.kind}-${r.ingredient_id}-${r.branch_id ?? ''}`}
                className="flex items-start gap-3 rounded-input border border-line p-3"
              >
                <ToneIcon tone={LOOK[r.kind].tone} icon={LOOK[r.kind].icon} className="size-9" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-secondary">{body}</p>
                  {r.kind === 'price_typo' ? (
                    <Link
                      href={`/${orgSlug}/purchases`}
                      className={buttonVariants({
                        variant: 'secondary',
                        size: 'sm',
                        className: 'mt-2.5',
                      })}
                    >
                      {t('priceTypo.action')}
                    </Link>
                  ) : null}
                  {canHide && r.kind === 'unused' ? hideForm(r, false, t('unused.action')) : null}
                  {canHide && r.kind === 'unused_unknown'
                    ? hideForm(r, true, t('unusedUnknown.action'))
                    : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-secondary">{t('howItWorks')}</p>
    </section>
  );
}
