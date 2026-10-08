import { toBanglaDigits } from '@/lib/i18n/format';
import { formatQuantity } from '@/modules/inventory/format';
import type { BaseUnit, PurchaseUnit } from '@/modules/purchasing/lines';

/**
 * What the model sees of a tool result. Money is stored and computed in poisha and percentages in
 * basis points (CLAUDE.md #3), but a model asked to divide by 100 gets it wrong (it wrote ৳865.75 for
 * 865,750 poisha), so every `*_poisha` becomes `*_taka` and every `*_bps` becomes `*_pct` before it
 * reaches the model. The numeric validator checks the answer against this same converted result.
 * Pure arithmetic on one value at a time, never a total.
 */
export function forModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(forModel);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    // null money stays null (the person may not see it), under the taka name.
    if (k.endsWith('_poisha') && (typeof v === 'number' || v === null)) {
      out[`${k.slice(0, -'_poisha'.length)}_taka`] = v === null ? null : Math.round(v) / 100;
    } else if (k.endsWith('_bps') && (typeof v === 'number' || v === null)) {
      out[`${k.slice(0, -'_bps'.length)}_pct`] = v === null ? null : Math.round(v) / 100;
    } else {
      out[k] = forModel(v);
    }
  }
  return out;
}

const UNIT: Record<PurchaseUnit, string> = {
  kg: 'kg',
  g: 'g',
  l: 'litre',
  ml: 'ml',
  pcs: 'pcs',
  dozen: 'dozen',
};

/** A base quantity as a person reads it ("9.55 kg", "300 g", "12 pcs"), ready to quote. */
export function qtyText(qty: number, base: BaseUnit): string {
  return formatQuantity(qty, base, 'en', (u) => UNIT[u], { maxDecimals: 2 });
}

/** A chat bubble shows plain text: Markdown bold and heading marks are taken out. */
export function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

/**
 * The model's answer as the owner reads it, after the numeric check: plain text, taka never written as
 * rupees (the model sometimes writes ₹), and a Bangla answer in Bangla digits like the rest of the
 * app. Only the script changes, never a value; the validator reads both digit sets.
 */
export function forReader(text: string, locale: 'bn' | 'en'): string {
  const out = plain(text).replace(/₹/g, '৳');
  return locale === 'bn' ? toBanglaDigits(out) : out;
}
