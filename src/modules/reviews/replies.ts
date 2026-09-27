import 'server-only';
import { z } from 'zod';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';

/**
 * AI review replies (ROADMAP Phase 8): a draft for the owner or a manager to edit and approve — never
 * posted by itself (CLAUDE.md #4). The model sees the review text only, never a customer's phone, and is
 * told not to promise refunds or invent facts; the reply may quote no figure that is not in the review.
 */
export const REVIEW_REPLY_PROMPT: PromptVersion = {
  key: 'review_reply',
  version: 1,
  body: [
    'You draft short, warm, professional replies to customer reviews for a restaurant in Bangladesh.',
    'Reply in the language of the review (Bangla script for Bangla or Banglish, English for English).',
    'Thank the reviewer; if they complain, acknowledge the specific problem and say what the restaurant will do',
    'in general terms (e.g. "we are looking at our Friday-night kitchen staffing"). Two to four sentences.',
    'Never promise refunds, discounts or compensation, never invent facts, and do not include any number',
    'that is not in the review. No hashtags, no emojis.',
  ].join('\n'),
};

const ReplyOutput = z.object({ reply: z.string() });

export async function draftReviewReply(args: {
  orgId: string;
  restaurant: string;
  review: string;
  rating: number | null;
}): Promise<{ reply: string; model: string; promptVersion: number }> {
  const result = await gateway().run({
    orgId: args.orgId,
    feature: 'review_reply',
    prompt: REVIEW_REPLY_PROMPT,
    tier: 'fast',
    content: [
      {
        type: 'text',
        text: `Restaurant: ${args.restaurant}\nRating (0–10): ${args.rating ?? 'not given'}\nReview:\n${args.review}`,
      },
    ],
    schema: ReplyOutput,
    maxTokens: 600,
  });
  // A number the review did not contain would be an invention: refuse the draft rather than post it.
  const numbers = (s: string) => new Set(s.match(/[0-9০-৯]+/g) ?? []);
  const allowed = numbers(args.review);
  for (const x of numbers(result.output.reply))
    if (!allowed.has(x)) throw new Error('invented_number');
  return {
    reply: result.output.reply.trim(),
    model: result.model,
    promptVersion: result.prompt.version,
  };
}
