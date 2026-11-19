import { describe, expect, it } from 'vitest';
import { guessSizeShare, isSizeShare, sizeShareKey } from './size-share';

describe('size share', () => {
  it.each([
    ['Half', 5000],
    ['half plate', 5000],
    ['Kacchi (Half)', 5000],
    ['হাফ', 5000],
    ['অর্ধেক প্লেট', 5000],
    ['Quarter', 2500],
    ['কোয়ার্টার', 2500],
    ['Full', 10000],
    ['Large', 10000],
    ['Family', 10000],
    ['Behalf', 10000],
  ])('%s → %i', (name, bps) => {
    expect(guessSizeShare(name)).toBe(bps);
  });

  it('names the shares on the list only', () => {
    expect(sizeShareKey(5000)).toBe('half');
    expect(sizeShareKey(10000)).toBe('same');
    expect(sizeShareKey(12345)).toBeNull();
    expect(isSizeShare(20000)).toBe(true);
    expect(isSizeShare(4000)).toBe(false);
  });
});
