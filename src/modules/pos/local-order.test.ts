import { describe, expect, it } from 'vitest';
import { applyTender, buildLocalOrder, provisionalReceiptNo } from './local-order';

let n = 0;
const lineId = () => `line-${++n}`;

describe('local order totals', () => {
  it('matches the server decomposition for a VAT-exclusive dine-in order with service charge', () => {
    const { order, lines } = buildLocalOrder({
      orderId: 'o1',
      lines: [
        { menuItemId: 'kacchi', name: 'Kacchi', unitPricePoisha: 32_000, quantity: 2 },
        { menuItemId: 'borhani', name: 'Borhani', unitPricePoisha: 6_000, quantity: 1 },
      ],
      vat: {
        priceIncludesVat: false,
        vatRateBps: 500,
        serviceChargeBps: 1_000,
        vatOnServiceCharge: false,
      },
      serviceChargeBps: 1_000,
      channelId: 'dine',
      tableId: 't1',
      placedAt: '2026-09-21T17:00:00.000Z',
      provisionalReceiptNo: 'P-ABC-00001',
      makeLineId: lineId,
    });
    expect(order.net_poisha).toBe(70_000);
    expect(order.vat_poisha).toBe(3_500);
    expect(order.service_charge_poisha).toBe(7_000);
    expect(order.total_poisha).toBe(80_500);
    expect(lines.reduce((s, l) => s + l.total_poisha, 0)).toBe(order.total_poisha);
    expect(lines[0]!.kot_sent_at).toBeNull();
  });

  it('decomposes a VAT-inclusive price without changing what the customer pays', () => {
    const { order } = buildLocalOrder({
      orderId: 'o2',
      lines: [{ menuItemId: 'tea', name: 'Tea', unitPricePoisha: 3_000, quantity: 3 }],
      vat: {
        priceIncludesVat: true,
        vatRateBps: 1_500,
        serviceChargeBps: 0,
        vatOnServiceCharge: false,
      },
      serviceChargeBps: 0,
      channelId: 'takeaway',
      tableId: null,
      placedAt: '2026-09-21T17:00:00.000Z',
      provisionalReceiptNo: 'P-ABC-00002',
      makeLineId: lineId,
    });
    expect(order.total_poisha).toBe(9_000);
    expect(order.net_poisha + order.vat_poisha).toBe(9_000);
  });
});

describe('tenders', () => {
  it('splits a bill across methods and treats extra cash as change', () => {
    const first = applyTender({
      totalPoisha: 80_500,
      paidPoisha: 0,
      method: 'bkash',
      amountPoisha: 50_000,
    });
    expect(first).toEqual({
      ok: true,
      appliedPoisha: 50_000,
      changePoisha: 0,
      paidPoisha: 50_000,
      fullyPaid: false,
    });
    const second = applyTender({
      totalPoisha: 80_500,
      paidPoisha: 50_000,
      method: 'cash',
      amountPoisha: 50_000,
    });
    expect(second).toEqual({
      ok: true,
      appliedPoisha: 30_500,
      changePoisha: 19_500,
      paidPoisha: 80_500,
      fullyPaid: true,
    });
  });

  it('refuses non-cash above the balance, zero amounts and paying a paid order', () => {
    expect(
      applyTender({ totalPoisha: 1_000, paidPoisha: 0, method: 'card', amountPoisha: 1_500 }),
    ).toEqual({ ok: false, reason: 'over_balance' });
    expect(
      applyTender({ totalPoisha: 1_000, paidPoisha: 0, method: 'cash', amountPoisha: 0 }),
    ).toEqual({ ok: false, reason: 'invalid_amount' });
    expect(
      applyTender({ totalPoisha: 1_000, paidPoisha: 1_000, method: 'cash', amountPoisha: 100 }),
    ).toEqual({ ok: false, reason: 'nothing_due' });
  });
});

describe('provisional receipt numbers', () => {
  it('are per-device and zero-padded', () => {
    expect(provisionalReceiptNo('a1b2c3d4-0000-0000-0000-000000000000', 7)).toBe('P-A1B2C3-00007');
  });
});
