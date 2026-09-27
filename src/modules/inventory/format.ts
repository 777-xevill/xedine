import { formatNumber, type Locale } from '@/lib/i18n/format';
import { splitQuantity, type BaseUnit, type PurchaseUnit } from '@/modules/purchasing/lines';

/**
 * A stock quantity for people: 2,500 g → "2.5 kg" (৩.৫ কেজি in Bangla), up to three decimals, trailing
 * zeros dropped. `unit` gives the translated unit label.
 */
export function formatQuantity(
  qtyBase: number,
  base: BaseUnit,
  locale: Locale,
  unit: (u: PurchaseUnit) => string,
): string {
  const { value, unit: u } = splitQuantity(qtyBase, base);
  const rounded = Math.round(value * 1000) / 1000;
  const digits = String(rounded).split('.')[1]?.length ?? 0;
  return `${formatNumber(rounded, locale, { fractionDigits: digits })} ${unit(u)}`;
}
