import type { ExtractedLine } from './lines';

/**
 * A bazar list typed the usual way — "মুরগি ১০ কেজি ১৮০০, পেঁয়াজ ৫ কেজি ৩০০" or "murgi 10kg 1800" — read
 * without AI (ADR 0025). One item per line or comma: name, quantity, unit, then the total paid for it.
 * Anything else ("180 per kg", a sum, number words from speech) is returned as unread, so the caller
 * can hand the whole text to the AI transcriber or ask the person to write it again. This never
 * multiplies a rate by a quantity: a total must be written (CLAUDE.md #1).
 */
export interface BazarText {
  lines: ExtractedLine[];
  unread: string[];
  /** A line of its own saying how long the whole list is for: "3 din er bazar", "৩ দিনের", "for 3 days". */
  days?: number;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const latinDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

// Split on new lines, semicolons, the Bangla full stop (দাঁড়ি), and commas that are not a thousands
// separator ("1,800" stays one number; "1800, piyaj" splits).
const SEGMENTS = /\r?\n|;|।|,(?!\d{3}(?!\d))/;

const TAKA = String.raw`(?:৳|tk\.?|taka|টাকা|/-)`;
// "3 din", "3 diner", "৩ দিনের জন্য", "3 days", "for 3 days" (ADR 0029).
const DAYS = String.raw`(?:for\s+)?(?<days>\d{1,2})\s*(?:din|days?|দিন)(?:er|ের|এর)?(?:\s*(?:jonno|জন্য))?`;
const LINE = new RegExp(
  String.raw`^(?<name>[^\d৳=:]+?)\s*[:=\-–]?\s*` +
    String.raw`(?<qty>\d+(?:\.\d+)?)\s*(?<unit>[^\d\s৳=:\-–/]+)?\s*[:=\-–@]?\s*` +
    String.raw`${TAKA}?\s*(?<total>\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(?<paisa>\d{1,2}))?\s*${TAKA}?` +
    String.raw`(?:\s*[,\-–]?\s*${DAYS})?\s*$`,
  'iu',
);
const LIST_DAYS = new RegExp(String.raw`^${DAYS}(?:\s*(?:er|এর)?\s*(?:bazar|বাজার))?$`, 'iu');
const MAX_DAYS = 30;

export function parseBazarText(text: string): BazarText {
  const lines: ExtractedLine[] = [];
  const unread: string[] = [];
  let days: number | undefined;
  for (const raw of latinDigits(text).split(SEGMENTS)) {
    const segment = raw.replace(/\s+/g, ' ').trim();
    if (!segment) continue;
    const listDays = Number(LIST_DAYS.exec(segment)?.groups?.days);
    if (listDays >= 1 && listDays <= MAX_DAYS) {
      days = listDays;
      continue;
    }
    const m = LINE.exec(segment);
    const name = m?.groups?.name
      ?.trim()
      .replace(/[-–:=]+$/, '')
      .trim();
    const qty = Number(m?.groups?.qty);
    const total = Number(`${m?.groups?.total?.replace(/,/g, '')}.${m?.groups?.paisa ?? '0'}`);
    const lineDays = m?.groups?.days === undefined ? undefined : Number(m.groups.days);
    if (
      !m ||
      !name ||
      !(qty > 0) ||
      !(total > 0) ||
      (lineDays !== undefined && !(lineDays >= 1 && lineDays <= MAX_DAYS))
    ) {
      unread.push(raw.trim());
      continue;
    }
    lines.push({
      name,
      qty,
      // No unit written ("lebu 20 200") is taken as pieces; the ingredient check flags it if wrong.
      unit: m.groups?.unit?.trim() || 'pcs',
      total_taka: total,
      confidence: { name: 1, qty: 1, total: 1 },
      ...(lineDays !== undefined ? { for_days: lineDays } : {}),
    });
  }
  return days === undefined ? { lines, unread } : { lines, unread, days };
}
