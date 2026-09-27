import { computeLine, sumLines, type VatConfig } from '@/lib/money';
import type { OrderLine, OrderRow } from './client';

/**
 * What the till shows before (or without) a server answer. The server always recomputes and
 * charges its own price (insert_order_lines); these figures use the same shared money helper, so
 * online they match and offline they are the best the cached menu can say.
 */
export interface LocalLineInput {
  menuItemId: string;
  name: string;
  /** Item price (branch/variant-resolved) plus the chosen add-ons, per unit, printed basis. */
  unitPricePoisha: number;
  quantity: number;
  note?: string;
}

export function buildLocalOrder(args: {
  orderId: string;
  lines: LocalLineInput[];
  vat: VatConfig;
  serviceChargeBps: number;
  channelId: string;
  tableId: string | null;
  placedAt: string;
  provisionalReceiptNo: string;
  makeLineId: () => string;
}): { order: OrderRow; lines: OrderLine[] } {
  const cfg = { ...args.vat, serviceChargeBps: args.serviceChargeBps };
  const amounts = args.lines.map((l) =>
    computeLine({ unitPricePoisha: l.unitPricePoisha, quantity: l.quantity }, cfg),
  );
  const total = sumLines(amounts);
  return {
    order: {
      id: args.orderId,
      order_status: 'open',
      payment_status: 'unpaid',
      order_number: null,
      invoice_no: null,
      provisional_receipt_no: args.provisionalReceiptNo,
      net_poisha: total.netPoisha,
      vat_poisha: total.vatPoisha,
      service_charge_poisha: total.serviceChargePoisha,
      discount_poisha: total.discountNetPoisha,
      total_poisha: total.totalPoisha,
      channel_id: args.channelId,
      table_id: args.tableId,
      customer_id: null,
      placed_at: args.placedAt,
    },
    lines: args.lines.map((l, i) => ({
      id: args.makeLineId(),
      menu_item_id: l.menuItemId,
      name_snapshot: l.name,
      quantity: l.quantity,
      unit_price_poisha: l.unitPricePoisha,
      total_poisha: amounts[i]!.totalPoisha,
      status: 'active',
      kot_sent_at: null,
      station_id: null,
      notes: l.note ?? null,
    })),
  };
}

export type TenderResult =
  | {
      ok: true;
      appliedPoisha: number;
      changePoisha: number;
      paidPoisha: number;
      fullyPaid: boolean;
    }
  | { ok: false; reason: 'invalid_amount' | 'nothing_due' | 'over_balance' };

/**
 * The same rule record_payment applies on the server: cash above the balance is change and is
 * never counted as paid; any other method above the balance is refused.
 */
export function applyTender(args: {
  totalPoisha: number;
  paidPoisha: number;
  method: string;
  amountPoisha: number;
}): TenderResult {
  if (!Number.isSafeInteger(args.amountPoisha) || args.amountPoisha <= 0)
    return { ok: false, reason: 'invalid_amount' };
  const due = args.totalPoisha - args.paidPoisha;
  if (due <= 0) return { ok: false, reason: 'nothing_due' };
  if (args.amountPoisha > due && args.method !== 'cash')
    return { ok: false, reason: 'over_balance' };
  const applied = Math.min(args.amountPoisha, due);
  const paid = args.paidPoisha + applied;
  return {
    ok: true,
    appliedPoisha: applied,
    changePoisha: args.amountPoisha - applied,
    paidPoisha: paid,
    fullyPaid: paid >= args.totalPoisha,
  };
}

/**
 * A receipt number an offline till can print before the server assigns the real invoice number
 * (ADR 0012 §2). Unique per device: a short device prefix plus a per-device counter.
 */
export function provisionalReceiptNo(deviceId: string, counter: number): string {
  return `P-${deviceId.replace(/-/g, '').slice(0, 6).toUpperCase()}-${String(counter).padStart(5, '0')}`;
}
