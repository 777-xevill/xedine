'use client';

import { useTranslations } from 'next-intl';
import { formatBDT, formatDhakaDateTime, type Locale } from '@/lib/i18n/format';
import type { OrderLine, OrderRow } from './client';

/**
 * The printable sheet (ARCHITECTURE.md: Phase 1 browser print, 58/80mm). Rendered off-screen at all
 * times and only made visible by the print stylesheet (globals.css `.print-sheet`), so printing is
 * just `window.print()` — no PDF library, no server round trip.
 */
export function Receipt({
  kind,
  order,
  lines,
  orgName,
  branchName,
  tableName,
  locale,
}: {
  kind: 'receipt' | 'kot';
  order: OrderRow;
  lines: OrderLine[];
  orgName: string;
  branchName: string;
  tableName: string | null;
  locale: Locale;
}) {
  const t = useTranslations('pos');
  const money = (poisha: number) => formatBDT(poisha, locale, { poisha: 'always' });
  const activeLines = lines.filter((l) => l.status === 'active');

  return (
    <div className="print-sheet">
      <p className="center bold">{orgName}</p>
      <p className="center">{branchName}</p>
      {kind === 'kot' ? <p className="center bold">KOT</p> : null}
      {tableName ? <p className="center">{tableName}</p> : null}
      <p className="center">{formatDhakaDateTime(new Date(order.placed_at), locale)}</p>
      <div className="rule" />
      {activeLines.map((l) => (
        <div key={l.id}>
          <div className="row">
            <span>
              {l.quantity} × {l.name_snapshot}
            </span>
            {kind === 'receipt' ? <span>{money(l.total_poisha)}</span> : null}
          </div>
          {l.notes ? <p>&nbsp;&nbsp;{l.notes}</p> : null}
        </div>
      ))}
      <div className="rule" />
      {kind === 'receipt' ? (
        <>
          <div className="row">
            <span>{t('subtotal')}</span>
            <span>{money(order.net_poisha)}</span>
          </div>
          {order.discount_poisha > 0 ? (
            <div className="row">
              <span>{t('discount')}</span>
              <span>-{money(order.discount_poisha)}</span>
            </div>
          ) : null}
          <div className="row">
            <span>{t('vat')}</span>
            <span>{money(order.vat_poisha)}</span>
          </div>
          {order.service_charge_poisha > 0 ? (
            <div className="row">
              <span>{t('serviceCharge')}</span>
              <span>{money(order.service_charge_poisha)}</span>
            </div>
          ) : null}
          <div className="rule" />
          <div className="row bold">
            <span>{t('total')}</span>
            <span>{money(order.total_poisha)}</span>
          </div>
          <div className="rule" />
          <p className="center">{order.invoice_no ?? order.provisional_receipt_no}</p>
        </>
      ) : null}
    </div>
  );
}
