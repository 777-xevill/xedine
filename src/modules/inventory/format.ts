import { formatNumber, type Locale } from '@/lib/i18n/format';
import { splitQuantity, type BaseUnit, type PurchaseUnit } from '@/modules/purchasing/lines';

/**
 * A stock quantity for people: 2,500 g → "2.5 kg" (২.৫ কেজি in Bangla), up to three decimals, trailing
 * zeros dropped. `unit` gives the translated unit label. `maxDecimals` shortens it for screens that
 * want a quick read ("9.4 kg" rather than "9.404 kg").
 */
export function formatQuantity(
  qtyBase: number,
  base: BaseUnit,
  locale: Locale,
  unit: (u: PurchaseUnit) => string,
  opts: { maxDecimals?: number } = {},
): string {
  const { value, unit: u } = splitQuantity(qtyBase, base);
  const factor = 10 ** (opts.maxDecimals ?? 3);
  const rounded = Math.round(value * factor) / factor;
  const digits = String(rounded).split('.')[1]?.length ?? 0;
  return `${formatNumber(rounded, locale, { fractionDigits: digits })} ${unit(u)}`;
}
