import { formatBDT, formatNumber, type Locale } from '@/lib/i18n/format';
import type { InlineButton } from '@/lib/messaging/telegram';
import { formatQuantity } from '@/modules/inventory/format';
import {
  DAY_CHOICES,
  validDays,
  type IngredientRef,
  type LineFlag,
  type PurchaseUnit,
  type ReviewLine,
} from './lines';

/**
 * The bot's answer to a bazar list (ADR 0025): every line as the draft holds it, so what the person
 * confirms is exactly what gets recorded. Pure; the words come from the caller's translator. Every
 * figure is formatted from the draft's own numbers — the total is a sum of the lines, nothing else.
 */
export type ChatT = (key: string, values?: Record<string, string>) => string;

/** A line that can be recorded as it stands: known ingredient, quantity in base units, a price. */
export function lineComplete(l: ReviewLine): boolean {
  return (
    l.flags.length === 0 &&
    (l.ingredient_id !== null || l.new_ingredient !== undefined) &&
    l.qty_base !== null &&
    l.line_total_poisha !== null
  );
}

// The most useful thing to say about a flagged line; one reason is enough in a chat.
const FLAG_ORDER: LineFlag[] = [
  'pick',
  'no_match',
  'unit_mismatch',
  'no_total',
  'low_confidence_name',
  'low_confidence_qty',
  'low_confidence_total',
];

/** "1 day" / "3 days", in the chat's language and digits. */
export function daysLabel(n: number, locale: Locale, t: ChatT): string {
  return n === 1 ? t('days.one') : t('days.many', { n: formatNumber(n, locale) });
}

export function draftSummary(args: {
  lines: ReviewLine[];
  ingredients: Map<string, IngredientRef>;
  locale: Locale;
  t: ChatT;
  unit: (u: PurchaseUnit) => string;
  branch: string;
  date: string;
}): { text: string; complete: boolean } {
  const { lines, ingredients, locale, t } = args;
  const linesDone = lines.length > 0 && lines.every(lineComplete);
  const daysDone = lines.every((l) => validDays(l.for_days));
  const complete = linesDone && daysDone;
  const n = (i: number) => formatNumber(i + 1, locale);
  const days = (l: ReviewLine) =>
    ` — 📅 ${validDays(l.for_days) ? daysLabel(l.for_days, locale, t) : '?'}`;
  const rows = lines.map((l, i) => {
    if (lineComplete(l) && l.new_ingredient) {
      const qty = formatQuantity(l.qty_base!, l.new_ingredient.base, locale, args.unit);
      return `${n(i)}. 🆕 ${l.new_ingredient.name} — ${qty} — ${formatBDT(l.line_total_poisha!, locale)}${days(l)}`;
    }
    if (l.flags.includes('pick') && l.unit && l.line_total_poisha !== null) {
      // As written, so the purchaser can see which line the buttons below are for.
      const qty = `${formatNumber(l.qty, locale)} ${args.unit(l.unit)}`;
      return `${n(i)}. ❓ ${l.name} — ${qty} — ${formatBDT(l.line_total_poisha, locale)} — ${t('flags.pick')}`;
    }
    const ing = l.ingredient_id ? ingredients.get(l.ingredient_id) : undefined;
    if (!lineComplete(l) || !ing) {
      const flag = FLAG_ORDER.find((f) => l.flags.includes(f)) ?? 'no_match';
      return `${n(i)}. ⚠️ ${l.name} — ${t(`flags.${flag}`)}`;
    }
    // Punctuation only: every word in the line is a name, a unit label or a formatted figure.
    const name = locale === 'bn' && ing.name_bn ? ing.name_bn : ing.name;
    const qty = formatQuantity(l.qty_base!, ing.base, locale, args.unit);
    return `${n(i)}. ${name} — ${qty} — ${formatBDT(l.line_total_poisha!, locale)}${days(l)}`;
  });
  const total = lines.reduce((s, l) => s + (l.line_total_poisha ?? 0), 0);
  const parts = [t('heading', { branch: args.branch, date: args.date }), ...rows];
  const fresh = lines.filter((l) => l.new_ingredient).length;
  if (complete) {
    parts.push('', t('total', { amount: formatBDT(total, locale) }));
    if (fresh > 0) parts.push(t('newItemsNote'));
    parts.push(t('daysNote'), t('askConfirm'));
  } else if (linesDone) {
    parts.push('', t('total', { amount: formatBDT(total, locale) }), t('askDays'));
  } else if (lines.some((l) => l.flags.includes('pick')) && lines.every(waitsForPickOrDone)) {
    parts.push('', t('pickBelow'));
  } else parts.push('', t('needsFix'));
  return { text: parts.join('\n'), complete };
}

const waitsForPickOrDone = (l: ReviewLine) => lineComplete(l) || l.flags.includes('pick');

/** Telegram allows 64 bytes of callback data: "pk:<draft uuid>:<line>:<choice 0–2 | n>". */
export const PICK_CALLBACK = /^pk:([0-9a-f-]{36}):(\d{1,3}):([0-2]|n)$/;

/**
 * The buttons under a list (ADR 0028): for each line waiting for a pick, its candidates in one row and
 * "🆕 new item" in the next, each labelled with the line's number; then ✅ (only when every line is
 * complete) and ❌.
 */
export function draftButtons(args: {
  draftId: string;
  lines: ReviewLine[];
  ingredients: Map<string, IngredientRef>;
  locale: Locale;
  t: ChatT;
  complete: boolean;
}): InlineButton[][] {
  const { draftId, lines, ingredients, locale, t } = args;
  const rows: InlineButton[][] = [];
  lines.forEach((l, i) => {
    if (!l.flags.includes('pick')) return;
    const n = formatNumber(i + 1, locale);
    const options = (l.candidates ?? []).flatMap((id, k) => {
      const ing = ingredients.get(id);
      if (!ing) return [];
      const name = locale === 'bn' && ing.name_bn ? ing.name_bn : ing.name;
      return [{ text: `${n}. ${name}`.slice(0, 60), callback_data: `pk:${draftId}:${i}:${k}` }];
    });
    if (options.length > 0) rows.push(options);
    rows.push([
      {
        text: `${n}. ${t('btnNewItem', { name: l.name })}`.slice(0, 60),
        callback_data: `pk:${draftId}:${i}:n`,
      },
    ]);
  });
  // The day buttons set the whole list (lines with days written on them keep theirs).
  rows.push(
    DAY_CHOICES.map((d) => ({
      text: `📅 ${daysLabel(d, locale, t)}`,
      callback_data: `dy:${draftId}:${d}`,
    })),
  );
  rows.push([
    ...(args.complete ? [{ text: t('btnAdd'), callback_data: `ok:${draftId}` }] : []),
    { text: t('btnCancel'), callback_data: `no:${draftId}` },
  ]);
  return rows;
}

/** "dy:<draft uuid>:<days>" — a tap on one of the list's day buttons. */
export const DAYS_CALLBACK = /^dy:([0-9a-f-]{36}):(\d{1,2})$/;
