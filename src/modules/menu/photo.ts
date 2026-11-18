import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';
import { menuLinesToRows } from '@/modules/menu/photo-lines';

export { menuLinesToRows };

/**
 * Menu from photos (ROADMAP Phase 10 onboarding, made stronger 2026-11-19). A vision model reads one page
 * the way a person does — section headings first, then the dishes under each — and writes one short line
 * per dish (short because Groq's free tier lets the model write only ~1,000 tokens a minute). It copies
 * what is printed and never invents a price: an unreadable price stays empty and a doubtful reading is
 * marked "?", so the review page asks the owner to check it (CLAUDE.md #4). Nothing is created until the
 * owner confirms on that page.
 */
export const MENU_PHOTO_PROMPT: PromptVersion = {
  key: 'menu_photo',
  version: 3,
  body: [
    'You read one photo of a restaurant menu and copy every dish into lines, exactly as printed.',
    '',
    'Each line: Category | Name | Bangla name | Price | ?',
    '- Category: the section heading the dish is printed under (e.g. "Biryani", "Set Menu",',
    '  "Beverages"). Menus often have 2–3 columns or boxes: read each column top to bottom; a heading',
    '  covers only the dishes below it in its own column or box. Dishes at the top of the photo with no',
    '  heading above them (continued from an earlier page): leave Category empty. Never invent one.',
    '- Name: the English (Latin-script) name as printed, without price, numbering or dots. If a dish',
    '  is printed only in Bangla, put the Bangla in Name too.',
    '- Bangla name: only if Bangla is printed for that dish, else empty. Never translate.',
    '- Price: as printed, digits only — no currency sign, no "/-". Copy Bangla digits as Bangla digits',
    '  (০১২৩৪৫৬৭৮৯); look closely, ৮ is 8 and ৬ is 6. Empty if missing or unreadable — never guess.',
    '- One dish with several prices (Half/Full, Regular/Large, 1:1/1:2, sizes): one line per price, with',
    '  the size label from the menu in brackets, e.g. "Biryani | Kacchi (Half) | কাচ্চি | 250 |".',
    '- Last field: "?" if any letter or digit of that dish was hard to read, else empty.',
    '- A set menu or combo is one dish; its contents are not dishes.',
    'Skip the restaurant name, address, phone, hours, taglines, VAT notes, add-on notes without a price,',
    'and decorations. Do not add dishes that are not printed. Return JSON: {"lines": ["…", "…"]}.',
  ].join('\n'),
};

const Output = z.object({ lines: z.array(z.string()) });

export type MenuPhoto = { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string };

/** One page of the menu → its lines, as the model wrote them (merged into rows by `menuLinesToRows`). */
export async function readMenuPage(args: {
  orgId: string;
  photo: MenuPhoto;
  page: number;
  pages: number;
}): Promise<{ lines: string[]; model: string; promptVersion: number }> {
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: 'image',
      source: { type: 'base64', media_type: args.photo.mediaType, data: args.photo.base64 },
    },
    {
      type: 'text',
      text:
        args.pages > 1
          ? `Page ${args.page} of ${args.pages} of the same menu. Copy every dish on it.`
          : 'Copy every dish on this menu.',
    },
  ];
  const result = await gateway().run({
    orgId: args.orgId,
    feature: 'menu_photo',
    prompt: MENU_PHOTO_PROMPT,
    tier: 'fast',
    content,
    schema: Output,
    maxTokens: 1000,
  });
  return {
    lines: result.output.lines.slice(0, 300).map((l) => l.slice(0, 400)),
    model: result.model,
    promptVersion: result.prompt.version,
  };
}
