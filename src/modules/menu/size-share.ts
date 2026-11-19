/**
 * How much of a dish's ingredients one plate of a size uses (ADR 0066), in basis points of the dish:
 * half = 5000. Stock and cost follow it whenever the size has no recipe of its own.
 */

/** The shares an owner picks from, smallest first, with the key of their words. */
export const SIZE_SHARES = [
  { bps: 2500, key: 'quarter' },
  { bps: 5000, key: 'half' },
  { bps: 7500, key: 'threeQuarters' },
  { bps: 10000, key: 'same' },
  { bps: 15000, key: 'oneHalf' },
  { bps: 20000, key: 'double' },
  { bps: 30000, key: 'triple' },
] as const;

export type SizeShareKey = (typeof SIZE_SHARES)[number]['key'];

/** The words for a share, or null when it is not one of the list (set some other way). */
export function sizeShareKey(bps: number): SizeShareKey | null {
  return SIZE_SHARES.find((s) => s.bps === bps)?.key ?? null;
}

export function isSizeShare(bps: number): boolean {
  return SIZE_SHARES.some((s) => s.bps === bps);
}

const HALF = /(^|[^a-z])(half|haf|hap)([^a-z]|$)|হাফ|অর্ধেক|আধা/i;
const QUARTER = /(^|[^a-z])(quarter|qtr)([^a-z]|$)|কোয়ার্টার|চতুর্থাংশ|সিকি/i;

/**
 * A first guess from the size's name, so "Half" is right even if nobody picks a share: half → ½,
 * quarter → ¼, anything else → the same as the dish (what it was before sizes had a share).
 */
export function guessSizeShare(name: string): number {
  if (QUARTER.test(name)) return 2500;
  if (HALF.test(name)) return 5000;
  return 10000;
}
