import { parseQuantity, splitQuantity, type BaseUnit } from '@/modules/purchasing/lines';

/**
 * A dish's ingredients as people write them (ADR 0037): one row per ingredient, the amount that goes
 * into one plate, in a unit they think in. Pure, so it is unit-tested; the page and the actions only
 * call it. Amounts go to the database in base units (g, ml, pieces), as stock keeps them.
 */

/**
 * Every unit a row can use, with the base unit it is kept in and how many of that it is. Besides the
 * metric ones there are the words a kitchen uses: dozen, slice, packet, bunch (counted as pieces, so one
 * slice is one piece of stock) and spoon / cup measures (millilitres: 1 tsp = 5, 1 tbsp = 15, 1 cup = 240).
 */
export const DISH_UNIT_INFO = {
  g: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  l: { base: 'ml', factor: 1000 },
  tsp: { base: 'ml', factor: 5 },
  tbsp: { base: 'ml', factor: 15 },
  cup: { base: 'ml', factor: 240 },
  pcs: { base: 'pcs', factor: 1 },
  slice: { base: 'pcs', factor: 1 },
  packet: { base: 'pcs', factor: 1 },
  bunch: { base: 'pcs', factor: 1 },
  dozen: { base: 'pcs', factor: 12 },
} as const satisfies Record<string, { base: BaseUnit; factor: number }>;
export type DishUnit = keyof typeof DISH_UNIT_INFO;
export const DISH_UNITS = Object.keys(DISH_UNIT_INFO) as [DishUnit, ...DishUnit[]];
export const MAX_DISH_ROWS = 40;

export interface DishRow {
  name: string;
  /** As typed: Latin or Bangla digits ("150", "১৫০", "1.5"). */
  qty: string;
  unit: DishUnit;
}

export interface KnownIngredient {
  id: string;
  name: string;
  name_bn: string | null;
  base: BaseUnit;
}

/** What save_recipe takes: an existing ingredient, or a new one by name (created without a price). */
export type RecipeLine =
  | { ingredient_id: string; qty_base: number }
  | { ingredient: string; base: BaseUnit; qty_base: number };

export type DishError =
  | { error: 'dishEmpty' }
  | { error: 'dishName' }
  | { error: 'dishAmount' | 'dishUnit'; name: string };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The ingredient a typed name means: its English or Bangla name, exactly (case and spaces aside).
 * Never a partial guess: "chicken" must not quietly become "Chicken wings".
 */
export function findIngredient(name: string, list: KnownIngredient[]): KnownIngredient | null {
  const n = norm(name);
  if (!n) return null;
  return (
    list.find((i) => norm(i.name) === n) ??
    list.find((i) => i.name_bn !== null && norm(i.name_bn) === n) ??
    null
  );
}

/** The units a row may use: an existing ingredient's family (no grams of eggs), else all of them. */
export function unitsForRow(known: KnownIngredient | null): DishUnit[] {
  if (!known) return [...DISH_UNITS];
  return DISH_UNITS.filter((u) => DISH_UNIT_INFO[u].base === known.base);
}

/** Rows → recipe lines in base units. Blank rows are skipped; the first problem is returned. */
export function dishLines(
  rows: DishRow[],
  list: KnownIngredient[],
): { lines: RecipeLine[] } | DishError {
  const lines: RecipeLine[] = [];
  for (const r of rows) {
    const name = r.name.trim().replace(/\s+/g, ' ');
    if (!name && !r.qty.trim()) continue;
    if (!name || name.length > 120) return { error: 'dishName' };
    const qty = parseQuantity(r.qty);
    if (qty === null || qty <= 0) return { error: 'dishAmount', name };
    const unit = DISH_UNIT_INFO[r.unit] as { base: BaseUnit; factor: number } | undefined;
    if (!unit) return { error: 'dishUnit', name };
    const known = findIngredient(name, list);
    if (known && known.base !== unit.base) return { error: 'dishUnit', name };
    // Round to a thousandth of a base unit: 1.25 kg is 1250 g, never 1249.9999.
    const qtyBase = Math.round(qty * unit.factor * 1000) / 1000;
    lines.push(
      known
        ? { ingredient_id: known.id, qty_base: qtyBase }
        : { ingredient: name, base: unit.base, qty_base: qtyBase },
    );
  }
  return lines.length === 0 ? { error: 'dishEmpty' } : { lines };
}

/** A stored amount as a row shows it: 1,500 g → "1.5" kg, 150 g → "150" g, 2 pieces → "2" pcs. */
export function editorAmount(qtyBase: number, base: BaseUnit): { qty: string; unit: DishUnit } {
  const { value, unit } = splitQuantity(qtyBase, base);
  const rounded = Math.round(value * 1000) / 1000;
  return { qty: String(rounded), unit };
}
