import { describe, expect, it } from 'vitest';
import {
  formatBDT,
  formatBps,
  formatDhakaDateTime,
  formatDhakaTime,
  formatNumber,
  groupLakh,
  toBanglaDigits,
} from './format';

describe('groupLakh (ROADMAP Phase 0 Done-when: 1,23,45,678)', () => {
  it.each([
    ['0', '0'],
    ['999', '999'],
    ['1000', '1,000'],
    ['12345', '12,345'],
    ['123456', '1,23,456'],
    ['1234567', '12,34,567'],
    ['12345678', '1,23,45,678'],
    ['123456789', '12,34,56,789'],
  ])('%s → %s', (input, expected) => {
    expect(groupLakh(input)).toBe(expected);
  });
});

describe('formatBDT', () => {
  it('formats taka with lakh grouping in English', () => {
    expect(formatBDT(12_345_600, 'en')).toBe('৳1,23,456');
    expect(formatBDT(1_234_567_800, 'en')).toBe('৳1,23,45,678');
    expect(formatBDT(0, 'en')).toBe('৳0');
  });

  it("'auto' shows poisha only when non-zero", () => {
    expect(formatBDT(30_050, 'en')).toBe('৳300.50');
    expect(formatBDT(30_005, 'en')).toBe('৳300.05');
    expect(formatBDT(30_000, 'en')).toBe('৳300');
  });

  it("'always' and 'never'", () => {
    expect(formatBDT(30_000, 'en', { poisha: 'always' })).toBe('৳300.00');
    expect(formatBDT(30_049, 'en', { poisha: 'never' })).toBe('৳300');
    expect(formatBDT(30_050, 'en', { poisha: 'never' })).toBe('৳301');
  });

  it('uses Bangla digits when the locale is bn', () => {
    expect(formatBDT(12_345_600, 'bn')).toBe('৳১,২৩,৪৫৬');
    expect(formatBDT(30_050, 'bn')).toBe('৳৩০০.৫০');
  });

  it('negative values carry a minus sign; zero is never negative', () => {
    expect(formatBDT(-2_500_000, 'en')).toBe('-৳25,000');
    expect(formatBDT(-49, 'en', { poisha: 'never' })).toBe('৳0');
  });

  it('can omit the symbol', () => {
    expect(formatBDT(30_000, 'en', { symbol: false })).toBe('300');
  });

  it('rejects non-integer poisha', () => {
    expect(() => formatBDT(1.5, 'en')).toThrow(RangeError);
  });
});

describe('formatNumber / formatBps / toBanglaDigits', () => {
  it('groups by lakh and localizes digits', () => {
    expect(formatNumber(12_345_678, 'en')).toBe('1,23,45,678');
    expect(formatNumber(12_345_678, 'bn')).toBe('১,২৩,৪৫,৬৭৮');
    expect(formatNumber(1234.5, 'en', { fractionDigits: 2 })).toBe('1,234.50');
    expect(formatNumber(-1500, 'en')).toBe('-1,500');
  });

  it('formatBps', () => {
    expect(formatBps(500, 'en')).toBe('5%');
    expect(formatBps(1250, 'en')).toBe('12.5%');
    expect(formatBps(500, 'bn')).toBe('৫%');
  });

  it('toBanglaDigits leaves non-digits alone', () => {
    expect(toBanglaDigits('Order #204 — 3 items')).toBe('Order #২০৪ — ৩ items');
  });
});

describe('Dhaka date/time formatting', () => {
  // 2026-09-21T22:00:00Z is 04:00 on the 22nd in Dhaka.
  const instant = new Date('2026-09-21T22:00:00Z');

  it('renders Dhaka wall-clock time, not UTC or the server zone', () => {
    expect(formatDhakaTime(instant, 'en')).toBe('04:00');
  });

  it('localizes to Bangla digits for bn', () => {
    expect(formatDhakaTime(instant, 'bn')).toMatch(/^[০-৯]{2}[:.][০-৯]{2}$/);
    expect(formatDhakaDateTime(instant, 'bn')).toMatch(/[০-৯]/);
  });

  it('date part is the Dhaka date', () => {
    expect(formatDhakaDateTime(instant, 'en')).toContain('22');
  });
});
