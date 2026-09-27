import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';
import type { ExtractedLine } from './lines';

/**
 * AI purchase drafts (ROADMAP Phase 5): a photo of a bazar chit or receipt, or what the purchaser said,
 * in; the lines as written, out. The model transcribes — it never adds up, converts or prices anything,
 * and every draft waits for a person to confirm it before it touches stock (CLAUDE.md #1, #4).
 */
export const PURCHASE_EXTRACT_PROMPT: PromptVersion = {
  key: 'purchase_extract',
  version: 1,
  body: [
    'You transcribe restaurant bazar (market) purchases in Bangladesh for a person to check.',
    'The input is a photo of a handwritten chit or a printed receipt, or what the purchaser said.',
    'It may be in Bangla, English or Banglish, with Bangla or Latin digits.',
    'For every item bought, return: the item name exactly as written; the quantity as written; the unit',
    'as written (e.g. "কেজি", "kg", "লিটার", "টি", "হালি", "dozen"); and the total paid for that line in',
    'taka. If only a price per unit is written, set total_taka to 0 and say so in notes: never multiply.',
    'Give a confidence from 0 to 1 for the name, the quantity and the total of each line; below 0.7 means a',
    'person must look. Return the supplier or shop name and the date only if they are written; otherwise',
    'empty strings. Do not invent lines, and ignore running totals or change given.',
  ].join('\n'),
};

// No numeric bounds here (they would not map onto structured outputs); lines.ts checks every value.
const ExtractOutput = z.object({
  supplier: z.string(),
  date: z.string(),
  notes: z.string(),
  lines: z.array(
    z.object({
      name: z.string(),
      qty: z.number(),
      unit: z.string(),
      total_taka: z.number(),
      confidence: z.object({ name: z.number(), qty: z.number(), total: z.number() }),
    }),
  ),
});
export type ExtractedPurchase = Omit<z.infer<typeof ExtractOutput>, 'lines'> & {
  lines: ExtractedLine[];
};

export async function extractPurchase(args: {
  orgId: string;
  text?: string;
  image?: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string };
}): Promise<{ extracted: ExtractedPurchase; model: string; promptVersion: number }> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (args.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: args.image.mediaType, data: args.image.base64 },
    });
  }
  content.push({
    type: 'text',
    text: args.text?.trim()
      ? `Purchase:\n${args.text.trim()}`
      : 'The purchase is in the photo above. Transcribe every line you can read.',
  });
  const result = await gateway().run({
    orgId: args.orgId,
    feature: 'purchase_extract',
    prompt: PURCHASE_EXTRACT_PROMPT,
    // Handwriting needs the stronger model; typed or spoken text does not.
    tier: args.image ? 'assistant' : 'fast',
    content,
    schema: ExtractOutput,
    maxTokens: 4000,
  });
  const lines = result.output.lines.filter((l) => l.name.trim() !== '' && l.qty > 0);
  return {
    extracted: { ...result.output, lines },
    model: result.model,
    promptVersion: result.prompt.version,
  };
}
