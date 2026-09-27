'use client';

import { useTranslations } from 'next-intl';
import { formatBDT, formatDhakaDateTime, type Locale } from '@/lib/i18n/format';
import type { OrderLine, OrderRow, ReceiptInfo } from './client';
import { useTill } from './till-context';

/**
 * The printable sheet (ARCHITECTURE.md: Phase 1 browser print, 58/80mm). Rendered off-screen at all
 * times and only made visible by the print stylesheet (globals.css `.print-sheet`), so printing is
 * just `window.print()` — no PDF library, no server round trip, and it works offline.
 *
 * TODO(verify): the Mushak 6.3 layout (BIN, legal name, address, VAT lines) must be confirmed with
 * an accountant before these receipts are presented as compliant (ADR 0012 §2).
 */
export function Receipt({
  kind,
  order,
  lines,
  info,
  tableName,
  locale,
}: {
  kind: 'receipt' | 'kot';
  order: OrderRow;
  lines: OrderLine[];
  info: ReceiptInfo;
  tableName: string | null;
  locale: Locale;
}) {
  const t = useTranslations('pos');
  const { device } = useTill();
  const money = (poisha: number) => formatBDT(poisha, locale, { poisha: 'always' });
  const activeLines = lines.filter((l) => l.status === 'active');
  const number =
    order.order_number !== null ? t('orderNumber', { number: order.order_number }) : null;

  return (
    <div className="print-sheet">
      {kind === 'receipt' ? (
        <>
          <p className="center bold">{info.legalName ?? info.orgName}</p>
          <p className="center">{device.branchName}</p>
          {info.address ? <p className="center">{info.address}</p> : null}
          {info.phone ? <p className="center">{info.phone}</p> : null}
          {info.bin ? <p className="center">{t('receiptBin', { bin: info.bin })}</p> : null}
        </>
      ) : (
        <>
          <p className="center bold big">{t('kotLabel')}</p>
          <p className="center">{device.branchName}</p>
        </>
      )}
      {number ? <p className="center bold">{number}</p> : null}
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
          <p className="center">
            {order.invoice_no ?? `${order.provisional_receipt_no ?? ''} (${t('provisional')})`}
          </p>
          {info.footer ? <p className="center">{info.footer}</p> : null}
        </>
      ) : null}
    </div>
  );
}
