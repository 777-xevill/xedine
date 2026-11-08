import { parseTakaToPoisha } from '@/lib/money';

/**
 * Member card (ADR 0042): pure helpers shared by the till, the owner's settings page and the customer's
 * card page. The database decides every number (points earned, balance, money off); these only read
 * a scanned QR, build the card link and check what the owner typed.
 */

/** A card link token: 18 random bytes in URL-safe base64. */
export const CARD_TOKEN = /^[A-Za-z0-9_-]{24}$/;

/** The path of a customer's card page. */
export function memberCardPath(token: string): string {
  return `/m/${token}`;
}

/** The full card link on this site (origin = `https://xedine.org` or the till's own origin). */
export function memberCardUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${memberCardPath(token)}`;
}

/**
 * What the till's camera read → the card token, or null when it is not one of our cards. Accepts the
 * full link (any host, so a card made on a preview site still scans) or the bare token.
 */
export function parseMemberToken(scanned: string): string | null {
  const text = scanned.trim();
  if (CARD_TOKEN.test(text)) return text;
  const m = /\/m\/([A-Za-z0-9_-]{24})(?:[/?#]|$)/.exec(text);
  return m ? m[1]! : null;
}

/** A taka amount the owner typed ("100", "৳ ১,০০০", "0.50") → poisha within [min, max]; null otherwise. */
export function parseTakaInRange(input: string, min: number, max: number): number | null {
  const poisha = parseTakaToPoisha(input);
  return poisha !== null && poisha >= min && poisha <= max ? poisha : null;
}

/** A whole number the owner typed (Bangla digits allowed), between min and max; null otherwise. */
export function parseWhole(input: string, min: number, max: number): number | null {
  const hundredths = parseTakaToPoisha(input);
  if (hundredths === null || hundredths % 100 !== 0) return null;
  const n = hundredths / 100;
  return n >= min && n <= max ? n : null;
}
