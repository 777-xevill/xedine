import 'server-only';
import { z } from 'zod';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';
import { validateNumbers } from '@/modules/assistant/validator';
import { factsLine, matchDishes, isSafe, type Allergen, type FactsDish } from './food-facts';

/**
 * The customer's menu helper on the table page (ADR 0049): "something high in protein under ৳400?",
 * "is the biryani spicy?". It answers only from this branch's menu and the facts the restaurant
 * approved, and names up to three dishes, which the page shows with their own approved figures.
 * Any number in its words must appear in those facts (CLAUDE.md #1), or the words are dropped and only
 * the dishes are shown. It gives no medical advice.
 */
export const MENU_HELPER_PROMPT: PromptVersion = {
  key: 'menu_helper',
  version: 1,
  body: [
    "You are a friendly helper on a restaurant's table menu in Bangladesh, talking to a customer.",
    'Answer ONLY from the menu lines given: dish names, price_taka, kcal, protein_g, carbs_g, fat_g and',
    '"contains" (allergens the restaurant marked). "facts=not checked" means you do not know its nutrition:',
    'never guess it. Never invent a dish, a price or a number; copy numbers exactly as given, or use none.',
    'Recommend at most 3 dishes, by their exact English name in "dishes". Keep the answer to 1-3 short',
    'sentences, warm and simple, in the language asked for. Do not give medical or diet advice for an',
    'illness, pregnancy or allergy safety: say the staff or a doctor can help, and you can still point to',
    'dishes by their marked facts. For anything not about the food here, say you can only help with the menu.',
  ].join('\n'),
};

const Output = z.object({ answer: z.string(), dishes: z.array(z.string()) });

/** Menu lines given to the model: enough for a long menu, few enough for a small plan's minute limit. */
const MENU_LIMIT = 150;
export const QUESTION_MAX = 300;

export async function askMenuHelper(args: {
  orgId: string;
  restaurant: string;
  locale: 'bn' | 'en';
  question: string;
  menu: FactsDish[];
  avoid: Allergen[];
}): Promise<{ answer: string | null; dishes: FactsDish[] }> {
  const menu = args.menu.filter((d) => isSafe(d, args.avoid)).slice(0, MENU_LIMIT);
  const lines = menu.map(factsLine);
  const question = args.question.trim().slice(0, QUESTION_MAX);
  const result = await gateway().run({
    orgId: args.orgId,
    feature: 'menu_helper',
    prompt: MENU_HELPER_PROMPT,
    tier: 'fast',
    content: [
      {
        type: 'text',
        text: [
          `Restaurant: ${args.restaurant}`,
          `Answer in: ${args.locale === 'bn' ? 'Bangla' : 'English'}`,
          args.avoid.length ? `The customer avoids: ${args.avoid.join(', ')}` : '',
          'Menu:',
          ...lines,
          '',
          `Customer: ${question}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    schema: Output,
    maxTokens: 600,
  });
  const dishes = matchDishes(result.output.dishes, menu);
  const answer = result.output.answer.trim().slice(0, 600);
  // The words may only quote figures the restaurant approved (or the customer's own).
  const check = validateNumbers(answer, [lines.join('\n')], question);
  return { answer: answer && check.ok ? answer : null, dishes };
}
