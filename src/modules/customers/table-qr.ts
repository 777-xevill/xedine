/**
 * Table QR (ADR 0045): pure helpers shared by the owner's Table QR page, the customer's table page and the
 * join route. Every table has its own link; the customer scans it with the phone camera, no app.
 */

/** A table link token: 32 lowercase hex characters. */
export const TABLE_TOKEN = /^[0-9a-f]{32}$/;

/** The most tables the owner can make in one go. */
export const MAX_TABLES = 200;

export function tableUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/t/${token}`;
}

/**
 * The cookie that remembers a customer's card on their own phone, per restaurant, so the next scan of any
 * table shows "your card" at once. It holds only the card link the customer already has.
 */
export function cardCookieName(orgId: string): string {
  return `xc_${orgId.replace(/-/g, '')}`;
}

/** A table named only with digits ("4") reads as "Table 4"; any other name is shown as written. */
export function isNumberedTable(name: string): boolean {
  return /^\d{1,4}$/.test(name.trim());
}

/**
 * The Google review link the owner pasted, or null when it is not one. Only Google's own addresses
 * (google.com, g.page, goo.gl short links) so a table page never sends customers somewhere else.
 */
export function parseGoogleReviewUrl(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 500) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const ok =
    host === 'g.page' ||
    host === 'maps.app.goo.gl' ||
    host === 'goo.gl' ||
    host === 'google.com' ||
    host.endsWith('.google.com') ||
    /^(www\.)?google\.com\.bd$/.test(host);
  return ok ? url.toString() : null;
}

/** The table numbers to add so the branch has tables 1…count, skipping numbers it already has. */
export function missingTableNumbers(existing: string[], count: number): string[] {
  const have = new Set(existing.map((n) => n.trim()));
  const out: string[] = [];
  for (let i = 1; i <= Math.min(count, MAX_TABLES); i++)
    if (!have.has(String(i))) out.push(String(i));
  return out;
}
