import { describe, expect, it } from 'vitest';
import {
  CODE_PATTERN,
  codeStatus,
  normalizeCode,
  parseEndDate,
  parseMaxUses,
  parsePercentBps,
  randomCode,
} from './codes';

describe('normalizeCode', () => {
  it('keeps capitals and digits, whatever the cashier types around them', () => {
    expect(normalizeCode(' eid-10 ')).toBe('EID10');
    expect(normalizeCode('k7m 2q9')).toBe('K7M2Q9');
    expect(normalizeCode('---')).toBe('');
  });
});

describe('parsePercentBps', () => {
  it('turns a percent into basis points, and refuses 0, over 100 and words', () => {
    expect(parsePercentBps('10')).toBe(1000);
    expect(parsePercentBps('12.5')).toBe(1250);
    expect(parsePercentBps('100')).toBe(10_000);
    expect(parsePercentBps('১৫')).toBe(1500);
    for (const bad of ['0', '100.5', '-5', 'ten', '', '10%'])
      expect(parsePercentBps(bad), bad).toBeNull();
  });
});

describe('parseMaxUses', () => {
  it('blank means no limit, otherwise a whole number of bills', () => {
    expect(parseMaxUses('')).toBeNull();
    expect(parseMaxUses('  ')).toBeNull();
    expect(parseMaxUses('1')).toBe(1);
    expect(parseMaxUses('50')).toBe(50);
    expect(parseMaxUses('৫')).toBe(5);
    for (const bad of ['0', '2.5', '-1', 'many', '100001'])
      expect(parseMaxUses(bad), bad).toBe('bad');
  });
});

describe('parseEndDate', () => {
  it('blank means no end date, otherwise a real day', () => {
    expect(parseEndDate('')).toBeNull();
    expect(parseEndDate('2026-10-31')).toBe('2026-10-31');
    for (const bad of ['2026-02-30', '31/10/2026', '2026-13-01', 'soon']) {
      expect(parseEndDate(bad), bad).toBe('bad');
    }
  });
});

describe('randomCode', () => {
  it('makes six characters the database accepts, with none that look alike', () => {
    let n = 0;
    const code = randomCode((size) => n++ % size);
    expect(code).toHaveLength(6);
    expect(CODE_PATTERN.test(code)).toBe(true);
    const everything = randomCode((size) => n++ % size, 64);
    expect(everything).not.toMatch(/[01OI]/);
  });
});

describe('codeStatus', () => {
  const live = { is_active: true, ends_on: null, max_uses: null };
  it('reads a code the way the cashier would meet it', () => {
    expect(codeStatus(live, 40, '2026-10-24')).toBe('working');
    expect(codeStatus({ ...live, is_active: false }, 0, '2026-10-24')).toBe('off');
    expect(codeStatus({ ...live, ends_on: '2026-10-24' }, 0, '2026-10-24')).toBe('working');
    expect(codeStatus({ ...live, ends_on: '2026-10-23' }, 0, '2026-10-24')).toBe('ended');
    expect(codeStatus({ ...live, max_uses: 5 }, 4, '2026-10-24')).toBe('working');
    expect(codeStatus({ ...live, max_uses: 5 }, 5, '2026-10-24')).toBe('usedUp');
  });
  it('says turned off before ended, and ended before used up', () => {
    const all = { is_active: false, ends_on: '2020-01-01', max_uses: 1 };
    expect(codeStatus(all, 3, '2026-10-24')).toBe('off');
    expect(codeStatus({ ...all, is_active: true }, 3, '2026-10-24')).toBe('ended');
  });
});
