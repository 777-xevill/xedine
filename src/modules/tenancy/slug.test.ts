import { describe, expect, it } from 'vitest';
import { fallbackSlug, slugFromName } from './slug';

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

describe('the restaurant link made from its name', () => {
  it('turns a name into a valid link', () => {
    expect(slugFromName('Kacchi House')).toBe('kacchi-house');
    expect(slugFromName("  Rahim's Café & Grill! ")).toBe('rahims-cafe-and-grill');
    expect(SLUG.test(slugFromName('Star Kabab — Dhanmondi 27'))).toBe(true);
  });

  it('never ends or starts with a dash, and stays within 40 characters', () => {
    const slug = slugFromName('The Very Long Name Of A Restaurant That Keeps Going And Going On');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    expect(SLUG.test(slug)).toBe(true);
  });

  it('gives nothing for a Bangla name, so the fallback is used', () => {
    expect(slugFromName('কাচ্চি হাউজ')).toBe('');
    expect(SLUG.test(fallbackSlug(7))).toBe(true);
    expect(fallbackSlug(7)).toBe('restaurant-0007');
    expect(fallbackSlug(123456)).toBe('restaurant-3456');
  });
});
