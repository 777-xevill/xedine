import { parseTakaToPoisha } from '@/lib/money';

/**
 * Menu import (ROADMAP Phase 10 onboarding). One item per line: `category, name, name_bn, price`.
 * A header line is skipped; quotes work as in CSV; the price accepts Bangla digits, ৳ and commas via the
 * shared money parser. Bad lines are reported by number, never guessed — the owner fixes and retries.
 */
export interface MenuRow {
  category: string;
  name: string;
  name_bn: string | null;
  price_poisha: number;
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseMenuCsv(text: string): { rows: MenuRow[]; badLines: number[] } {
  const rows: MenuRow[] = [];
  const badLines: number[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (raw.trim() === '') return;
    const cells = splitCsvLine(raw);
    if (i === 0 && /^(category|ক্যাটাগরি|বিভাগ)$/i.test(cells[0] ?? '')) return;
    // Two columns = name, price; three = category, name, price; four = category, name, name_bn, price.
    const [category, name, nameBn, price] =
      cells.length === 2
        ? ['', cells[0], '', cells[1]]
        : cells.length === 3
          ? [cells[0], cells[1], '', cells[2]]
          : [cells[0], cells[1], cells[2], cells[3]];
    const poisha = parseTakaToPoisha(price ?? '');
    if (
      !name ||
      name.length > 120 ||
      (category ?? '').length > 80 ||
      poisha === null ||
      poisha < 0
    ) {
      badLines.push(i + 1);
      return;
    }
    rows.push({
      category: category || '',
      name,
      name_bn: nameBn ? nameBn : null,
      price_poisha: poisha,
    });
  });
  return { rows, badLines };
}
