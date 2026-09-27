import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { csvCell } from '@/lib/export/csv';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';

/**
 * Menu from a photo (ROADMAP Phase 10 onboarding). The model transcribes what is printed — names and
 * prices — into CSV lines the owner edits before importing (CLAUDE.md #4). It must not invent a price:
 * an unreadable price is left empty, and the import rejects that line until the owner fills it in.
 */
export const MENU_PHOTO_PROMPT: PromptVersion = {
  key: 'menu_photo',
  version: 1,
  body: [
    'You transcribe a restaurant menu photo from Bangladesh into a list, exactly as printed.',
    'For each dish: its section heading as category, its English name, its Bangla name if printed, and',
    'its price as printed (digits only, no currency sign). If a price is unreadable or missing, return',
    'an empty string for it — never guess. Do not add dishes that are not on the menu.',
  ].join('\n'),
};

const Output = z.object({
  items: z.array(
    z.object({ category: z.string(), name: z.string(), name_bn: z.string(), price: z.string() }),
  ),
});

export async function readMenuPhoto(args: {
  orgId: string;
  image: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string };
}): Promise<{ csv: string; model: string; promptVersion: number }> {
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: 'image',
      source: { type: 'base64', media_type: args.image.mediaType, data: args.image.base64 },
    },
    { type: 'text', text: 'Transcribe every dish on this menu.' },
  ];
  const result = await gateway().run({
    orgId: args.orgId,
    feature: 'menu_photo',
    prompt: MENU_PHOTO_PROMPT,
    tier: 'fast',
    content,
    schema: Output,
    maxTokens: 4000,
  });
  const lines = result.output.items
    .filter((i) => i.name.trim() !== '')
    .map((i) =>
      [i.category, i.name, i.name_bn, i.price.replace(/[^0-9০-৯.,]/g, '')].map(csvCell).join(','),
    );
  return {
    csv: ['category,name,name_bn,price', ...lines].join('\n'),
    model: result.model,
    promptVersion: result.prompt.version,
  };
}
