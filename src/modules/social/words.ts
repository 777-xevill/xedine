import { z } from 'zod';
import { MOOD_WORDS, type PosterLang, type PosterWords } from './poster-kit';

/**
 * The words of a social post (ADR 0040, 0057): every line any poster design may draw, in Bangla and
 * English, plus the two captions. One AI call fills all of them, so the owner can switch designs in the
 * preview without another call. Pure (no server imports): the Growth preview maps them in the browser.
 */
/**
 * What the AI returns. Plain strings with no length limits: the gateway checks the answer against this
 * schema, and a line one word too long must not stop a post (designs shrink text to fit instead).
 * mood_word is checked by moodWord() below rather than by an enum, for the same reason.
 */
export const SocialWordsSchema = z.object({
  hook_en: z.string(),
  hook_bn: z.string(),
  headline_en: z.string(),
  headline_bn: z.string(),
  tagline_en: z.string(),
  tagline_bn: z.string(),
  kicker_en: z.string(),
  kicker_bn: z.string(),
  status_q_en: z.string(),
  status_a_en: z.string(),
  status_b_en: z.string(),
  status_c_en: z.string(),
  status_q_bn: z.string(),
  status_a_bn: z.string(),
  status_b_bn: z.string(),
  status_c_bn: z.string(),
  mood_top_en: z.string(),
  mood_word: z.string(),
  mood_bottom_en: z.string(),
  caption_bn: z.string(),
  caption_en: z.string(),
});
export type SocialWords = z.infer<typeof SocialWordsSchema>;

/** Longest line the owner may send back from the preview, per field. */
const LIMITS: Record<keyof SocialWords, number> = {
  hook_en: 120,
  hook_bn: 120,
  headline_en: 80,
  headline_bn: 80,
  tagline_en: 140,
  tagline_bn: 140,
  kicker_en: 60,
  kicker_bn: 60,
  status_q_en: 60,
  status_a_en: 30,
  status_b_en: 30,
  status_c_en: 30,
  status_q_bn: 60,
  status_a_bn: 30,
  status_b_bn: 30,
  status_c_bn: 30,
  mood_top_en: 40,
  mood_word: 10,
  mood_bottom_en: 30,
  caption_bn: 1500,
  caption_en: 1500,
};

/**
 * What the owner approved in the preview: any subset of the words (they may have typed some themselves),
 * and the language they previewed the poster in.
 */
export const ApprovedWordsSchema = SocialWordsSchema.partial()
  .extend({ poster_lang: z.enum(['bn', 'en']).optional() })
  .strict()
  .refine((w) =>
    Object.entries(w).every(
      ([k, v]) =>
        k === 'poster_lang' ||
        (typeof v === 'string' && v.length <= LIMITS[k as keyof SocialWords]),
    ),
  );
export type ApprovedWords = z.infer<typeof ApprovedWordsSchema>;

export function moodWord(value: string | undefined): (typeof MOOD_WORDS)[number] {
  const v = (value ?? '').trim().toUpperCase();
  return (MOOD_WORDS as readonly string[]).includes(v)
    ? (v as (typeof MOOD_WORDS)[number])
    : 'MOOD';
}

const DIGITS = /[0-9০-৯]+/g;
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Bangla digits as ASCII, so "১০" in a caption matches "10" in the fact. */
export function asciiDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** The first number in the AI's words that is not in the allowed text (CLAUDE.md #1), or null. */
export function inventedNumber(
  words: Partial<Record<string, string>>,
  allowedText: string,
): string | null {
  const allowed = new Set(asciiDigits(allowedText).match(DIGITS) ?? []);
  for (const text of Object.values(words))
    for (const n of asciiDigits(text ?? '').match(DIGITS) ?? []) if (!allowed.has(n)) return n;
  return null;
}

/** The fallback lines (from the app's translations) used before the AI has written anything. */
export interface DefaultLines {
  kicker: string;
  tagline: string;
  statusQ: string;
  statusA: string;
  statusB: string;
  statusC: string;
  moodTop: string;
  moodBottom: string;
}

/** Words for a poster in one language: the AI's (or the owner's), falling back to plain defaults. */
export function posterWords(
  w: Partial<SocialWords>,
  lang: PosterLang,
  dish: string,
  d: DefaultLines,
): PosterWords {
  const pick = (en: keyof SocialWords, bn: keyof SocialWords) => {
    const v = (lang === 'bn' ? w[bn] : w[en]) as string | undefined;
    return v && v.trim() ? v.trim() : undefined;
  };
  const headline = pick('headline_en', 'headline_bn') ?? dish;
  return {
    hook: pick('hook_en', 'hook_bn') ?? headline,
    headline,
    tagline: pick('tagline_en', 'tagline_bn') ?? d.tagline,
    kicker: pick('kicker_en', 'kicker_bn') ?? d.kicker,
    statusQ: pick('status_q_en', 'status_q_bn') ?? d.statusQ,
    statusA: pick('status_a_en', 'status_a_bn') ?? d.statusA,
    statusB: pick('status_b_en', 'status_b_bn') ?? d.statusB,
    statusC: pick('status_c_en', 'status_c_bn') ?? d.statusC,
    moodTop: w.mood_top_en?.trim() || d.moodTop,
    moodWord: moodWord(w.mood_word),
    moodBottom: w.mood_bottom_en?.trim() || d.moodBottom,
  };
}

/**
 * The language a poster's words are in. 'both' alternates day by day, so the feed carries both languages
 * while each poster reads as one design (the caption always has both).
 */
export function posterLang(language: 'bn' | 'en' | 'both', dayNumber: number): PosterLang {
  if (language === 'bn' || language === 'en') return language;
  return dayNumber % 2 === 0 ? 'bn' : 'en';
}
