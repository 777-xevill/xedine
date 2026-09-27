/**
 * Money (CLAUDE.md non-negotiable #3, ADR 0005). Money is integer poisha (৳1 = 100 poisha).
 * Never multiply a price by a quantity in a component — go through computeLine().
 *
 * Rounding: half away from zero, applied once per component at the order-line level, so an
 * order's total is the sum of its lines' rounded components and a receipt always adds up.
 */
export type Poisha = number;

const BPS = 10_000n;

export function assertPoisha(value: number, label = 'amount'): Poisha {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of poisha, got ${value}`);
  }
  return value;
}

/** Integer division rounding half away from zero. Uses BigInt so large amounts never overflow. */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(`roundHalfUp needs integer numerator and positive denominator`);
  }
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const q = (2n * abs + d) / (2n * d);
  return Number(negative ? -q : q);
}

/** amount × rate, where rate is in basis points (500 bps = 5%). */
export function mulBps(amount: Poisha, bps: number): Poisha {
  assertPoisha(amount);
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError(`bps must be a non-negative integer`);
  const scaled = BigInt(amount) * BigInt(bps);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const q = (2n * abs + BPS) / (2n * BPS);
  return Number(negative ? -q : q);
}

/** The org-level tax settings that decide how a menu price decomposes (ADR 0005). */
export interface VatConfig {
  /** true: the menu price already contains VAT. false: VAT is added at the till. */
  priceIncludesVat: boolean;
  /** TODO(verify): regulatory — owner-entered config, never a hardcoded fact. */
  vatRateBps: number;
  serviceChargeBps: number;
  /** TODO(verify): whether VAT applies to the service charge. */
  vatOnServiceCharge: boolean;
}

export interface LineInput {
  /** The price as printed on the menu (VAT-inclusive or not, per VatConfig). */
  unitPricePoisha: Poisha;
  quantity: number;
  /** Discount on the printed-price basis. */
  discountPoisha?: Poisha;
}

export interface LineAmounts {
  /** quantity × unit price, on the printed basis. */
  grossPoisha: Poisha;
  /** Discount on the printed basis. */
  discountPoisha: Poisha;
  /** VAT-exclusive value before discount. sales.gross sums this. */
  netBeforeDiscountPoisha: Poisha;
  /** VAT-exclusive discount. sales.discounts sums this. */
  discountNetPoisha: Poisha;
  /** VAT-exclusive value after discount. The only input to sales.net. */
  netPoisha: Poisha;
  vatPoisha: Poisha;
  serviceChargePoisha: Poisha;
  /** What the customer pays for this line. */
  totalPoisha: Poisha;
}

function assertConfig(cfg: VatConfig): void {
  for (const [name, v] of [
    ['vatRateBps', cfg.vatRateBps],
    ['serviceChargeBps', cfg.serviceChargeBps],
  ] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 10_000) {
      throw new RangeError(`${name} must be an integer in [0, 10000], got ${v}`);
    }
  }
}

/** Net (VAT-exclusive) value of a printed-basis amount. */
function netOf(printed: Poisha, cfg: VatConfig): Poisha {
  if (!cfg.priceIncludesVat) return printed;
  // net = printed / (1 + rate)
  return roundHalfUp(printed * 10_000, 10_000 + cfg.vatRateBps);
}

export function computeLine(input: LineInput, cfg: VatConfig): LineAmounts {
  assertConfig(cfg);
  assertPoisha(input.unitPricePoisha, 'unitPricePoisha');
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new RangeError(`quantity must be an integer >= 1, got ${input.quantity}`);
  }
  if (input.unitPricePoisha < 0) throw new RangeError('unitPricePoisha must be >= 0');

  const gross = input.unitPricePoisha * input.quantity;
  const discount = input.discountPoisha ?? 0;
  assertPoisha(discount, 'discountPoisha');
  if (discount < 0 || discount > gross) {
    throw new RangeError(`discountPoisha must be within [0, ${gross}], got ${discount}`);
  }

  const base = gross - discount;
  const netBefore = netOf(gross, cfg);
  const net = netOf(base, cfg);
  const vatItem = cfg.priceIncludesVat ? base - net : mulBps(net, cfg.vatRateBps);
  const service = mulBps(net, cfg.serviceChargeBps);
  const vatService = cfg.vatOnServiceCharge ? mulBps(service, cfg.vatRateBps) : 0;
  const vat = vatItem + vatService;

  return {
    grossPoisha: gross,
    discountPoisha: discount,
    netBeforeDiscountPoisha: netBefore,
    discountNetPoisha: netBefore - net,
    netPoisha: net,
    vatPoisha: vat,
    serviceChargePoisha: service,
    totalPoisha: net + vat + service,
  };
}

export function sumLines(lines: readonly LineAmounts[]): LineAmounts {
  const zero: LineAmounts = {
    grossPoisha: 0,
    discountPoisha: 0,
    netBeforeDiscountPoisha: 0,
    discountNetPoisha: 0,
    netPoisha: 0,
    vatPoisha: 0,
    serviceChargePoisha: 0,
    totalPoisha: 0,
  };
  return lines.reduce<LineAmounts>(
    (acc, l) => ({
      grossPoisha: acc.grossPoisha + l.grossPoisha,
      discountPoisha: acc.discountPoisha + l.discountPoisha,
      netBeforeDiscountPoisha: acc.netBeforeDiscountPoisha + l.netBeforeDiscountPoisha,
      discountNetPoisha: acc.discountNetPoisha + l.discountNetPoisha,
      netPoisha: acc.netPoisha + l.netPoisha,
      vatPoisha: acc.vatPoisha + l.vatPoisha,
      serviceChargePoisha: acc.serviceChargePoisha + l.serviceChargePoisha,
      totalPoisha: acc.totalPoisha + l.totalPoisha,
    }),
    zero,
  );
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/**
 * Parse an owner-typed taka amount into poisha. Accepts Latin or Bangla digits, an optional ৳,
 * lakh/thousand commas and up to two decimals. Returns null for anything ambiguous — the caller
 * shows a validation error rather than guessing.
 */
export function parseTakaToPoisha(input: string): Poisha | null {
  const latin = input.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  const cleaned = latin.replace(/[৳\s,]/g, '');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, whole, frac = ''] = match;
  const poisha = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(poisha)) return null;
  return sign === '-' ? -poisha : poisha;
}

/** Poisha as a plain decimal taka string for files (e.g. CSV): exact integer maths, no float rounding. */
export function poishaToTakaText(poisha: number): string {
  if (!Number.isSafeInteger(poisha)) throw new RangeError('poishaToTakaText needs integer poisha');
  const abs = Math.abs(poisha);
  return `${poisha < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
