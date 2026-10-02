import { describe, expect, it } from 'vitest';
import { formatQuantity } from './format';

const en = (u: string) => u;
const bn = (u: string) => ({ kg: 'কেজি', g: 'গ্রাম', l: 'লিটার', ml: 'মিলি', pcs: 'পিস' })[u] ?? u;

describe('formatQuantity', () => {
  it('shows kilograms from 1,000 g and grams below', () => {
    expect(formatQuantity(2500, 'g', 'en', en)).toBe('2.5 kg');
    expect(formatQuantity(850, 'g', 'en', en)).toBe('850 g');
    expect(formatQuantity(1000, 'ml', 'en', en)).toBe('1 l');
  });

  it('keeps up to three decimals by default and can be shortened for a quick read', () => {
    expect(formatQuantity(9404, 'g', 'en', en)).toBe('9.404 kg');
    expect(formatQuantity(9404, 'g', 'en', en, { maxDecimals: 1 })).toBe('9.4 kg');
    expect(formatQuantity(59874, 'g', 'en', en, { maxDecimals: 1 })).toBe('59.9 kg');
    expect(formatQuantity(6386, 'g', 'en', en, { maxDecimals: 1 })).toBe('6.4 kg');
  });

  it('drops a trailing zero and rounds whole values', () => {
    expect(formatQuantity(50320, 'g', 'en', en, { maxDecimals: 1 })).toBe('50.3 kg');
    expect(formatQuantity(61000, 'g', 'en', en, { maxDecimals: 1 })).toBe('61 kg');
    expect(formatQuantity(7886, 'g', 'en', en, { maxDecimals: 0 })).toBe('8 kg');
  });

  it('counts pieces as they are, and uses Bangla digits and unit names in Bangla', () => {
    expect(formatQuantity(24, 'pcs', 'en', en, { maxDecimals: 1 })).toBe('24 pcs');
    expect(formatQuantity(9404, 'g', 'bn', bn, { maxDecimals: 1 })).toBe('৯.৪ কেজি');
    expect(formatQuantity(412, 'pcs', 'bn', bn)).toBe('৪১২ পিস');
  });

  it('shows a negative quantity with its sign', () => {
    expect(formatQuantity(-2000, 'g', 'en', en)).toBe('-2 kg');
  });
});
