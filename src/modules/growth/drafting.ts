import 'server-only';
import { z } from 'zod';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';

/**
 * Growth content ideas (ROADMAP Phase 10, PRODUCT.md M17: optional, no auto-posting). Grounded in the two
 * real figures `metric_growth_inputs` returns — a top-selling item and the weakest daypart's share of
 * sales — never any other number (CLAUDE.md #1). A draft for the owner or manager to edit and approve
 * (CLAUDE.md #4); nothing is ever posted from here.
 */
export const GROWTH_IDEA_PROMPT: PromptVersion = {
  key: 'growth_idea',
  version: 1,
  body: [
    'You write short social-media content ideas for a restaurant in Bangladesh (Facebook/Instagram),',
    'grounded only in the one fact you are given below. Do not invent sales figures, prices, ratings or',
    'claims the fact does not support.',
    'Give: a short title, a one-line hook, a 3-step shot list (camera angles, what to show), and a caption',
    'in Bangla (Bangla script) and a caption in English, each 2–3 sentences, warm and specific to Dhaka',
    'food culture. No hashtags beyond two, no emojis beyond one per caption, no discount or price promise.',
  ].join('\n'),
};

const Output = z.object({
  title: z.string(),
  hook: z.string(),
  shot_list: z.string(),
  caption_bn: z.string(),
  caption_en: z.string(),
});
export type GrowthIdea = z.infer<typeof Output>;

export async function draftGrowthIdea(args: {
  orgId: string;
  kind: 'push_item' | 'fix_daypart';
  fact: string;
}): Promise<GrowthIdea & { model: string; promptVersion: number }> {
  const result = await gateway().run({
    orgId: args.orgId,
    feature: 'growth_idea',
    prompt: GROWTH_IDEA_PROMPT,
    tier: 'fast',
    content: [{ type: 'text', text: `Fact: ${args.fact}` }],
    schema: Output,
    maxTokens: 700,
  });
  // The one number this may cite is already in the fact: refuse any other (CLAUDE.md #1). Every field
  // the owner will read is checked — a hallucinated figure in the title is exactly as invented as one in
  // the caption, and the title isn't editable at approval time (approve_growth_draft only takes captions).
  const numbers = (s: string) => new Set(s.match(/[0-9০-৯]+/g) ?? []);
  const allowed = numbers(args.fact);
  for (const text of [
    result.output.title,
    result.output.hook,
    result.output.shot_list,
    result.output.caption_bn,
    result.output.caption_en,
  ])
    for (const x of numbers(text)) if (!allowed.has(x)) throw new Error('invented_number');
  return { ...result.output, model: result.model, promptVersion: result.prompt.version };
}
