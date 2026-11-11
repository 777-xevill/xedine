/**
 * Food facts on the customer's menu (ADR 0049): pure helpers shared by the table page, its AI helper and
 * the owner's Food facts page. No server-only imports — the table page's menu filters run on the phone.
 *
 * Every figure a customer sees comes from the approved row in dish_nutrition (CLAUDE.md #1): the quick
 * picks below sort and filter those figures, they never compute new ones.
 */

/** The allergens a dish can be marked with; the database check uses the same list. */
export const ALLERGENS = [
  'nuts',
  'milk',
  'egg',
  'gluten',
  'fish',
  'shellfish',
  'soy',
  'sesame',
  'beef',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const isAllergen = (v: unknown): v is Allergen =>
  typeof v === 'string' && (ALLERGENS as readonly string[]).includes(v);

/** A dish's approved facts, as the table page reads them (all null when none are approved). */
export interface FactsFields {
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  allergens: string[] | null;
}

export interface FactsDish extends FactsFields {
  name: string;
  name_bn: string | null;
  price_poisha: number;
}

export const hasFacts = (d: FactsFields): d is FactsFields & { kcal: number; protein_g: number } =>
  d.kcal !== null && d.protein_g !== null;

/** A light dish is at most this many kcal (the "Light" quick pick). */
export const LIGHT_KCAL = 500;
/** The "budget" quick pick: up to this price. */
export const BUDGET_POISHA = 300_00;
const PICKS = 3;

export type QuickPick = 'protein' | 'light' | 'budget';

/**
 * The quick-pick buttons: up to three dishes, chosen only from the facts and prices the restaurant
 * approved. A dish without approved facts is never offered for protein or light.
 */
export function quickPick<T extends FactsDish>(
  dishes: T[],
  pick: QuickPick,
  avoid: Allergen[] = [],
): T[] {
  const safe = dishes.filter((d) => isSafe(d, avoid));
  if (pick === 'protein')
    return safe
      .filter(hasFacts)
      .sort((a, b) => Number(b.protein_g) - Number(a.protein_g) || a.price_poisha - b.price_poisha)
      .slice(0, PICKS);
  if (pick === 'light')
    return safe
      .filter((d) => hasFacts(d) && Number(d.kcal) <= LIGHT_KCAL)
      .sort((a, b) => Number(b.protein_g) - Number(a.protein_g) || Number(a.kcal) - Number(b.kcal))
      .slice(0, PICKS);
  return safe
    .filter((d) => d.price_poisha > 0 && d.price_poisha <= BUDGET_POISHA)
    .sort(
      (a, b) =>
        Number(b.protein_g ?? -1) - Number(a.protein_g ?? -1) || a.price_poisha - b.price_poisha,
    )
    .slice(0, PICKS);
}

/**
 * The allergy filter: a dish stays when the restaurant approved its facts and none of its allergens is
 * one the customer avoids. With nothing avoided every dish stays; a dish nobody checked is hidden while
 * the filter is on, because "not marked" is not the same as "safe".
 */
export function isSafe(d: FactsFields, avoid: Allergen[]): boolean {
  if (avoid.length === 0) return true;
  if (!hasFacts(d) || d.allergens === null) return false;
  return !d.allergens.some((a) => (avoid as string[]).includes(a));
}

/** One line per dish for the AI helper: the facts it may quote, nothing else (prices as taka). */
export function factsLine(d: FactsDish): string {
  const parts = [d.name_bn && d.name_bn !== d.name ? `${d.name} (${d.name_bn})` : d.name];
  parts.push(`price_taka=${Math.round(d.price_poisha / 100)}`);
  if (hasFacts(d)) {
    parts.push(`kcal=${d.kcal}`, `protein_g=${d.protein_g}`);
    if (d.carbs_g !== null) parts.push(`carbs_g=${d.carbs_g}`);
    if (d.fat_g !== null) parts.push(`fat_g=${d.fat_g}`);
    parts.push(`contains=${(d.allergens ?? []).join('/') || 'none marked'}`);
  } else {
    parts.push('facts=not checked');
  }
  return parts.join(' | ');
}

/** The dishes the AI named, matched back to the menu (English or Bangla name, any case), at most three. */
export function matchDishes<T extends FactsDish>(names: string[], dishes: T[]): T[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const out: T[] = [];
  for (const n of names) {
    const key = norm(n);
    const d = dishes.find(
      (x) => norm(x.name) === key || (x.name_bn !== null && norm(x.name_bn) === key),
    );
    if (d && !out.includes(d)) out.push(d);
    if (out.length === PICKS) break;
  }
  return out;
}
