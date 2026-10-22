import 'server-only';
import { z } from 'zod';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';
import type { BaseUnit } from '@/modules/purchasing/lines';

/**
 * "Ask AI" on one dish (ADR 0037): the model suggests what goes into one plate, for the owner or the
 * manager to check with the chef. A suggestion only — it becomes the dish's ingredients when a person
 * saves the list (CLAUDE.md #4). The model never prices anything: costs come from the bazar and the
 * prices the owner enters.
 */
export const DISH_SUGGEST_PROMPT: PromptVersion = {
  key: 'dish_ingredients',
  version: 1,
  body: [
    'You help a restaurant in Bangladesh write what goes into ONE plate of a dish, so its stock goes down',
    'by itself each time the dish is sold. The owner or manager will check every amount with the chef.',
    'List each ingredient and how much of it leaves the store for one plate, raw, as bought: grams (g) for',
    'solids, millilitres (ml) for liquids, pieces (pcs) for things counted one by one (bun, egg, cheese',
    'slice, bread slice, can, bottle, packet).',
    "Use a name from the kitchen's own list when one fits, spelt exactly as listed; otherwise a plain name",
    'a Dhaka kitchen would use ("Chicken", "Burger bun", "Soybean oil", "Chinigura rice").',
    'At most 15 lines. Group small spices as "Spice mix" unless one spice matters. Leave out water and gas.',
    'No prices. In note, one short sentence on what you assumed (for example the plate size).',
  ].join('\n'),
};

// Kept free of numeric constraints so it maps onto structured outputs; checked again below.
const SuggestOutput = z.object({
  note: z.string(),
  lines: z.array(
    z.object({
      ingredient: z.string(),
      unit: z.enum(['g', 'ml', 'pcs']),
      qty: z.number(),
    }),
  ),
});

export interface SuggestedLine {
  ingredient: string;
  base: BaseUnit;
  qty_base: number;
}

/** The kitchen's names the model may reuse: enough to match, few enough for a small plan's limit. */
const KNOWN_LIMIT = 150;
const MAX_LINES = 15;

export async function suggestDish(args: {
  orgId: string;
  dish: string;
  dishBn: string | null;
  known: { name: string; base: BaseUnit }[];
}): Promise<{ lines: SuggestedLine[]; note: string; model: string; promptVersion: number }> {
  const known = args.known
    .slice(0, KNOWN_LIMIT)
    .map((k) => `${k.name} (${k.base})`)
    .join(', ');
  const result = await gateway().run({
    orgId: args.orgId,
    feature: 'dish_ingredients',
    prompt: DISH_SUGGEST_PROMPT,
    tier: 'assistant',
    content: [
      {
        type: 'text',
        text: [
          `Dish: ${args.dish}${args.dishBn && args.dishBn !== args.dish ? ` (${args.dishBn})` : ''}`,
          `The kitchen's ingredient list: ${known || 'none yet'}`,
        ].join('\n'),
      },
    ],
    schema: SuggestOutput,
  });
  // Lines a person could not save anyway are dropped here, and a name the model repeated is kept once.
  const seen = new Set<string>();
  const lines = result.output.lines
    .map((l) => ({
      ingredient: l.ingredient.trim().replace(/\s+/g, ' ').slice(0, 120),
      base: l.unit,
      qty_base: Math.round(l.qty * 1000) / 1000,
    }))
    .filter((l) => {
      const key = l.ingredient.toLowerCase();
      if (!l.ingredient || !(l.qty_base > 0) || l.qty_base > 100_000 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_LINES);
  return {
    lines,
    note: result.output.note.trim().slice(0, 300),
    model: result.model,
    promptVersion: result.prompt.version,
  };
}
