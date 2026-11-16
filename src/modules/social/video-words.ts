import { z } from 'zod';
import type { VideoWords } from './video';

/**
 * Words and special days for the short videos (ADR 0061). Pure (no server imports): the Growth preview
 * uses the same lists in the browser.
 */

/**
 * Special days a video can greet. The greeting itself is fixed text from the app's translations
 * (social.video.occasions.<key>), never AI-written; the theme picks the decorations.
 */
export const OCCASIONS = [
  'eid_fitr',
  'eid_adha',
  'ramadan',
  'iftar',
  'jummah',
  'boishakh',
  'victory_day',
  'independence_day',
  'new_year',
  'christmas',
  'puja',
  'valentine',
  'mothers_day',
  'weekend',
  'custom',
] as const;
export type Occasion = (typeof OCCASIONS)[number];

export type OccasionTheme = 'islamic' | 'boishakh' | 'national' | 'festive' | 'love' | 'plain';
export const OCCASION_THEME: Record<Occasion, OccasionTheme> = {
  eid_fitr: 'islamic',
  eid_adha: 'islamic',
  ramadan: 'islamic',
  iftar: 'islamic',
  jummah: 'islamic',
  boishakh: 'boishakh',
  victory_day: 'national',
  independence_day: 'national',
  new_year: 'festive',
  christmas: 'festive',
  puja: 'festive',
  valentine: 'love',
  mothers_day: 'love',
  weekend: 'festive',
  custom: 'plain',
};

/**
 * The autopilot's greeting for a day on the restaurant's calendar (BD_CALENDAR keys, e.g. 'eidulfitr-2027').
 * Days of mourning or remembrance (Ekushey, Ashura, Shab-e-Barat, Buddha Purnima, Miladunnabi, May Day)
 * get no food greeting.
 */
export function occasionOfCalendarKey(key: string): Occasion | null {
  const prefix = key.replace(/-\d{4}$/, '');
  const map: Record<string, Occasion> = {
    eidulfitr: 'eid_fitr',
    eiduladha: 'eid_adha',
    ramadan: 'iftar',
    boishakh: 'boishakh',
    victory: 'victory_day',
    independence: 'independence_day',
    newyear: 'new_year',
    christmas: 'christmas',
  };
  return map[prefix] ?? null;
}

/** What the AI returns for a video: every line any video kind may use, in both languages, and captions. */
export const VideoWordsSchema = z.object({
  hook_en: z.string(),
  hook_bn: z.string(),
  punch_en: z.string(),
  punch_bn: z.string(),
  question_en: z.string(),
  question_bn: z.string(),
  tagline_en: z.string(),
  tagline_bn: z.string(),
  caption_en: z.string(),
  caption_bn: z.string(),
});
export type AiVideoWords = z.infer<typeof VideoWordsSchema>;

/** Words the owner approved in the preview (any subset, each line limited). */
export const ApprovedVideoWordsSchema = z
  .object({
    hook: z.string().trim().max(120),
    punch: z.string().trim().max(60),
    question: z.string().trim().max(80),
    tagline: z.string().trim().max(120),
    caption_bn: z.string().trim().max(1500),
    caption_en: z.string().trim().max(1500),
    lang: z.enum(['bn', 'en']),
  })
  .partial()
  .strict();
export type ApprovedVideoWords = z.infer<typeof ApprovedVideoWordsSchema>;

/** The video's on-screen lines in one language: the AI's, the owner's, else the app's defaults. */
export function videoWordsFor(
  lang: 'bn' | 'en',
  ai: Partial<AiVideoWords> | null,
  own: ApprovedVideoWords | null,
  defaults: Omit<VideoWords, 'cta'>,
  cta: string,
): VideoWords {
  const pick = (k: 'hook' | 'punch' | 'question' | 'tagline') =>
    own?.[k]?.trim() || ai?.[`${k}_${lang}`]?.trim() || defaults[k];
  return {
    hook: pick('hook'),
    punch: pick('punch'),
    question: pick('question'),
    tagline: pick('tagline'),
    cta,
  };
}
