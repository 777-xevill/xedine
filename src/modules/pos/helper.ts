import 'server-only';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';
import {
  HelperOutput,
  menuForModel,
  resolveHelperLines,
  type HelperMenuItem,
  type HelperResult,
} from './helper-lines';

/**
 * Cashier helper (ADR 0031): what the customer ordered, in words, in; menu ids out. The model matches
 * words to dishes — it does not price, add up, or decide anything about payment. Every line is checked
 * against the menu (helper-lines.ts) and waits for the cashier to confirm before it enters the cart.
 */
export const CASHIER_HELPER_PROMPT: PromptVersion = {
  key: 'cashier_helper',
  version: 1,
  body: [
    'You help a cashier at a restaurant in Bangladesh take an order faster.',
    'The cashier types or dictates what the customer said, in Bangla, English or Banglish, with Bangla or',
    'Latin digits and number words (e.g. "দুইটা", "2 ta", "ek plate").',
    'Match each thing ordered to a dish in the MENU by its id. Copy ids exactly; use only ids from the MENU.',
    'quantity is how many were asked for (1 if not said). variant_id is a size id only if the customer',
    'named a size (half, full, large...); otherwise an empty string. modifier_ids are add-on ids only if the',
    'customer asked for them; otherwise an empty list. note is a special request that is not a menu add-on',
    '(e.g. "no onion", "less spicy"), copied briefly; otherwise an empty string.',
    'If a phrase is not on the menu, or could be two different dishes, do not guess: put the phrase in',
    'unmatched. Never invent a dish, never mention prices, never add dishes that were not asked for.',
  ].join('\n'),
};

export async function readOrder(args: {
  orgId: string;
  text: string;
  menu: HelperMenuItem[];
}): Promise<HelperResult & { model: string; promptVersion: number }> {
  const result = await gateway().run({
    orgId: args.orgId,
    feature: 'cashier_helper',
    prompt: CASHIER_HELPER_PROMPT,
    // Matching words to a list is easy work; the fast tier is enough.
    tier: 'fast',
    content: [
      {
        type: 'text',
        text: `MENU (id | name / Bangla name | sizes | add-ons):\n${menuForModel(args.menu)}\n\nORDER:\n${args.text}`,
      },
    ],
    schema: HelperOutput,
    maxTokens: 1500,
  });
  return {
    ...resolveHelperLines(result.output, args.menu),
    model: result.model,
    promptVersion: result.prompt.version,
  };
}
