/**
 * The numeric-consistency validator (CLAUDE.md #1): every number in a model's answer must appear in
 * the tool results it was given (or in the question itself). Anything else is rejected — the model
 * may have calculated, estimated or invented it.
 *
 * Tool results carry money as integer poisha; people read taka, so each *_poisha value also allows its
 * taka form (exact and rounded). Percentages in basis points (*_bps) also allow their percent form.
 * The assistant's model sees money already in taka (*_taka, for-model.ts): those allow their whole-taka
 * form. A quantity (*_qty) in g or ml also allows kg or litres (÷ 1,000, to one or more decimals).
 */
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

const toLatin = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

/** Numbers as written: Latin or Bangla digits, lakh or thousand commas, optional decimals. */
export function extractNumbers(text: string): number[] {
  const latin = toLatin(text);
  const out: number[] = [];
  for (const m of latin.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(Math.abs(n));
  }
  return out;
}

function collect(value: unknown, key: string, into: Set<string>): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    add(into, value);
    if (key.endsWith('_poisha')) {
      add(into, value / 100);
      add(into, Math.round(value / 100));
    }
    if (key.endsWith('_bps')) {
      add(into, value / 100);
      add(into, Math.round(value / 100));
    }
    if (key.endsWith('_taka') || key.endsWith('_pct')) add(into, Math.round(value));
    if (key.endsWith('_qty')) {
      add(into, value / 1000);
      add(into, Math.round(value / 100) / 10);
    }
    return;
  }
  if (typeof value === 'string') {
    // Dates and labels in tool results ("2026-09-21", "Order 12") may be quoted back; a ready-written
    // quantity ("57.65 kg") also to a whole number or one decimal.
    for (const n of extractNumbers(value)) {
      add(into, n);
      add(into, Math.round(n));
      add(into, Math.round(n * 10) / 10);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collect(v, key, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, k, into);
  }
}

const norm = (n: number) => String(Math.round(Math.abs(n) * 100) / 100);
function add(into: Set<string>, n: number): void {
  into.add(norm(n));
}

export interface ValidationResult {
  ok: boolean;
  /** Numbers in the answer with no source. */
  unsupported: number[];
}

/** List numbering ("1. ", "২) ", "(৩)") is not a figure: it is removed before the check. */
export function withoutListNumbers(text: string): string {
  return text.replace(/\(\s*[0-9০-৯]{1,2}\s*\)/g, ' ').replace(/^(\s*)[0-9০-৯]{1,2}[.)]\s/gm, '$1');
}

/**
 * Money signs and words, any currency the restaurants use (ADR 0062), in English, Banglish and Bangla. A
 * figure next to one is money.
 */
const MONEY_BEFORE =
  /(?:৳|\$|€|£|₹|টাকা|(?:^|[^a-z])(?:tk\.?|taka|bdt|usd|eur|gbp|inr|rs\.?|pkr|aed|sar|qar|rm|myr|sgd))\s*$/i;
const MONEY_AFTER = /^\s*(৳|tk\b|taka|টাকা|bdt|usd|eur|gbp|inr|pkr|aed|sar|qar|myr|sgd|\/-)/i;
const PERCENT_AFTER = /^\s*(%|٪|percent|per cent|শতাংশ|পার্সেন্ট)/i;
// The other end of a range: "৳300–400", "300 to 400 taka", "30-35%".
const RANGE = String.raw`\s*\d[\d,.]*\s*(?:-|–|—|to|or|থেকে|বা)\s*`;
const MONEY_RANGE_BEFORE = new RegExp(
  String.raw`(?:৳|\$|€|£|₹|টাকা|(?:^|[^a-z])(?:tk\.?|taka|bdt|usd|rs\.?|aed|sar|qar|rm|sgd))` +
    RANGE +
    '$',
  'i',
);
const RANGE_AFTER = String.raw`^\s*(?:-|–|—|to|or|থেকে|বা)\s*\d[\d,.]*`;
const MONEY_RANGE_AFTER = new RegExp(
  RANGE_AFTER + String.raw`\s*(৳|tk\b|taka|টাকা|bdt|usd|eur|gbp|inr|pkr|aed|sar|qar|myr|sgd|\/-)`,
  'i',
);
const PERCENT_RANGE_AFTER = new RegExp(
  RANGE_AFTER + String.raw`\s*(%|٪|percent|per cent|শতাংশ|পার্সেন্ট)`,
  'i',
);

