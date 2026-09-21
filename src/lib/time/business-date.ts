/**
 * Business-day logic (CLAUDE.md non-negotiable #3, METRICS.md). Timestamps are stored as UTC
 * timestamptz; business logic works in Asia/Dhaka with a per-branch cutoff (default 04:00), so an
 * order at 01:30 on the 22nd belongs to business_date the 21st.
 *
 * The SQL twin is private.business_date(ts, cutoff_minutes); tests/fixtures/business-date-cases.json
 * is asserted against both implementations.
 */
export const DHAKA_TZ = 'Asia/Dhaka';
export const DEFAULT_CUTOFF_MINUTES = 240;

export type BusinessDate = string; // 'YYYY-MM-DD'

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(instant: Date, tz: string = DHAKA_TZ): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? NaN,
    month: out.month ?? NaN,
    day: out.day ?? NaN,
    hour: out.hour ?? NaN,
    minute: out.minute ?? NaN,
    second: out.second ?? NaN,
  };
}

/** Local minus UTC, in minutes, at the given instant. */
export function zoneOffsetMinutes(instant: Date, tz: string = DHAKA_TZ): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

export function assertCutoff(cutoffMinutes: number): void {
  if (!Number.isInteger(cutoffMinutes) || cutoffMinutes < 0 || cutoffMinutes >= 1440) {
    throw new RangeError(`cutoffMinutes must be an integer in [0, 1440), got ${cutoffMinutes}`);
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The business_date an instant belongs to. */
export function businessDate(
  instant: Date,
  cutoffMinutes: number = DEFAULT_CUTOFF_MINUTES,
  tz: string = DHAKA_TZ,
): BusinessDate {
  assertCutoff(cutoffMinutes);
  const p = zonedParts(new Date(instant.getTime() - cutoffMinutes * 60_000), tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function parseBusinessDate(date: BusinessDate): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Invalid business date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function addDays(date: BusinessDate, days: number): BusinessDate {
  const { y, m, d } = parseBusinessDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday. Friday (5) and Saturday (6) are the Bangladesh weekend. */
export function weekday(date: BusinessDate): number {
  const { y, m, d } = parseBusinessDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** UTC instants bounding a business day: [start, endExclusive). */
export function businessDayBounds(
  date: BusinessDate,
  cutoffMinutes: number = DEFAULT_CUTOFF_MINUTES,
  tz: string = DHAKA_TZ,
): { start: Date; endExclusive: Date } {
  assertCutoff(cutoffMinutes);
  const at = (day: BusinessDate): Date => {
    const { y, m, d } = parseBusinessDate(day);
    const localAsUtc = Date.UTC(y, m - 1, d, 0, cutoffMinutes);
    let guess = new Date(localAsUtc);
    for (let i = 0; i < 2; i++) {
      guess = new Date(localAsUtc - zoneOffsetMinutes(guess, tz) * 60_000);
    }
    return guess;
  };
  return { start: at(date), endExclusive: at(addDays(date, 1)) };
}
