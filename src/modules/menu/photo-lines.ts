import type { DraftRow } from '@/modules/menu/import';

/** "৳ 1,250/-" → "1,250"; keeps Latin and Bangla digits, the decimal point and grouping commas. */
export function cleanPrice(raw: string): string {
  return raw
    .replace(/\/-\s*$/, '')
    .replace(/[^0-9০-৯.,]/g, '')
    .replace(/^[.,]+|[.,]+$/g, '');
}

/** "Biryani | Kacchi (Half) | কাচ্চি | 250 | ?" → its parts; null for a line that is not a dish. */
export function parseMenuLine(
  line: string,
): (Omit<DraftRow, 'check'> & { unsure: boolean }) | null {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length < 2) return null;
  const [category = '', rawName = '', nameBn = '', price = '', flag = ''] =
    cells.length === 2 ? ['', cells[0], '', cells[1], ''] : cells;
  const name = rawName.replace(/\s*[.…·_-]{2,}\s*$/, '').trim();
  if (!name) return null;
  return {
    category: category.replace(/[:：]\s*$/, ''),
    name,
    name_bn: nameBn,
    price: cleanPrice(price),
    unsure: flag.includes('?'),
  };
}

/**
 * Pages read one by one → one list of rows. A nameless group at the top of a later page continues the last
 * category of the page before; the same heading in other capitals ("BIRYANI", "Biryani") is one
 * category; a dish written twice (same category, name and price) is kept once; a dish without a price or
 * that the AI was unsure of is marked for the owner to check.
 */
export function menuLinesToRows(pages: string[][]): DraftRow[] {
  const rows: DraftRow[] = [];
  const seen = new Set<string>();
  const spelling = new Map<string, string>();
  let last = '';
  pages.forEach((lines, p) => {
    let pageStarted = false;
    for (const line of lines) {
      const d = parseMenuLine(line);
      if (!d) continue;
      let category = d.category;
      // No heading on the line: it is under the last one (on this page, or carried over from the last page).
      if (!category && (pageStarted || p > 0)) category = last;
      if (category) {
        pageStarted = true;
        const key = category.toLowerCase();
        category = spelling.get(key) ?? category;
        spelling.set(key, category);
        last = category;
      }
      const dup = `${category.toLowerCase()}|${d.name.toLowerCase()}|${d.price}`;
      if (seen.has(dup)) continue;
      seen.add(dup);
      rows.push({
        category,
        name: d.name,
        name_bn: d.name_bn,
        price: d.price,
        check: d.unsure || d.price === '',
      });
    }
  });
  return rows;
}
