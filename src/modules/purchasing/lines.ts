/**
 * Turning what a person wrote or said about a bazar purchase into purchase lines (ROADMAP Phase 5).
 * Pure, so it is unit-tested. The model only transcribes the chit; this code converts units, matches
 * ingredients and flags anything a person must check before the draft can be confirmed (CLAUDE.md #4).
 */

export type BaseUnit = 'g' | 'ml' | 'pcs';
export type PurchaseUnit = 'kg' | 'g' | 'l' | 'ml' | 'pcs' | 'dozen';

export const PURCHASE_UNITS: Record<PurchaseUnit, { base: BaseUnit; factor: number }> = {
  kg: { base: 'g', factor: 1000 },
  g: { base: 'g', factor: 1 },
  l: { base: 'ml', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  pcs: { base: 'pcs', factor: 1 },
  dozen: { base: 'pcs', factor: 12 },
};

/** The units a person may enter for an ingredient kept in `base`. */
export function unitsFor(base: BaseUnit): PurchaseUnit[] {
  return (Object.keys(PURCHASE_UNITS) as PurchaseUnit[]).filter(
    (u) => PURCHASE_UNITS[u].base === base,
  );
}

/** Quantity in base units, or null when the unit does not fit the ingredient (litres of eggs). */
export function toBase(qty: number, unit: PurchaseUnit, base: BaseUnit): number | null {
  const u = PURCHASE_UNITS[unit];
  if (!u || u.base !== base || !(qty > 0)) return null;
  // Round to a thousandth of a base unit: 1.25 kg is 1250 g, never 1249.9999.
  return Math.round(qty * u.factor * 1000) / 1000;
}

/** The friendliest unit to show a base quantity in (2,500 g → 2.5 kg). */
export function displayUnit(base: BaseUnit): PurchaseUnit {
  return base === 'g' ? 'kg' : base === 'ml' ? 'l' : 'pcs';
}

// Bazar words in Bangla script and Banglish → an English word an ingredient name is likely to contain.
const SYNONYMS: [RegExp, string][] = [
  [/^(মুরগি|মুরগী|murgi|murgee|broiler|ব্রয়লার)/i, 'chicken'],
  [/^(গরু|গরুর|goru|gorur)/i, 'beef'],
  [/^(খাসি|খাসির|khashi|khasi|khasir)/i, 'mutton'],
  [/^(চাল|chal|চিনিগুড়া|chinigura)/i, 'rice'],
  [/^(পেঁয়াজ|পেয়াজ|piyaj|peyaj|pyaj)/i, 'onion'],
  [/^(আলু|alu|aloo)/i, 'potato'],
  [/^(তেল|tel|সয়াবিন|soybean)/i, 'oil'],
  [/^(ডিম|dim|deem)/i, 'egg'],
  [/^(দুধ|dudh)/i, 'milk'],
  [/^(চিনি|chini)/i, 'sugar'],
  [/^(ঘি|ghee|ghi)/i, 'ghee'],
  [/^(দই|doi|dohi)/i, 'yogurt'],
  [/^(মশলা|মসলা|moshla|mosla|masala)/i, 'spice'],
  [/^(রসুন|roshun|rosun)/i, 'garlic'],
  [/^(আদা|ada)/i, 'ginger'],
  [/^(শসা|shosha|sosa)/i, 'cucumber'],
  [/^(পুদিনা|pudina)/i, 'mint'],
  [/^(লেবু|lebu)/i, 'lemon'],
  [/^(মাখন|makhon)/i, 'butter'],
  [/^(ময়দা|moyda|maida)/i, 'flour'],
  [/^(পাউরুটি|pauruti|bread)/i, 'bread'],
];

export interface IngredientRef {
  id: string;
  name: string;
  name_bn: string | null;
  base: BaseUnit;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Exact name (English or Bangla) first, then a bazar synonym, then a unique partial match. */
export function matchIngredient(name: string, ingredients: IngredientRef[]): IngredientRef | null {
  const n = norm(name);
  if (!n) return null;
  const exact = ingredients.find((i) => norm(i.name) === n || (i.name_bn && norm(i.name_bn) === n));
  if (exact) return exact;
  const word = SYNONYMS.find(([re]) => re.test(n))?.[1];
  const candidates = (needle: string) =>
    ingredients.filter(
      (i) =>
        norm(i.name).includes(needle) || (i.name_bn !== null && norm(i.name_bn).includes(needle)),
    );
  if (word) {
    const hits = candidates(word);
    if (hits.length === 1) return hits[0]!;
  }
  const hits = candidates(n);
  return hits.length === 1 ? hits[0]! : null;
}

/** One line as the model read it. Confidence is the model's own 0–1 for each field. */
export interface ExtractedLine {
  name: string;
  qty: number;
  unit: string;
  total_taka: number;
  confidence: { name: number; qty: number; total: number };
}

export type LineFlag =
  | 'no_match'
  | 'unit_mismatch'
  | 'low_confidence_name'
  | 'low_confidence_qty'
  | 'low_confidence_total'
  | 'no_total';

export interface ReviewLine {
  name: string;
  ingredient_id: string | null;
  qty: number;
  unit: PurchaseUnit | null;
  qty_base: number | null;
  line_total_poisha: number | null;
  flags: LineFlag[];
}

export const LOW_CONFIDENCE = 0.7;

const UNIT_WORDS: [RegExp, PurchaseUnit][] = [
  [/^(kg|kgs|kilo|কেজি|কে\.জি)/i, 'kg'],
  [/^(g|gm|gram|গ্রাম)$/i, 'g'],
  [/^(l|ltr|liter|litre|লিটার)/i, 'l'],
  [/^(ml|মিলি)/i, 'ml'],
  [/^(dozen|doz|ডজন)/i, 'dozen'],
  [/^(pcs|pc|piece|pieces|টি|টা|পিস|can|bottle|packet|পিছ)/i, 'pcs'],
];

export function parseUnit(unit: string): PurchaseUnit | null {
  const u = unit.trim();
  return UNIT_WORDS.find(([re]) => re.test(u))?.[1] ?? null;
}

/** A draft ready for a person: matched, converted, and every doubt flagged. */
export function reviewLines(
  extracted: ExtractedLine[],
  ingredients: IngredientRef[],
): ReviewLine[] {
  return extracted.map((e) => {
    const flags: LineFlag[] = [];
    const ingredient = matchIngredient(e.name, ingredients);
    if (!ingredient) flags.push('no_match');
    let unit = parseUnit(e.unit);
    // "হালি" is four, not twelve — Bangladesh counts eggs in halis.
    const hali = /^হালি/.test(e.unit.trim());
    let qty = e.qty;
    if (hali) {
      unit = 'pcs';
      qty = e.qty * 4;
    }
    const qtyBase = ingredient && unit ? toBase(qty, unit, ingredient.base) : null;
    if (ingredient && (!unit || qtyBase === null)) flags.push('unit_mismatch');
    if (e.confidence.name < LOW_CONFIDENCE) flags.push('low_confidence_name');
    if (e.confidence.qty < LOW_CONFIDENCE) flags.push('low_confidence_qty');
    if (e.confidence.total < LOW_CONFIDENCE) flags.push('low_confidence_total');
    const total = e.total_taka > 0 ? Math.round(e.total_taka * 100) : null;
    if (total === null) flags.push('no_total');
    return {
      name: e.name,
      ingredient_id: ingredient?.id ?? null,
      qty,
      unit,
      qty_base: qtyBase,
      line_total_poisha: total,
      flags,
    };
  });
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** A quantity typed with Bangla or Latin digits ("২.৫", "1,250"); null unless a positive or zero number. */
export function parseQuantity(input: string): number | null {
  const latin = input.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).replace(/[\s,]/g, '');
  if (!/^\d+(\.\d{1,3})?$/.test(latin)) return null;
  return Number(latin);
}

/** How to show a base quantity: kg / l once there is at least one, else g / ml; pieces as they are. */
export function splitQuantity(
  qtyBase: number,
  base: BaseUnit,
): { value: number; unit: PurchaseUnit } {
  if (base === 'pcs') return { value: qtyBase, unit: 'pcs' };
  const big = displayUnit(base);
  if (Math.abs(qtyBase) >= 1000) return { value: qtyBase / 1000, unit: big };
  return { value: qtyBase, unit: base };
}

export interface ReferenceRow {
  ingredient: string;
  price_poisha: number;
  per_base_qty: number;
  observed_on: string;
  source: string;
}

/**
 * Market prices pasted as CSV (TCB lists, a supplier's rate card): "ingredient, taka, per (kg | litre |
 * piece | dozen), date (YYYY-MM-DD), source". A header row and blank lines are skipped; a bad row is
 * returned by number so the person can fix it.
 */
export function parseReferenceCsv(text: string): { rows: ReferenceRow[]; bad: number[] } {
  const rows: ReferenceRow[] = [];
  const bad: number[] = [];
  const PER: Record<string, number> = {
    kg: 1000,
    litre: 1000,
    liter: 1000,
    l: 1000,
    piece: 1,
    pcs: 1,
    dozen: 12,
  };
  text.split(/\r?\n/).forEach((line, i) => {
    const cells = line.split(/[,\t]/).map((c) => c.trim());
    if (cells.every((c) => c === '') || /^ingredient$/i.test(cells[0] ?? '')) return;
    const [ingredient = '', takaText = '', perText = 'kg', date = '', source = ''] = cells;
    const taka = parseQuantity(takaText);
    const per = PER[perText.toLowerCase()];
    if (!ingredient || taka === null || per === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      bad.push(i + 1);
      return;
    }
    // Stored as the price of that many base units (a dozen = 12 pieces), so it stays whole poisha.
    rows.push({
      ingredient,
      price_poisha: Math.round(taka * 100),
      per_base_qty: per,
      observed_on: date,
      source,
    });
  });
  return { rows, bad };
}
