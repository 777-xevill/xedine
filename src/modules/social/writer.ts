import 'server-only';
import { z } from 'zod';
import { gateway, type PromptVersion } from '@/lib/llm-gateway';

/**
 * The words on a social autopilot post (ADR 0040): the reel's first-second hook, the poster headline and
 * tagline, and the Facebook/Instagram captions in Bangla and English. Grounded in one public fact about the
 * restaurant; the post goes out without anyone reading it first, so every number is checked below.
 */
export const SOCIAL_POST_PROMPT: PromptVersion = {
  key: 'social_post',
  version: 1,
  body: [
    'You are the social media manager of a restaurant in Bangladesh. Write ONE Facebook/Instagram post',
    'about the dish and the fact you are given. It is published as is, so it must be safe and true.',
    'Rules:',
    '- Use only the fact given. Never invent prices, discounts, offers, ratings, awards, ingredients,',
    '  delivery promises or opening hours. Never write a number unless it is in the fact or the owner note.',
    '- hook_*: max 8 words, stops the scroll in the first second (a question, a bold claim the fact',
    '  supports, a "POV:" line or a craving trigger). No hashtags.',
    '- headline_*: max 4 words, poster headline, punchy (e.g. "Taste The Legend").',
    '- tagline_*: max 10 words, one supporting line.',
    '- caption_bn: Bangla script, 2–4 short sentences, warm, Dhaka food culture, end with a call to come or',
    '  order, then up to 3 hashtags. caption_en: the same in English. Max 2 emojis per caption.',
    '- Match the tone you are given: friendly (warm, homely), premium (calm, elegant), fun (playful, Gen Z).',
  ].join('\n'),
};

const Output = z.object({
  hook_en: z.string(),
  hook_bn: z.string(),
  headline_en: z.string(),
  headline_bn: z.string(),
  tagline_en: z.string(),
  tagline_bn: z.string(),
  caption_bn: z.string(),
  caption_en: z.string(),
});
export type SocialWords = z.infer<typeof Output>;

const DIGITS = /[0-9০-৯]+/g;
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
/** Bangla digits as ASCII, so "১০" in a caption matches "10" in the fact. */
export function asciiDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** Every number in the words must already be in the fact or the owner's note (CLAUDE.md #1). */
export function inventedNumber(words: SocialWords, allowedText: string): string | null {
  const allowed = new Set(asciiDigits(allowedText).match(DIGITS) ?? []);
  for (const text of Object.values(words))
    for (const n of asciiDigits(text).match(DIGITS) ?? []) if (!allowed.has(n)) return n;
  return null;
}

export const DISH_PHOTO_CHECK_PROMPT: PromptVersion = {
  key: 'social_photo_check',
  version: 2,
  body: [
    'You check a restaurant dish photo before it is posted publicly. Answer is_food = true only if the',
    'photo mainly shows prepared food or drink that could plausibly be the named dish. A person, a',
    'screen, a room, a menu card, a document or an unrelated object is false. Ordinary phone photos are',
    'fine: usable = false ONLY if it is so blurry or so dark that you cannot tell what the food is.',
  ].join('\n'),
};
const PhotoCheck = z.object({ is_food: z.boolean(), usable: z.boolean() });

/** Is this photo really a plate of food fit to post? Returns 'ok', 'not_food' or 'blurry'. */
export async function checkDishPhoto(args: {
  orgId: string;
  dish: string;
  jpeg: Uint8Array;
}): Promise<'ok' | 'not_food' | 'blurry'> {
  const result = await gateway().run({
    orgId: args.orgId,
    feature: 'social_photo_check',
    prompt: DISH_PHOTO_CHECK_PROMPT,
    tier: 'fast',
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: Buffer.from(args.jpeg).toString('base64'),
        },
      },
      { type: 'text', text: `Named dish: ${args.dish}` },
    ],
    schema: PhotoCheck,
    maxTokens: 200,
  });
  if (!result.output.is_food) return 'not_food';
  return result.output.usable ? 'ok' : 'blurry';
}

export async function writeSocialPost(args: {
  orgId: string;
  restaurant: string;
  dish: string;
  fact: string;
  ownNote: string | null;
  tone: 'friendly' | 'premium' | 'fun';
  area: string | null;
}): Promise<SocialWords & { model: string; promptVersion: number }> {
  const lines = [
    `Restaurant: ${args.restaurant}${args.area ? ` (${args.area})` : ''}`,
    `Dish: ${args.dish}`,
    `Fact: ${args.fact}`,
    args.ownNote ? `Owner note (must be the main message): ${args.ownNote}` : null,
    `Tone: ${args.tone}`,
  ].filter(Boolean);
  const result = await gateway().run({
    orgId: args.orgId,
    feature: 'social_post',
    prompt: SOCIAL_POST_PROMPT,
    tier: 'fast',
    content: [{ type: 'text', text: lines.join('\n') }],
    schema: Output,
    maxTokens: 1200,
  });
  const allowed = `${args.fact} ${args.ownNote ?? ''} ${args.restaurant} ${args.dish} ${args.area ?? ''}`;
  if (inventedNumber(result.output, allowed)) throw new Error('invented_number');
  return { ...result.output, model: result.model, promptVersion: result.prompt.version };
}
