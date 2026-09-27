import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';

/**
 * AI recipe drafting (ROADMAP Phase 3): a menu list or photo in, draft recipes out. Drafts only — they
 * become recipes when the owner approves them (CLAUDE.md #4). The model proposes quantities for a person
 * to correct; it never prices anything: costs come from the ingredient prices the owner enters.
 */
export const RECIPE_DRAFT_PROMPT: PromptVersion = {
  key: 'recipe_draft',
  version: 1,
  body: [
    'You draft standard recipes for restaurants in Bangladesh, for the owner and chef to correct.',
    'For each dish on the menu you are given, write one recipe for a single portion as served.',
    'Quantities are in base units: grams (g) for solids, millilitres (ml) for liquids, pieces (pcs) for',
    'countable items such as eggs, bread slices or cans. Use the quantity bought, and a yield % for',
    'what is left after trimming or cooking loss (100 when nothing is lost).',
    'Use plain ingredient names a Dhaka kitchen would use (e.g. "Mutton", "Chinigura rice", "Soybean oil").',
    'Group spices as "Spice mix" unless one spice dominates the cost.',
    'Do not include prices or costs. If a dish is unclear, give your best typical recipe and say what',
    'you assumed in the notes, in one short sentence.',
  ].join('\n'),
};

// Kept free of numeric constraints so it maps onto structured outputs; checked again below.
const DraftOutput = z.object({
  recipes: z.array(
    z.object({
      item_name: z.string(),
      yield_portions: z.number(),
      notes: z.string(),
      lines: z.array(
        z.object({
          ingredient: z.string(),
          base: z.enum(['g', 'ml', 'pcs']),
          qty_base: z.number(),
          yield_pct: z.number(),
        }),
      ),
    }),
  ),
});
export type DraftRecipe = z.infer<typeof DraftOutput>['recipes'][number];

export async function draftRecipes(args: {
  orgId: string;
  menuText?: string;
  image?: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string };
}): Promise<{ recipes: DraftRecipe[]; model: string; promptVersion: number }> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (args.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: args.image.mediaType, data: args.image.base64 },
    });
  }
  content.push({
    type: 'text',
    text: args.menuText?.trim()
      ? `Menu:\n${args.menuText.trim()}`
      : 'The menu is in the photo above. Draft a recipe for every dish you can read.',
  });
  const result = await gateway().run({
    orgId: args.orgId,
    feature: 'recipe_draft',
    prompt: RECIPE_DRAFT_PROMPT,
    tier: 'assistant',
    content,
    schema: DraftOutput,
  });
  // Lines a person could not approve anyway are dropped here; everything else goes to review as drafted.
  const recipes = result.output.recipes
    .map((r) => ({
      ...r,
      yield_portions: r.yield_portions > 0 ? r.yield_portions : 1,
      lines: r.lines.filter(
        (l) =>
          l.ingredient.trim() !== '' && l.qty_base > 0 && l.yield_pct > 0 && l.yield_pct <= 100,
      ),
    }))
    .filter((r) => r.item_name.trim() !== '' && r.lines.length > 0);
  return { recipes, model: result.model, promptVersion: result.prompt.version };
}
