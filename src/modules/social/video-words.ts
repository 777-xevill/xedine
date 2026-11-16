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
  'national_day',
  'diwali',
  'holi',
  'lunar_new_year',
  'easter',
  'thanksgiving',
  'halloween',
  'fathers_day',
  'nowruz',
  'dia_de_muertos',
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
  national_day: 'national',
  diwali: 'festive',
  holi: 'festive',
  lunar_new_year: 'festive',
  easter: 'festive',
  thanksgiving: 'festive',
  halloween: 'festive',
  fathers_day: 'love',
  nowruz: 'festive',
  dia_de_muertos: 'festive',
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

/**
 * The kind of opening line a video gets, so a restaurant's videos do not all open the same way (the
 * founder saw "Still thinking about lunch?" on every sample). One is drawn per video; the AI writes in it
 * and the app's fixed lines have one per style.
 */
export const HOOK_STYLES = [
  'craving',
  'moment',
  'claim',
  'invite',
  'tease',
  'senses',
  'mood',
  'dare',
  'pov',
] as const;
export type HookStyle = (typeof HOOK_STYLES)[number];

/** What each style asks of the AI (English instructions; the AI writes both languages). */
export const HOOK_STYLE_GUIDE: Record<HookStyle, string> = {
  craving:
    'a craving question about how the dish tastes or feels (like "Craving something smoky?" / "ঝাল ঝাল কিছু খেতে মন চাইছে?")',
  moment: 'the meal moment given below (like "Evening snack, sorted" / "বিকেলের নাস্তা রেডি!")',
  claim:
    'a bold line the facts support (like "The plate everyone orders" / "সবাই এটাই অর্ডার করে")',
  invite:
    'a direct, warm invitation (like "Bring the whole family" / "পুরো পরিবার নিয়ে চলে আসুন")',
  tease:
    'a teaser that makes people keep watching (like "Wait for the last one" / "শেষেরটা মিস করবেন না")',
  senses:
    'two or three quick taste, smell or texture words (like "Hot. Juicy. Fresh." / "গরম। রসালো। টাটকা।")',
  mood: 'a relatable everyday feeling food fixes (like "Long day? Eat well." / "মন খারাপ? ভালো কিছু খান।")',
  dare: 'a playful dare (like "Bet you can\'t share this" / "একা খেতে পারবেন তো?")',
  pov: 'a "POV:" line, Gen Z style (like "POV: you found your new favourite" / "POV: নতুন ফেভারিট পেয়ে গেলেন")',
};

/**
 * The style for one video: drawn from the seed, never the one before it, and only styles that fit the
 * tone (no dares or POV lines for a premium restaurant) and what is known (a meal moment needs a time).
 */
export function hookStyleFor(
  seed: number,
  tone: 'friendly' | 'premium' | 'fun',
  opts: { hasMoment: boolean; avoid?: readonly string[] },
): HookStyle {
  const fits = HOOK_STYLES.filter(
    (s) =>
      (s !== 'moment' || opts.hasMoment) &&
      (tone !== 'premium' || (s !== 'dare' && s !== 'pov')) &&
      (s !== 'pov' || tone === 'fun'),
  );
  const fresh = fits.filter((s) => !(opts.avoid ?? []).includes(s));
  const pool = fresh.length ? fresh : fits;
  return pool[Math.abs(Math.trunc(seed)) % pool.length]!;
}

export type MealMoment = 'breakfast' | 'lunch' | 'snack' | 'dinner' | 'late';
/** The meal people are thinking of at a posting hour (0–23, the restaurant's local time). */
export function mealMoment(hour: number): MealMoment {
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 19) return 'snack';
  if (hour >= 19 && hour < 23) return 'dinner';
  return 'late';
}

/**
 * The app's own lines (translation keys under social.video.defaults) when the AI is off or failed: the
 * hook in the video's style, a tagline and a question taking turns by the seed.
 */
export function fallbackWordKeys(
  style: HookStyle,
  moment: MealMoment | null,
  seed: number,
): { hook: string; tagline: string; question: string } {
  const n = Math.abs(Math.trunc(seed));
  return {
    hook:
      style === 'moment' && moment
        ? `video.defaults.moments.${moment}`
        : `video.defaults.hooks.${style === 'moment' ? 'craving' : style}`,
    tagline: `video.defaults.taglines.t${(n % 4) + 1}`,
    question: `video.defaults.questions.q${(Math.trunc(n / 4) % 4) + 1}`,
  };
}

/** A line repeated from the restaurant's recent posts (same words, ignoring case, marks and spaces). */
export function isRepeatLine(line: string, recent: readonly string[]): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const n = norm(line);
  return n.length > 0 && recent.some((r) => norm(r) === n);
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
