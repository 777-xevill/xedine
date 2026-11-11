/**
 * The restaurant's Xedine link (xedine.org/<slug>) made from its name, so an owner never has to invent
 * one. Only a-z, 0-9 and dashes are allowed (same rule as the database). A name with no Latin letters at
 * all (written in Bangla) has nothing to make a link from; the caller then uses `fallbackSlug`.
 */
const MAX = 40;

export function slugFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX)
    .replace(/-+$/g, '');
  return slug.length >= 3 ? slug : '';
}

/** "restaurant-4821" from any four digits (the caller supplies them, so this stays pure and testable). */
export function fallbackSlug(digits: number): string {
  return `restaurant-${String(Math.abs(Math.trunc(digits)) % 10000).padStart(4, '0')}`;
}
