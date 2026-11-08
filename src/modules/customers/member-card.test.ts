import { describe, expect, it } from 'vitest';
import { memberCardUrl, parseMemberToken, parseTakaInRange, parseWhole } from './member-card';

const TOKEN = 'Ab3_dE-fGhIjKlMnOpQrStUv';

describe('member card helpers', () => {
  it('reads a token from the scanned link or the bare token', () => {
    expect(parseMemberToken(`https://xedine.org/m/${TOKEN}`)).toBe(TOKEN);
    expect(parseMemberToken(`  https://preview.example.app/m/${TOKEN}?x=1 `)).toBe(TOKEN);
    expect(parseMemberToken(TOKEN)).toBe(TOKEN);
    expect(parseMemberToken('https://xedine.org/m/short')).toBeNull();
    expect(parseMemberToken(`https://xedine.org/m/${TOKEN}extra`)).toBeNull();
    expect(parseMemberToken('hello')).toBeNull();
  });

  it('builds the card link without a double slash', () => {
    expect(memberCardUrl('https://xedine.org/', TOKEN)).toBe(`https://xedine.org/m/${TOKEN}`);
  });

  it('reads taka the owner typed, with Bangla digits and commas, within range', () => {
    expect(parseTakaInRange('100', 100, 10_000_000)).toBe(10_000);
    expect(parseTakaInRange('৳ ১,০০০', 100, 10_000_000)).toBe(100_000);
    expect(parseTakaInRange('0.5', 1, 100_000)).toBe(50);
    expect(parseTakaInRange('0', 1, 100_000)).toBeNull();
    expect(parseTakaInRange('abc', 1, 100_000)).toBeNull();
    expect(parseTakaInRange('2000', 1, 100_000)).toBeNull();
  });

  it('reads whole numbers in range', () => {
    expect(parseWhole('৫০', 1, 100)).toBe(50);
    expect(parseWhole('-20', -100, 100)).toBe(-20);
    expect(parseWhole('2.5', 1, 100)).toBeNull();
    expect(parseWhole('0', 1, 100)).toBeNull();
  });
});
