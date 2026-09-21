/**
 * The single place that reads the wall clock (ADR 0006). Business logic calls now() so that
 * business-day cutoffs and rolling windows (last_2h, today, week_to_date) are testable.
 * ESLint bans `new Date()` / `Date.now()` everywhere else under src/.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

let active: Clock = systemClock;

export function now(): Date {
  return active.now();
}

/** Tests and the seed validator only. Refuses to run in production unless explicitly allowed. */
export function setClock(clock: Clock): void {
  if (process.env.NODE_ENV === 'production' && process.env.XEDINE_ALLOW_CLOCK_OVERRIDE !== '1') {
    throw new Error('setClock is not allowed in production');
  }
  active = clock;
}

export function resetClock(): void {
  active = systemClock;
}

export function fixedClock(at: Date | string): Clock {
  const instant = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(instant.getTime())) throw new Error(`fixedClock: invalid date ${String(at)}`);
  return { now: () => new Date(instant.getTime()) };
}
