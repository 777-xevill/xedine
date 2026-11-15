import { formatBDT, type Locale } from '@/lib/i18n/format';

/**
 * Prices on posters (ADR 0057). Pure, so the job (art.ts) and the Growth preview share it; the preview
 * must never import the job's modules, which load the native cut-out model.
 */
export interface PriceInput {
  basePoisha: number;
  /** Prices a branch sets for this dish (no variant), when it is on sale there. */
  branchPoisha: number[];
}

/**
 * The price a poster may print: the menu price, only when every branch sells the dish at that price (a
 * public post cannot say which branch it means). Formatted with the shared formatter (Bangla digits in
 * Bangla); "+VAT" is added when menu prices do not include VAT.
 */
export function posterPrice(
  p: PriceInput,
  locale: Locale,
  vat: { included: boolean; plusVat: string },
): string | null {
  if (!Number.isSafeInteger(p.basePoisha) || p.basePoisha <= 0) return null;
  if (p.branchPoisha.some((b) => b !== p.basePoisha)) return null;
  const price = formatBDT(p.basePoisha, locale);
  return vat.included ? price : `${price} ${vat.plusVat}`;
}

/** Branch prices per dish, from branch_item_prices rows (no variant, on sale). */
export function branchPricesByItem(
  rows: readonly { menu_item_id: string; price_poisha: number | string }[],
): Map<string, number[]> {
  const byItem = new Map<string, number[]>();
  for (const b of rows)
    byItem.set(b.menu_item_id, [...(byItem.get(b.menu_item_id) ?? []), Number(b.price_poisha)]);
  return byItem;
}
