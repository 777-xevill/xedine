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

// ---------------------------------------------------------------------------------------------
// Short videos (ADR 0061)
// ---------------------------------------------------------------------------------------------

/** Good times for the day's videos, in the order they are used (local Asia/Dhaka). */
export const VIDEO_TIMES = ['12:30', '19:30', '16:00', '21:00', '10:30', '18:00', '14:00'] as const;

const minutesOf = (hhmm: string) => {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/**
 * When the day's n videos go out: the good times in order, leaving out any within an hour of the daily
 * post so two posts never land together.
 */
export function videoTimes(postTime: string, n: number): string[] {
  const post = minutesOf(postTime);
  return VIDEO_TIMES.filter((t) => Math.abs(minutesOf(t) - post) >= 60).slice(0, Math.max(0, n));
}

/** The autopilot's video kinds, taking turns across days and slots (each needs 1, 2 or 3 dishes). */
export const AUTOPILOT_VIDEO_KINDS = [
  'showcase',
  'versus',
  'carousel',
  'combo',
  'ring',
  'search',
] as const;
export type AutopilotVideoKind = (typeof AUTOPILOT_VIDEO_KINDS)[number];
export const KIND_DISHES: Record<AutopilotVideoKind | 'offer', number> = {
  showcase: 1,
  offer: 1,
  versus: 2,
  combo: 2,
  carousel: 3,
  ring: 3,
  search: 3,
};

export function videoKindFor(date: BusinessDate, slot: number): AutopilotVideoKind {
  const n = AUTOPILOT_VIDEO_KINDS.length;
  return AUTOPILOT_VIDEO_KINDS[(((dayNumber(date) * 3 + slot) % n) + n) % n]!;
}

/** The kind that fits when fewer dishes are usable than the planned kind needs. */
export function kindForDishes(kind: AutopilotVideoKind, dishes: number): AutopilotVideoKind {
  if (dishes >= KIND_DISHES[kind]) return kind;
  if (kind === 'search' && dishes >= 2) return kind;
  if (dishes >= 2) return kind === 'carousel' || kind === 'ring' ? 'versus' : 'combo';
  return 'showcase';
}

/** Whether this video carries the AI voice: all, none, or every other one ("half"). */
export function voiceFor(
  share: 'none' | 'half' | 'all',
  date: BusinessDate,
  slot: number,
): boolean {
  if (share === 'all') return true;
  if (share === 'none') return false;
  return (dayNumber(date) + slot) % 2 === 0;
}

/**
 * The special day a video greets: a festival on the restaurant's calendar first (the calendar keys come
 * from the BD calendar, mapped by the caller), else Jummah on a Friday. Null with greetings off.
 */
export function occasionForDay<O extends string>(
  date: BusinessDate,
  greetings: boolean,
  festival: O | null,
): O | 'jummah' | null {
  if (!greetings) return null;
  if (festival) return festival;
  return weekday(date) === 5 ? 'jummah' : null;
}

/**
 * Partners for a dish, the way customers order them: dishes most often in the same order (growth.pairs),
 * then the best sellers, never the dish itself, only among `allowed`.
 */
export function partnersFor(
  mainId: string,
  pairs: readonly { item_a: string; item_b: string; orders: number }[],
  allowed: readonly DishCandidate[],
  n: number,
): string[] {
  const ok = new Set(allowed.map((d) => d.id));
  const together = pairs
    .filter((p) => p.item_a === mainId || p.item_b === mainId)
    .sort((a, b) => b.orders - a.orders)
    .map((p) => (p.item_a === mainId ? p.item_b : p.item_a))
    .filter((id) => ok.has(id));
  const sellers = [...allowed]
    .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name))
    .map((d) => d.id);
  const out: string[] = [];
  for (const id of [...together, ...sellers]) {
    if (out.length >= n) break;
    if (id !== mainId && !out.includes(id)) out.push(id);
  }
  return out;
}
