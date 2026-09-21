import { describe, expect, it, afterEach } from 'vitest';
import cases from '../../../tests/fixtures/business-date-cases.json';
import {
  addDays,
  businessDate,
  businessDayBounds,
  weekday,
  zoneOffsetMinutes,
} from './business-date';
import { fixedClock, now, resetClock, setClock } from './clock';

describe('businessDate (shared fixture, mirrored by the SQL test)', () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(businessDate(new Date(c.instant), c.cutoff)).toBe(c.expected);
    });
  }

  it('defaults to a 04:00 cutoff', () => {
    expect(businessDate(new Date('2026-09-21T21:59:00Z'))).toBe('2026-09-21');
    expect(businessDate(new Date('2026-09-21T22:00:00Z'))).toBe('2026-09-22');
  });

  it('rejects an out-of-range cutoff', () => {
    expect(() => businessDate(new Date('2026-09-21T00:00:00Z'), -1)).toThrow(RangeError);
    expect(() => businessDate(new Date('2026-09-21T00:00:00Z'), 1440)).toThrow(RangeError);
    expect(() => businessDate(new Date('2026-09-21T00:00:00Z'), 1.5)).toThrow(RangeError);
  });
});

describe('zone helpers', () => {
  it('Asia/Dhaka is UTC+6 with no DST', () => {
    expect(zoneOffsetMinutes(new Date('2026-01-15T00:00:00Z'))).toBe(360);
    expect(zoneOffsetMinutes(new Date('2026-07-15T00:00:00Z'))).toBe(360);
  });

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('weekday: 2026-09-25 is a Friday (Bangladesh weekend)', () => {
    expect(weekday('2026-09-25')).toBe(5);
    expect(weekday('2026-09-26')).toBe(6);
    expect(weekday('2026-09-27')).toBe(0);
  });
});

describe('businessDayBounds', () => {
  it('a 04:00 business day runs 04:00 → 04:00 Dhaka, i.e. 22:00Z → 22:00Z', () => {
    const { start, endExclusive } = businessDayBounds('2026-09-22', 240);
    expect(start.toISOString()).toBe('2026-09-21T22:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-09-22T22:00:00.000Z');
  });

  it('every instant in the bounds maps back to the same business date', () => {
    const { start, endExclusive } = businessDayBounds('2026-09-22', 240);
    expect(businessDate(start, 240)).toBe('2026-09-22');
    expect(businessDate(new Date(endExclusive.getTime() - 1), 240)).toBe('2026-09-22');
    expect(businessDate(endExclusive, 240)).toBe('2026-09-23');
  });
});

describe('injected clock (ADR 0006)', () => {
  afterEach(() => resetClock());

  it('now() follows the frozen clock, so rolling windows are deterministic', () => {
    // The oracle freezes "now" to anchor_date 23:30 Asia/Dhaka.
    setClock(fixedClock('2026-09-21T17:30:00Z'));
    expect(now().toISOString()).toBe('2026-09-21T17:30:00.000Z');
    expect(businessDate(now())).toBe('2026-09-21');
  });

  it('a fixed clock does not drift and returns fresh Date objects', () => {
    const clock = fixedClock('2026-09-21T17:30:00Z');
    const a = clock.now();
    a.setUTCFullYear(2000);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('rejects an invalid fixed date', () => {
    expect(() => fixedClock('not a date')).toThrow();
  });
});
