import { parseTakaToPoisha } from '@/lib/money';

/**
 * Discount codes (ADR 0038): what the owner types when making one, and how a code's state reads.
 * The database enforces the same rules (discount_codes checks, apply_discount_code); this only turns
 * typed text into values and gives plain errors before the round trip.
 */

/** Capital letters and digits, 4 to 20: nothing a cashier could mistype as a dash or a space. */
export const CODE_PATTERN = /^[A-Z0-9]{4,20}$/;

/** What the cashier's typing and the owner's typing both reduce to: capitals and digits only. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** "10" → 1000 (basis points), "12.5" → 1250. Null unless it is above 0 and at most 100. */
export function parsePercentBps(input: string): number | null {
  // A percent has the same shape as a taka amount (digits and up to two decimals); ×100 is basis points.
  const bps = parseTakaToPoisha(input);
  return bps !== null && bps > 0 && bps <= 10_000 ? bps : null;
}

/** A blank box means "no limit" (null); otherwise a whole number from 1 to 100000, else 'bad'. */
export function parseMaxUses(input: string): number | null | 'bad' {
  if (input.trim() === '') return null;
  const hundredths = parseTakaToPoisha(input);
  if (hundredths === null || hundredths % 100 !== 0) return 'bad';
  const n = hundredths / 100;
  return n >= 1 && n <= 100_000 ? n : 'bad';
}

/** A blank box means "no end date" (null); otherwise a real calendar day as YYYY-MM-DD, else 'bad'. */
export function parseEndDate(input: string): string | null | 'bad' {
  const text = input.trim();
  if (text === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return 'bad';
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  const real =
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
  return real ? text : 'bad';
}

// No 0/O or 1/I: a code read out over the phone or typed from a screenshot must not be ambiguous.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random six-character code; `pick(n)` returns a whole number from 0 to n - 1. */
export function randomCode(pick: (n: number) => number, length = 6): string {
  return Array.from({ length }, () => ALPHABET[pick(ALPHABET.length)]).join('');
}

export type CodeStatus = 'working' | 'off' | 'ended' | 'usedUp';

/** Where a code stands today (`today` is a business day, YYYY-MM-DD). Turned off comes first. */
export function codeStatus(
  code: { is_active: boolean; ends_on: string | null; max_uses: number | null },
  uses: number,
  today: string,
): CodeStatus {
  if (!code.is_active) return 'off';
  if (code.ends_on !== null && today > code.ends_on) return 'ended';
  if (code.max_uses !== null && uses >= code.max_uses) return 'usedUp';
  return 'working';
}
