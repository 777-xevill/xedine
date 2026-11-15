import { businessDayBounds, weekday, type BusinessDate } from '@/lib/time/business-date';

/**
 * When and what the social autopilot posts (ADR 0040, 0058). Pure, so the rotation is testable with a
 * fixed clock: no sales-data or network access here (the job passes the sales in).
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

/** How many best sellers take turns when the owner has marked no dish. */
export const BEST_SELLERS = 5;

export interface DishCandidate {
  id: string;
  name: string;
  /** Units sold in the last 30 days (items.qty_sold, window last_30d); 0 when none. */
  sold: number;
  /** When this dish was last in a post (ISO), or null if never. */
  lastPostedAt: string | null;
}

/** Why a dish is next: the owner marked it, it is a best seller, or it is simply its turn. */
export type PickReason = 'marked' | 'best_seller' | 'turn';

/** The dishes that are "best sellers": the top five by units in the last 30 days, with any sales. */
export function bestSellers(dishes: readonly DishCandidate[]): Set<string> {
  return new Set(
    dishes
      .filter((d) => d.sold > 0)
      .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name))
      .slice(0, BEST_SELLERS)
      .map((d) => d.id),
  );
}

/** Posted longest ago first (never-posted first of all), then the better seller, then by name. */
function byTurn(a: DishCandidate, b: DishCandidate): number {
  if (a.lastPostedAt !== b.lastPostedAt) {
    if (a.lastPostedAt === null) return -1;
    if (b.lastPostedAt === null) return 1;
    return a.lastPostedAt.localeCompare(b.lastPostedAt);
  }
  return b.sold - a.sold || a.name.localeCompare(b.name);
}

/**
 * The order in which the autopilot tries dishes (ADR 0058). The job posts the first one whose photo
 * passes; Growth shows the first one as "next".
 *
 *  1. Dishes the owner marked "post this": only those, taking turns.
 *  2. Nothing marked: the five best sellers of the last 30 days by units, taking turns; then the rest of
 *     the menu in turn, in case none of their photos can be used.
 *  3. No sales yet: the whole menu in turn.
 *
 * Dishes without a photo, hidden dishes and the "never post" ones are left out before this is called.
 * The dish of the last post (`avoidId`) goes last when another dish can go.
 */
export function autopilotOrder(
  dishes: readonly DishCandidate[],
  marked: ReadonlySet<string>,
  avoidId?: string | null,
): { dish: DishCandidate; reason: PickReason }[] {
  const lastGoesLast = (list: DishCandidate[]) =>
    list.length > 1 && avoidId
      ? [...list.filter((d) => d.id !== avoidId), ...list.filter((d) => d.id === avoidId)]
      : list;
  const mine = dishes.filter((d) => marked.has(d.id));
  if (mine.length)
    return lastGoesLast([...mine].sort(byTurn)).map((dish) => ({ dish, reason: 'marked' }));
  const top = bestSellers(dishes);
  const sellers = dishes.filter((d) => top.has(d.id)).sort(byTurn);
  const rest = dishes.filter((d) => !top.has(d.id)).sort(byTurn);
  return [
    ...lastGoesLast(sellers).map((dish) => ({ dish, reason: 'best_seller' as const })),
    ...(sellers.length ? rest : lastGoesLast(rest)).map((dish) => ({
      dish,
      reason: 'turn' as const,
    })),
  ];
}
