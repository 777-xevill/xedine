import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';
import { draftToCsv, type DraftRow } from '@/modules/menu/import';

/**
 * Menu from photos (ROADMAP Phase 10 onboarding, made stronger 2026-11-19). A vision model reads each page
 * the way a person does — section headings first, then the dishes under each — and returns them grouped.
 * It copies what is printed and never invents a price: an unreadable price stays empty and a doubtful
 * reading is marked, so the review page asks the owner to check it (CLAUDE.md #4). Nothing is created
 * until the owner confirms on that page.
 */
export const MENU_PHOTO_PROMPT: PromptVersion = {
  key: 'menu_photo',
  version: 2,
  body: [
    'You read one photo of a restaurant menu and copy it into structured data, exactly as printed.',
    '',
    'Structure:',
    '- A category is a section heading (e.g. "Biryani", "Set Menu", "Beverages", "Chinese — Soup").',
    '  Put every dish under the heading it is printed under. Menus are often in 2–3 columns: read each',
    '  column top to bottom, and a heading only covers the dishes below it in the same column/box.',
    '- If dishes at the top of the photo have no heading above them (the section continues from an',
    '  earlier page), give that group the category name "".',
    '- Do not make up category names. If the whole menu has no headings, use one category named "".',
    '',
    'Dishes:',
    '- name: the English (or Latin-script) name as printed, without the price, numbering or dots.',
    '- name_bn: the Bangla name if it is printed for that dish, else "". Never translate yourself.',
    '- price: digits only as printed (Bangla digits are fine), no currency sign, no "/-". "" if missing',
    '  or unreadable — never guess.',
    '- sizes: when one dish has several prices (Half/Full, Regular/Large, 1:1/1:2, 6"/9"/12", Single/',
    '  Double), list each as {label, price} with the label exactly as printed (often from a column',
    '  header), and leave price "". Otherwise sizes is [].',
    '- unsure: true if any letter or digit of this dish was hard to read, else false.',
    '- A set menu or combo is one dish; its contents are not separate dishes.',
    '',
    'Skip: the restaurant name, address, phone, opening hours, taglines, "VAT extra" notes, add-on',
    'instructions without a price, and decorations. Do not add dishes that are not printed.',
  ].join('\n'),
};

const Item = z.object({
  name: z.string(),
  name_bn: z.string(),
  price: z.string(),
  sizes: z.array(z.object({ label: z.string(), price: z.string() })),
  unsure: z.boolean(),
});
const Output = z.object({
  categories: z.array(z.object({ name: z.string(), name_bn: z.string(), items: z.array(Item) })),
});
export type MenuPhotoReading = z.infer<typeof Output>;

export type MenuPhoto = { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string };

/** "৳ 1,250/-" → "1,250"; keeps Latin and Bangla digits, the decimal point and grouping commas. */
export function cleanPrice(raw: string): string {
  return raw
    .replace(/\/-\s*$/, '')
    .replace(/[^0-9০-৯.,]/g, '')
    .replace(/^[.,]+|[.,]+$/g, '');
}

/**
 * Pages read one by one → one list of rows. A nameless group at the top of a later page continues the last
 * category of the page before; categories with the same name on different pages become one; a dish
 * printed twice (same category, name and price) is kept once; a dish with sizes becomes one row per size.
 */
export function readingsToRows(pages: MenuPhotoReading[]): DraftRow[] {
  const rows: DraftRow[] = [];
  const seen = new Set<string>();
  let last = '';
  pages.forEach((page, p) => {
    for (const cat of page.categories) {
      const heading = cat.name.trim();
      const category = heading || (p > 0 ? last : '');
      for (const item of cat.items) {
        const name = item.name.trim().replace(/\s*[.…·]{2,}\s*$/, '');
        if (!name) continue;
        const sizes = item.sizes.filter((s) => s.label.trim() || s.price.trim());
        const variants =
          sizes.length > 0
            ? sizes.map((s) => ({
                name: s.label.trim() ? `${name} (${s.label.trim()})` : name,
                price: cleanPrice(s.price),
              }))
            : [{ name, price: cleanPrice(item.price) }];
        for (const v of variants) {
          const key = `${category.toLowerCase()}|${v.name.toLowerCase()}|${v.price}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({
            category,
            name: v.name,
            name_bn: item.name_bn.trim(),
            price: v.price,
            check: item.unsure || v.price === '',
          });
        }
      }
      if (category) last = category;
    }
  });
  return rows;
}

export async function readMenuPhotos(args: {
  orgId: string;
  photos: MenuPhoto[];
}): Promise<{ csv: string; rows: number; unread: number; model: string; promptVersion: number }> {
  const pages: MenuPhotoReading[] = [];
  let model = '';
  let promptVersion = MENU_PHOTO_PROMPT.version;
  let firstError: unknown = null;
  // One call per page, in order: a vision model reads one page far better than six at once, and the
  // order lets a section that runs over a page break keep its heading.
  for (const [i, photo] of args.photos.entries()) {
    const content: Anthropic.ContentBlockParam[] = [
      {
        type: 'image',
        source: { type: 'base64', media_type: photo.mediaType, data: photo.base64 },
      },
      {
        type: 'text',
        text:
          args.photos.length > 1
            ? `Page ${i + 1} of ${args.photos.length} of the same menu. Copy every dish on it.`
            : 'Copy every dish on this menu.',
      },
    ];
    try {
      const result = await gateway().run({
        orgId: args.orgId,
        feature: 'menu_photo',
        prompt: MENU_PHOTO_PROMPT,
        tier: 'fast',
        content,
        schema: Output,
        maxTokens: 8000,
      });
      pages.push(result.output);
      model = result.model;
      promptVersion = result.prompt.version;
    } catch (e) {
      firstError ??= e;
    }
  }
  if (pages.length === 0) throw firstError ?? new Error('no pages read');
  const rows = readingsToRows(pages);
  return {
    csv: draftToCsv(rows),
    rows: rows.length,
    unread: args.photos.length - pages.length,
    model,
    promptVersion,
  };
}
