import { describe, expect, it } from 'vitest';
import {
  computeLine,
  mulBps,
  parseTakaToPoisha,
  roundHalfUp,
  sumLines,
  type VatConfig,
} from './index';

const inclusive: VatConfig = {
  priceIncludesVat: true,
  vatRateBps: 500,
  serviceChargeBps: 0,
  vatOnServiceCharge: false,
};
const exclusive: VatConfig = { ...inclusive, priceIncludesVat: false };

describe('roundHalfUp / mulBps', () => {
  it('rounds half away from zero', () => {
    expect(roundHalfUp(5, 2)).toBe(3);
    expect(roundHalfUp(4, 2)).toBe(2);
    expect(roundHalfUp(-5, 2)).toBe(-3);
    expect(roundHalfUp(1, 3)).toBe(0);
    expect(roundHalfUp(2, 3)).toBe(1);
  });

  it('mulBps: 5% of ৳300.00 is ৳15.00', () => {
    expect(mulBps(30_000, 500)).toBe(1_500);
    expect(mulBps(30_001, 500)).toBe(1_500); // 1500.05 → 1500
    expect(mulBps(30_010, 500)).toBe(1_501); // 1500.5 → 1501
  });

  it('does not overflow on very large amounts', () => {
    const huge = 900_000_000_000_000; // ৳9 trillion
    expect(mulBps(huge, 10_000)).toBe(huge);
  });

  it('rejects non-integers', () => {
    expect(() => mulBps(1.5, 500)).toThrow(RangeError);
    expect(() => mulBps(100, -1)).toThrow(RangeError);
  });
});

describe('computeLine — ADR 0005 worked examples', () => {
  it('inclusive: menu ৳300 → customer pays ৳300, net ৳285.71 + VAT ৳14.29', () => {
    const l = computeLine({ unitPricePoisha: 30_000, quantity: 1 }, inclusive);
    expect(l.totalPoisha).toBe(30_000);
    expect(l.netPoisha).toBe(28_571);
    expect(l.vatPoisha).toBe(1_429);
    expect(l.netPoisha + l.vatPoisha).toBe(30_000);
  });

  it('exclusive: menu ৳300 → customer pays ৳315, net ৳300 + VAT ৳15', () => {
    const l = computeLine({ unitPricePoisha: 30_000, quantity: 1 }, exclusive);
    expect(l.totalPoisha).toBe(31_500);
    expect(l.netPoisha).toBe(30_000);
    expect(l.vatPoisha).toBe(1_500);
  });

  it('service charge is added on top of net in both modes', () => {
    const cfg = (priceIncludesVat: boolean): VatConfig => ({
      ...inclusive,
      priceIncludesVat,
      serviceChargeBps: 500,
    });
    const inc = computeLine({ unitPricePoisha: 30_000, quantity: 1 }, cfg(true));
    expect(inc.serviceChargePoisha).toBe(1_429); // 5% of 28,571 = 1,428.55
    expect(inc.totalPoisha).toBe(30_000 + 1_429);
    const exc = computeLine({ unitPricePoisha: 30_000, quantity: 1 }, cfg(false));
    expect(exc.serviceChargePoisha).toBe(1_500);
    expect(exc.totalPoisha).toBe(30_000 + 1_500 + 1_500);
  });

  it('VAT on service charge is opt-in', () => {
    const cfg: VatConfig = { ...exclusive, serviceChargeBps: 1_000, vatOnServiceCharge: true };
    const l = computeLine({ unitPricePoisha: 10_000, quantity: 1 }, cfg);
    expect(l.serviceChargePoisha).toBe(1_000);
    expect(l.vatPoisha).toBe(500 + 50); // 5% of 10,000 + 5% of 1,000
  });

  it('discounts reduce the VAT-exclusive value consistently (METRICS: gross − discounts = net)', () => {
    const l = computeLine(
      { unitPricePoisha: 30_000, quantity: 2, discountPoisha: 6_000 },
      inclusive,
    );
    expect(l.grossPoisha).toBe(60_000);
    expect(l.netBeforeDiscountPoisha - l.discountNetPoisha).toBe(l.netPoisha);
    expect(l.netPoisha + l.vatPoisha).toBe(54_000); // inclusive: printed basis after discount
  });

  it('a 0% VAT rate leaves net equal to the printed price in both modes', () => {
    for (const cfg of [inclusive, exclusive]) {
      const l = computeLine({ unitPricePoisha: 12_345, quantity: 3 }, { ...cfg, vatRateBps: 0 });
      expect(l.netPoisha).toBe(37_035);
      expect(l.vatPoisha).toBe(0);
      expect(l.totalPoisha).toBe(37_035);
    }
  });

  it('rejects bad input', () => {
    expect(() => computeLine({ unitPricePoisha: 100, quantity: 0 }, inclusive)).toThrow(RangeError);
    expect(() => computeLine({ unitPricePoisha: 100, quantity: 1.5 }, inclusive)).toThrow(
      RangeError,
    );
    expect(() => computeLine({ unitPricePoisha: 100.5, quantity: 1 }, inclusive)).toThrow(
      RangeError,
    );
    expect(() =>
      computeLine({ unitPricePoisha: 100, quantity: 1, discountPoisha: 101 }, inclusive),
    ).toThrow(RangeError);
    expect(() =>
      computeLine({ unitPricePoisha: 100, quantity: 1 }, { ...inclusive, vatRateBps: -1 }),
    ).toThrow(RangeError);
  });
});

