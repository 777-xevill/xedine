import { describe, expect, it } from 'vitest';
import {
  cardCookieName,
  isNumberedTable,
  missingTableNumbers,
  parseGoogleReviewUrl,
  tableUrl,
} from './table-qr';

describe('table QR helpers', () => {
  it('builds the table link without a double slash', () => {
    expect(tableUrl('https://xedine.org/', 'a'.repeat(32))).toBe(
      `https://xedine.org/t/${'a'.repeat(32)}`,
    );
  });

  it('names the card cookie per restaurant', () => {
    expect(cardCookieName('0b0c5a1e-1111-2222-3333-444455556666')).toBe(
      'xc_0b0c5a1e111122223333444455556666',
    );
  });

  it('knows a numbered table', () => {
    expect(isNumberedTable('4')).toBe(true);
    expect(isNumberedTable(' 12 ')).toBe(true);
    expect(isNumberedTable('Garden 1')).toBe(false);
  });

  it('accepts only Google review links', () => {
    expect(parseGoogleReviewUrl('https://g.page/r/CabC123/review')).toBe(
      'https://g.page/r/CabC123/review',
    );
    expect(
      parseGoogleReviewUrl(' https://search.google.com/local/writereview?placeid=ChIJ1 '),
    ).toBe('https://search.google.com/local/writereview?placeid=ChIJ1');
    expect(parseGoogleReviewUrl('https://maps.app.goo.gl/abc')).toBe('https://maps.app.goo.gl/abc');
    expect(parseGoogleReviewUrl('https://www.google.com.bd/maps/place/x')).not.toBeNull();
    expect(parseGoogleReviewUrl('http://g.page/r/x/review')).toBeNull();
    expect(parseGoogleReviewUrl('https://google.com.evil.example/x')).toBeNull();
    expect(parseGoogleReviewUrl('https://evilgoogle.com/x')).toBeNull();
    expect(parseGoogleReviewUrl('not a link')).toBeNull();
    expect(parseGoogleReviewUrl('')).toBeNull();
  });

  it('adds only the missing table numbers', () => {
    expect(missingTableNumbers(['2', 'Garden'], 4)).toEqual(['1', '3', '4']);
    expect(missingTableNumbers([], 0)).toEqual([]);
    expect(missingTableNumbers([], 500)).toHaveLength(200);
  });
});
