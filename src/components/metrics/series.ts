import { addDays, type BusinessDate } from '@/lib/time/business-date';

/**
 * Shapes metric rows into a time axis for a chart. Pure layout: it orders and zero-fills what a metric
 * function returned and never adds, averages or estimates a figure.
 */

export interface HourPoint {
  hour: number;
  net_poisha: number;
}

/**
 * Hours in business-day order (a 04:00 cutoff puts 01:00 after 23:00), with the quiet hours between
 * the first and the last sale filled with zero so the axis reads as time.
 */
export function hourSeries(
  rows: readonly { key: string; net_poisha: number }[],
  cutoffMinutes: number,
): HourPoint[] {
  const start = Math.floor(cutoffMinutes / 60) % 24;
  const pos = (h: number) => (h - start + 24) % 24;
  const byHour = new Map<number, number>();
  for (const r of rows) {
    const h = Number(r.key);
    if (Number.isInteger(h) && h >= 0 && h < 24) byHour.set(h, r.net_poisha);
  }
  if (byHour.size === 0) return [];
  const positions = [...byHour.keys()].map(pos);
  const first = Math.min(...positions);
  const last = Math.max(...positions);
  const out: HourPoint[] = [];
  for (let p = first; p <= last; p++) {
    const hour = (p + start) % 24;
    out.push({ hour, net_poisha: byHour.get(hour) ?? 0 });
  }
  return out;
}

/** Every business date from `from` to `to`, inclusive (at most `max`, newest kept). */
export function daySeries(from: BusinessDate, to: BusinessDate, max = 31): BusinessDate[] {
  const days: BusinessDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days.slice(-max);
}

export type HourPeriod = 'night' | 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'late';

/** The part of the day a clock hour belongs to, for "8 pm" / "রাত ৮টা" style labels. */
export function hourPeriod(hour: number): HourPeriod {
  if (hour < 4) return 'night';
  if (hour < 6) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 15) return 'noon';
  if (hour < 18) return 'afternoon';
  if (hour < 20) return 'evening';
  return 'late';
}

/** 12-hour clock number: 0 → 12, 13 → 1. */
export const hour12 = (hour: number): number => hour % 12 || 12;

/** The key of the largest positive value, for the one direct label a chart gets. */
export function peakKey<T>(items: readonly T[], value: (i: T) => number, key: (i: T) => string) {
  let best: T | null = null;
  for (const i of items) if (value(i) > 0 && (best === null || value(i) > value(best))) best = i;
  return best === null ? null : key(best);
}