describe('a receipt always adds up, under both settings (ROADMAP Phase 0 Done-when)', () => {
  // Deterministic pseudo-random sweep: no Math.random, so failures reproduce.
  function* prices(): Generator<number> {
    let x = 12_345;
    for (let i = 0; i < 300; i++) {
      x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
      yield 500 + (x % 250_000);
    }
  }

  for (const [label, base] of [
    ['inclusive', inclusive],
    ['exclusive', exclusive],
  ] as const) {
    it(`${label}: sum of line totals = sum of line components`, () => {
      const cfg: VatConfig = { ...base, serviceChargeBps: 500, vatOnServiceCharge: true };
      const lines = [...prices()].map((p, i) =>
        computeLine(
          { unitPricePoisha: p, quantity: (i % 4) + 1, discountPoisha: i % 3 === 0 ? 100 : 0 },
          cfg,
        ),
      );
      for (const l of lines) {
        expect(l.totalPoisha).toBe(l.netPoisha + l.vatPoisha + l.serviceChargePoisha);
        expect(l.netBeforeDiscountPoisha - l.discountNetPoisha).toBe(l.netPoisha);
      }
      const order = sumLines(lines);
      expect(order.totalPoisha).toBe(order.netPoisha + order.vatPoisha + order.serviceChargePoisha);
      expect(order.totalPoisha).toBe(lines.reduce((s, l) => s + l.totalPoisha, 0));
    });
  }

  it('inclusive: net + item VAT equals the printed price after discount, for every line', () => {
    for (const p of prices()) {
      const l = computeLine({ unitPricePoisha: p, quantity: 2, discountPoisha: 50 }, inclusive);
      expect(l.netPoisha + l.vatPoisha).toBe(l.grossPoisha - l.discountPoisha);
    }
  });
});

describe('parseTakaToPoisha', () => {
  it('parses Latin, Bangla, symbols and lakh commas', () => {
    expect(parseTakaToPoisha('300')).toBe(30_000);
    expect(parseTakaToPoisha('৳1,23,456.50')).toBe(12_345_650);
    expect(parseTakaToPoisha('১২৩৪.৫')).toBe(123_450);
    expect(parseTakaToPoisha('0.05')).toBe(5);
    expect(parseTakaToPoisha('-250')).toBe(-25_000);
  });

  it('returns null rather than guessing', () => {
    expect(parseTakaToPoisha('')).toBeNull();
    expect(parseTakaToPoisha('12.345')).toBeNull();
    expect(parseTakaToPoisha('abc')).toBeNull();
    expect(parseTakaToPoisha('1.2.3')).toBeNull();
  });
});
