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
  /** Other spellings learnt from purchasers' picks in the chat (ADR 0028). */
  aliases?: string[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const namesOf = (i: IngredientRef) => [i.name, i.name_bn ?? '', ...(i.aliases ?? [])].map(norm);

/**
 * Exact name (English, Bangla or a learnt spelling) first, then a bazar synonym, then a unique
 * partial match.
 */
export function matchIngredient(name: string, ingredients: IngredientRef[]): IngredientRef | null {
  const n = norm(name);
  if (!n) return null;
  const exact = ingredients.find((i) => namesOf(i).includes(n));
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
  /** Typed with the line ("murgi 10 kg 3200 3 din", ADR 0029). */
  for_days?: number;
}

export type LineFlag =
  | 'no_match'
  /** Chat only (ADR 0028): close items exist; the purchaser taps one, or "new item". */
  | 'pick'
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
  /** Chat only (ADR 0025): an item not in the ingredient list yet, created when the person confirms. */
  new_ingredient?: { name: string; base: BaseUnit };
  /** Chat only (ADR 0028): the closest items to offer as buttons while the line is flagged `pick`. */
  candidates?: string[];
  /** Chat only (ADR 0028): the purchaser chose this item; ✅ remembers the spelling for it. */
  picked?: boolean;
  /** Chat only (ADR 0029): how many days this lot is for; a tap on the list's day buttons sets it. */
  for_days?: number | null;
  /** The purchaser wrote the days on this line, so a tap for the whole list leaves it alone. */
  days_typed?: boolean;
}

export const MAX_DAYS = 30;
/** The day buttons under a bazar list in the chat. */
export const DAY_CHOICES = [1, 2, 3, 7] as const;

export const validDays = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_DAYS;

/**
 * Each line's days (ADR 0029): written on the line, else written for the whole list ("3 din er
 * bazar"), else what the item was last bought for at the branch, else none yet (the purchaser taps).
 */
export function withDays(
  lines: ReviewLine[],
  listDays: number | undefined,
  usual: Map<string, number>,
): ReviewLine[] {
  return lines.map((l) => {
    if (l.days_typed && validDays(l.for_days)) return l;
    if (validDays(listDays)) return { ...l, for_days: listDays };
    const known = l.ingredient_id ? usual.get(l.ingredient_id) : undefined;
    return { ...l, for_days: validDays(l.for_days) ? l.for_days : validDays(known) ? known : null };
  });
}

/** A tap on "N days" sets every line: the tap is the purchaser's latest word, over what was typed. */
export function setListDays(lines: ReviewLine[], days: number): ReviewLine[] | null {
  if (!validDays(days)) return null;
  return lines.map((l) => ({ ...l, for_days: days, days_typed: false }));
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
      ...(validDays(e.for_days) ? { for_days: e.for_days, days_typed: true } : {}),
    };
  });
}

// Letter pairs of a name, for a spelling-closeness score that needs no AI ("chiken" ~ "chicken").
function pairs(s: string): string[] {
  const t = s.replace(/\s+/g, '');
  return Array.from({ length: Math.max(t.length - 1, 0) }, (_, i) => t.slice(i, i + 2));
}
function closeness(a: string, b: string): number {
  const pa = pairs(a);
  const pb = pairs(b);
  if (pa.length === 0 || pb.length === 0) return 0;
  const left = [...pb];
  let hits = 0;
  for (const p of pa) {
    const k = left.indexOf(p);
    if (k >= 0) {
      hits++;
      left.splice(k, 1);
    }
  }
  return (2 * hits) / (pa.length + pb.length);
}

export const SUGGESTION_LIMIT = 3;
const MIN_CLOSENESS = 0.5;

/**
 * The items a name most likely means, best first (ADR 0028): a bazar synonym ("murgi" → every
 * chicken item), a name containing it or contained in it, or a close spelling. Only items kept in the
 * unit family it was bought in (kg never suggests eggs). Deterministic: same list, same answer.
 */
export function suggestIngredients(
  name: string,
  ingredients: IngredientRef[],
  base: BaseUnit | null,
  limit = SUGGESTION_LIMIT,
): IngredientRef[] {
  const n = norm(name);
  if (!n) return [];
  const word = SYNONYMS.find(([re]) => re.test(n))?.[1];
  const scored = ingredients
    .filter((i) => base === null || i.base === base)
    .map((i) => {
      const names = namesOf(i).filter(Boolean);
      let score = Math.max(0, ...names.map((x) => closeness(n, x)));
      if (names.some((x) => x.includes(n) || n.includes(x))) score = Math.max(score, 0.8);
      if (word && names.some((x) => x.includes(word))) score = Math.max(score, 0.9);
      return { i, score };
    })
    .filter((x) => x.score >= MIN_CLOSENESS);
  scored.sort((a, b) => b.score - a.score || a.i.name.localeCompare(b.i.name));
  return scored.slice(0, limit).map((x) => x.i);
}

/**
 * A line whose only problem is that the item is not in the ingredient list: when items close to the
 * name exist (and `ingredients` is given), it waits for the purchaser to pick one or "new item"
 * (flag `pick`, ADR 0028); otherwise it becomes a proposed new item (named as written, kept in the
 * unit it was bought in). Every other doubt still blocks it. The ingredient is created only when the
 * person confirms the list (chat_confirm_purchase_draft).
 */
export function proposeNewItems(
  lines: ReviewLine[],
  ingredients: IngredientRef[] = [],
): ReviewLine[] {
  return lines.map((l) => {
    const name = l.name.trim();
    if (l.ingredient_id !== null || name === '' || name.length > 120) return l;
    if (l.flags.length !== 1 || l.flags[0] !== 'no_match') return l;
    if (!l.unit || l.line_total_poisha === null) return l;
    const base = PURCHASE_UNITS[l.unit].base;
    const qtyBase = toBase(l.qty, l.unit, base);
    if (qtyBase === null) return l;
    const close = suggestIngredients(name, ingredients, base);
    if (close.length > 0) return { ...l, flags: ['pick'], candidates: close.map((i) => i.id) };
    return { ...l, qty_base: qtyBase, flags: [], new_ingredient: { name, base } };
  });
}

/**
 * The purchaser's tap on a `pick` line: one of its candidates (by position) or 'new'. Returns null
 * when the line is not waiting for a pick or the choice is not one it offered.
 */
export function applyPick(
  line: ReviewLine,
  choice: number | 'new',
  ingredients: IngredientRef[],
): ReviewLine | null {
  if (!line.flags.includes('pick') || !line.unit) return null;
  const rest = { ...line, candidates: undefined, flags: [] as LineFlag[] };
  if (choice === 'new') {
    const base = PURCHASE_UNITS[line.unit].base;
    const qtyBase = toBase(line.qty, line.unit, base);
    if (qtyBase === null) return null;
    return {
      ...rest,
      ingredient_id: null,
      qty_base: qtyBase,
      new_ingredient: { name: line.name.trim(), base },
    };
  }
  const id = line.candidates?.[choice];
  const ing = id ? ingredients.find((i) => i.id === id) : undefined;
  if (!ing) return null;
  const qtyBase = toBase(line.qty, line.unit, ing.base);
  if (qtyBase === null) return null;
  return {
    ...rest,
    ingredient_id: ing.id,
    qty_base: qtyBase,
    new_ingredient: undefined,
    picked: true,
  };
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