/**
 * Which unsupported numbers are money or a percentage (ADR 0067). The assistant may answer from general
 * knowledge (a cooking temperature, cups of yoghurt, a year), and such figures need no tool; but a money
 * amount or a percentage must always have a source, so an invented price, cost or margin is still refused.
 */
export function strictUnsupported(answer: string, unsupported: number[]): number[] {
  if (unsupported.length === 0) return [];
  const wanted = new Set(unsupported.map(norm));
  const text = toLatin(withoutListNumbers(answer));
  const strict = new Set<number>();
  for (const m of text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const n = Math.abs(Number(m[0].replace(/,/g, '')));
    if (!Number.isFinite(n) || !wanted.has(norm(n))) continue;
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    if (
      MONEY_BEFORE.test(before) ||
      MONEY_RANGE_BEFORE.test(before) ||
      MONEY_AFTER.test(after) ||
      MONEY_RANGE_AFTER.test(after) ||
      PERCENT_AFTER.test(after) ||
      PERCENT_RANGE_AFTER.test(after)
    )
      strict.add(n);
  }
  return [...strict];
}

/** Tools that read no restaurant figures: the web, the app guide, and the changes it prepares. */
const NO_RECORDS = /^(web_search|read_web_page|find_page|propose_[a-z_]+)$/;

export type Verdict =
  | { ok: true; general: boolean }
  | {
      ok: false;
      /** The figures to name when the model is asked to answer again. */
      unsupported: number[];
    };

/**
 * Where general knowledge starts in an answer that also gives the restaurant's figures: a line beginning
 * "General knowledge:" (in Bangla "সাধারণ জ্ঞান:"), as the prompt asks.
 */
export const GENERAL_MARK = /^[ \t*-]*(?:general knowledge|সাধারণ জ্ঞান)\s*[:：]/im;

/**
 * The numbers check for one answer (CLAUDE.md #1, ADR 0067). What an answer says about the restaurant, when it
 * read the records or was asked about them (`dataQuestion`: the router knows the question), is checked as
 * always: every figure must come from a tool, the card or the question. General knowledge (a recipe, a
 * food-safety rule, the web) may keep its own figures and is shown as such, but never an unsourced money
 * amount or percentage. In an answer with both, the general part comes last, after the GENERAL_MARK line.
 */
export function judgeNumbers(
  answer: string,
  sources: unknown[],
  question: string,
  toolNames: string[],
  dataQuestion: boolean,
): Verdict {
  if (validateNumbers(answer, sources, question).ok) return { ok: true, general: false };
  const recordsRead = dataQuestion || toolNames.some((n) => !NO_RECORDS.test(n));
  const mark = GENERAL_MARK.exec(answer);
  const parts = mark
    ? [
        { text: answer.slice(0, mark.index), strict: recordsRead },
        { text: answer.slice(mark.index), strict: false },
      ]
    : [{ text: answer, strict: recordsRead }];
  const bad = new Set<number>();
  for (const part of parts) {
    const check = validateNumbers(part.text, sources, question);
    if (check.ok) continue;
    for (const x of part.strict
      ? check.unsupported
      : strictUnsupported(part.text, check.unsupported))
      bad.add(x);
  }
  return bad.size === 0 ? { ok: true, general: true } : { ok: false, unsupported: [...bad] };
}

export function validateNumbers(
  answer: string,
  sources: unknown[],
  question = '',
): ValidationResult {
  const allowed = new Set<string>();
  for (const s of sources) collect(s, '', allowed);
  for (const n of extractNumbers(question)) add(allowed, n);
  const unsupported = extractNumbers(withoutListNumbers(answer)).filter(
    (n) => !allowed.has(norm(n)),
  );
  return { ok: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}
