import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatBps,
  formatDateTime,
  formatTime,
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

describe('formatMoney in taka', () => {
  it('formats taka with lakh grouping in English', () => {
    expect(formatMoney(12_345_600, 'en', 'BDT')).toBe('৳1,23,456');
    expect(formatMoney(1_234_567_800, 'en', 'BDT')).toBe('৳1,23,45,678');
    expect(formatMoney(0, 'en', 'BDT')).toBe('৳0');
  });

  it("'auto' shows poisha only when non-zero", () => {
    expect(formatMoney(30_050, 'en', 'BDT')).toBe('৳300.50');
    expect(formatMoney(30_005, 'en', 'BDT')).toBe('৳300.05');
    expect(formatMoney(30_000, 'en', 'BDT')).toBe('৳300');
  });

  it("'always' and 'never'", () => {
    expect(formatMoney(30_000, 'en', 'BDT', { poisha: 'always' })).toBe('৳300.00');
    expect(formatMoney(30_049, 'en', 'BDT', { poisha: 'never' })).toBe('৳300');
    expect(formatMoney(30_050, 'en', 'BDT', { poisha: 'never' })).toBe('৳301');
  });

  it('uses Bangla digits when the locale is bn', () => {
    expect(formatMoney(12_345_600, 'bn', 'BDT')).toBe('৳১,২৩,৪৫৬');
    expect(formatMoney(30_050, 'bn', 'BDT')).toBe('৳৩০০.৫০');
  });

  it('negative values carry a minus sign; zero is never negative', () => {
    expect(formatMoney(-2_500_000, 'en', 'BDT')).toBe('-৳25,000');
    expect(formatMoney(-49, 'en', 'BDT', { poisha: 'never' })).toBe('৳0');
  });

  it('can omit the symbol', () => {
    expect(formatMoney(30_000, 'en', 'BDT', { symbol: false })).toBe('300');
  });

  it('rejects non-integer poisha', () => {
    expect(() => formatMoney(1.5, 'en', 'BDT')).toThrow(RangeError);
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
    expect(formatTime(instant, 'en', 'Asia/Dhaka')).toBe('04:00');
  });

  it('localizes to Bangla digits for bn', () => {
    expect(formatTime(instant, 'bn', 'Asia/Dhaka')).toMatch(/^[০-৯]{2}[:.][০-৯]{2}$/);
    expect(formatDateTime(instant, 'bn', 'Asia/Dhaka')).toMatch(/[০-৯]/);
  });

  it('date part is the Dhaka date', () => {
    expect(formatDateTime(instant, 'en', 'Asia/Dhaka')).toContain('22');
  });
});

describe('formatMoney in the restaurant’s own currency (ADR 0062)', () => {
  it('groups by thousands outside South Asia, with the currency’s own sign', () => {
    expect(formatMoney(12_345_600, 'en', 'USD')).toBe('$123,456');
    expect(formatMoney(125_050, 'en', 'GBP')).toBe('£1,250.50');
    expect(formatMoney(125_000, 'en', 'AED')).toBe('AED 1,250');
    expect(formatMoney(125_000, 'en', 'SAR')).toBe('SAR 1,250');
    expect(formatMoney(125_000, 'en', 'MYR')).toBe('RM1,250');
    expect(formatMoney(125_000, 'en', 'SGD')).toBe('S$1,250');
    expect(formatMoney(-2_500_000, 'en', 'USD')).toBe('-$25,000');
  });

  it('keeps lakh grouping for the rupees and taka', () => {
    expect(formatMoney(12_345_600, 'en', 'INR')).toBe('₹1,23,456');
    expect(formatMoney(12_345_600, 'en', 'PKR')).toBe('Rs 1,23,456');
    expect(formatMoney(12_345_600, 'bn', 'BDT')).toBe('৳১,২৩,৪৫৬');
  });
});

describe('times on the restaurant’s own clock (ADR 0062)', () => {
  it('shows the same instant in each zone', () => {
    const instant = new Date('2026-11-16T09:00:00Z');
    expect(formatTime(instant, 'en', 'Asia/Dhaka')).toBe('15:00');
    expect(formatTime(instant, 'en', 'Asia/Dubai')).toBe('13:00');
    expect(formatTime(instant, 'en', 'Europe/London')).toBe('09:00');
    expect(formatTime(instant, 'en', 'America/New_York')).toBe('04:00');
  });
});
