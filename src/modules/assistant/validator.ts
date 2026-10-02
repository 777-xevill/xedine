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
