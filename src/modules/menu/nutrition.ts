import 'server-only';
import { z } from 'zod';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';
import { ALLERGENS, type Allergen } from './food-facts';

/**
 * "Fill with AI" on the Food facts page (ADR 0049). The founder chose a guess over a sum of ingredients:
 * the model estimates one plate's calories, protein, carbs and fat and marks its allergens. It is a draft
 * (status ai_guess): customers see nothing until the owner or a manager checks it and taps Approve
 * (CLAUDE.md #4). When the dish has ingredients written (ADR 0037), the model is given them.
 */
export const NUTRITION_PROMPT: PromptVersion = {
  key: 'dish_nutrition',
  version: 1,
  body: [
    'You estimate the nutrition of ONE plate of each dish as a restaurant in Bangladesh usually serves it.',
    'The owner will check every value before customers see it.',
    'For each dish return: kcal (whole number), protein_g, carbs_g and fat_g (grams, one decimal at most),',
    'and allergens: only from this list, only those the dish normally contains:',
    `${ALLERGENS.join(', ')}. "gluten" means wheat flour (naan, paratha, bun, pasta, batter); "milk" includes`,
    'ghee, butter, cream, cheese, yogurt, dahi; "beef" for beef dishes. When an ingredient list is given,',
    'use those amounts; otherwise assume a normal Dhaka restaurant portion. Return every dish by its number.',
    'Drinks with sugar count their sugar as carbs. Never leave a value out; give your best estimate.',
  ].join('\n'),
};

const Output = z.object({
  dishes: z.array(
    z.object({
      n: z.number(),
      kcal: z.number(),
      protein_g: z.number(),
      carbs_g: z.number(),
      fat_g: z.number(),
      allergens: z.array(z.enum(ALLERGENS)),
    }),
  ),
});

export interface GuessInput {
  id: string;
  name: string;
  name_bn: string | null;
  category: string | null;
  /** "Chicken 150 g, Basmati rice 200 g" — the dish's written ingredients, if any. */
  ingredients: string | null;
}

export interface Guess {
  menu_item_id: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  allergens: Allergen[];
}

/** Dishes per AI call: small enough for Groq's per-minute token limit, big enough to be quick. */
export const GUESS_BATCH = 12;

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/** Guesses for one batch of dishes; values outside what the database accepts are dropped, not stored. */
export async function guessNutrition(
  orgId: string,
  dishes: GuessInput[],
): Promise<{ guesses: Guess[]; model: string; promptVersion: number }> {
  const list = dishes
    .slice(0, GUESS_BATCH)
    .map((d, i) => {
      const name = d.name_bn && d.name_bn !== d.name ? `${d.name} (${d.name_bn})` : d.name;
      const cat = d.category ? ` [${d.category}]` : '';
      const ing = d.ingredients ? ` — ingredients for one plate: ${d.ingredients}` : '';
      return `${i + 1}. ${name}${cat}${ing}`;
    })
    .join('\n');
  const result = await gateway().run({
    orgId,
    feature: 'dish_nutrition',
    prompt: NUTRITION_PROMPT,
    tier: 'assistant',
    content: [{ type: 'text', text: `Dishes:\n${list}` }],
    schema: Output,
    maxTokens: 2500,
  });
  const guesses: Guess[] = [];
  const seen = new Set<number>();
  for (const g of result.output.dishes) {
    const d = dishes[Math.round(g.n) - 1];
    if (!d || seen.has(g.n)) continue;
    const ok =
      g.kcal >= 0 &&
      g.kcal <= 5000 &&
      g.protein_g >= 0 &&
      g.protein_g <= 500 &&
      g.carbs_g >= 0 &&
      g.carbs_g <= 1000 &&
      g.fat_g >= 0 &&
      g.fat_g <= 500;
    if (!ok) continue;
    seen.add(g.n);
    guesses.push({
      menu_item_id: d.id,
      kcal: Math.round(g.kcal),
      protein_g: oneDecimal(g.protein_g),
      carbs_g: oneDecimal(g.carbs_g),
      fat_g: oneDecimal(g.fat_g),
      allergens: [...new Set(g.allergens)],
    });
  }
  return { guesses, model: result.model, promptVersion: result.prompt.version };
}
