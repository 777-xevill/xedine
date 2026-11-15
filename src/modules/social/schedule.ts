import { businessDayBounds, weekday, type BusinessDate } from '@/lib/time/business-date';

/**
 * When and what the social autopilot posts (ADR 0040). Pure, so the rotation is testable with a fixed
 * clock: no sales-data or network access here.
 */
export type SocialFormat = 'mix' | 'image' | 'video';
export type PostAngle = 'star' | 'quiet_time' | 'spotlight' | 'own';

/** 'HH:MM' or 'HH:MM:SS' local Asia/Dhaka time on a calendar date → the UTC instant. */
export function slotAt(date: BusinessDate, postTime: string): Date {
  const m = /^(\d{2}):(\d{2})/.exec(postTime);
  if (!m) throw new RangeError(`Invalid post time: ${postTime}`);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  // A cutoff of 0 makes the "business day" the plain calendar day.
  return new Date(businessDayBounds(date, 0).start.getTime() + minutes * 60_000);
}

/** Days since 1970-01-01 for a calendar date: a stable counter that drives every rotation. */
export function dayNumber(date: BusinessDate): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

export function isPostingDay(date: BusinessDate, days: readonly number[]): boolean {
  return days.includes(weekday(date));
}

/** 'mix' alternates: a poster one day, a reel the next. */
export function formatForDay(format: SocialFormat, date: BusinessDate): 'image' | 'video' {
  if (format === 'image' || format === 'video') return format;
  return dayNumber(date) % 2 === 0 ? 'image' : 'video';
}

/**
 * Which story today's post tells. Rotates star → quiet time → spotlight, falling back to a spotlight
 * when the data for the planned story is missing (no clear best seller, no sales split yet).
 */
export function angleForDay(
  date: BusinessDate,
  have: { star: boolean; quietTime: boolean },
): Exclude<PostAngle, 'own'> {
  const planned = (['star', 'quiet_time', 'spotlight'] as const)[dayNumber(date) % 3]!;
  if (planned === 'star' && !have.star) return 'spotlight';
  if (planned === 'quiet_time' && !have.quietTime) return 'spotlight';
  return planned;
}

export interface DishChoice {
  id: string;
  name: string;
  /** When this dish was last in a post (ISO), or null if never. */
  lastPostedAt: string | null;
}

/**
 * The dish for a spotlight / quiet-time post: the one posted longest ago (never-posted first), so the
 * whole menu gets its turn. Ties break by name so the choice is stable. Dishes without a photo, hidden
 * dishes and the owner's "never post" list are filtered out before this is called.
 */
export function pickDish(
  dishes: readonly DishChoice[],
  avoidId?: string | null,
): DishChoice | null {
  const pool = dishes.length > 1 && avoidId ? dishes.filter((d) => d.id !== avoidId) : dishes;
  const sorted = [...pool].sort((a, b) => {
    if (a.lastPostedAt === b.lastPostedAt) return a.name.localeCompare(b.name);
    if (a.lastPostedAt === null) return -1;
    if (b.lastPostedAt === null) return 1;
    return a.lastPostedAt.localeCompare(b.lastPostedAt);
  });
  return sorted[0] ?? null;
}

/** The poster designs (ADR 0057). The first four are ADR 0040's, redrawn around dish cut-outs. */
export const POSTER_DESIGNS = [
  'band',
  'centre',
  'frame',
  'split',
  'status',
  'mood',
  'giant',
  'menu',
  'breakout',
  'minimal',
] as const;
export type PosterDesign = (typeof POSTER_DESIGNS)[number];
export type SocialTone = 'friendly' | 'premium' | 'fun';

export function isPosterDesign(value: unknown): value is PosterDesign {
  return typeof value === 'string' && (POSTER_DESIGNS as readonly string[]).includes(value);
}

/** What the restaurant has to fill a design with. */
export interface DesignNeeds {
  /** The poster's words are English (the MOOD/FOOD/GOOD letters only work in English). */
  english: boolean;
  /** Dishes with a usable photo: the menu design needs at least two. */
  dishes: number;
}

/**
 * How many other dishes a design shows besides the main one, and what it needs of them: a clean cut-out
 * (menu, letters, band, corners), just the photo (the phone's profile grid) or just the name (a list).
 */
export const DESIGN_EXTRAS: Partial<
  Record<PosterDesign, { count: number; need: 'cut' | 'photo' | 'name' }>
> = {
  menu: { count: 2, need: 'cut' },
  mood: { count: 1, need: 'cut' },
  band: { count: 1, need: 'cut' },
  minimal: { count: 1, need: 'cut' },
  breakout: { count: 5, need: 'photo' },
  split: { count: 3, need: 'name' },
};

export function designFits(design: PosterDesign, needs: DesignNeeds): boolean {
  if (design === 'mood') return needs.english;
  if (design === 'menu') return needs.dishes >= 2;
  return true;
}

/** Each tone leads with the designs that suit it; the rest follow so the feed still varies. */
const TONE_ORDER: Record<SocialTone, readonly PosterDesign[]> = {
  friendly: [
    'centre',
    'status',
    'giant',
    'frame',
    'band',
    'split',
    'menu',
    'mood',
    'breakout',
    'minimal',
  ],
  fun: [
    'status',
    'split',
    'mood',
    'breakout',
    'giant',
    'band',
    'centre',
    'frame',
    'menu',
    'minimal',
  ],
  premium: [
    'minimal',
    'frame',
    'menu',
    'giant',
    'centre',
    'band',
    'breakout',
    'status',
    'split',
    'mood',
  ],
};

/**
 * The design of a day's post: rotates through the designs the owner allows and the restaurant can fill,
 * skipping the ones its last few posts used, so the feed never repeats itself.
 */
export function designForDay(
  date: BusinessDate,
  o: {
    tone: SocialTone;
    allowed: readonly PosterDesign[];
    needs: DesignNeeds;
    recent?: readonly string[];
    offset?: number;
  },
): PosterDesign {
  const pool = TONE_ORDER[o.tone].filter((d) => o.allowed.includes(d) && designFits(d, o.needs));
  if (pool.length === 0) return 'centre';
  const start = (dayNumber(date) + (o.offset ?? 0)) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const d = pool[(start + i) % pool.length]!;
    if (!(o.recent ?? []).includes(d)) return d;
  }
  return pool[start]!;
}
