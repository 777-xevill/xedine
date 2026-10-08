import { describe, expect, it } from 'vitest';
import { daySeries, hour12, hourPeriod, hourSeries, peakKey } from './series';

describe('hourSeries', () => {
  it('orders hours by business day and fills the quiet hours with zero', () => {
    const rows = [
      { key: '01', net_poisha: 500 },
      { key: '12', net_poisha: 900 },
      { key: '14', net_poisha: 300 },
    ];
    const s = hourSeries(rows, 240);
    expect(s.map((p) => p.hour)).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1]);
    expect(s.find((p) => p.hour === 13)?.net_poisha).toBe(0);
    expect(s.at(-1)).toEqual({ hour: 1, net_poisha: 500 });
  });

  it('returns nothing when nothing sold and ignores bad keys', () => {
    expect(hourSeries([], 240)).toEqual([]);
    expect(hourSeries([{ key: 'x', net_poisha: 1 }], 240)).toEqual([]);
  });
});

describe('daySeries', () => {
  it('lists every date inclusive, across a month end', () => {
    expect(daySeries('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
  });

  it('keeps the newest days when capped and handles one day', () => {
    expect(daySeries('2026-10-01', '2026-10-05', 2)).toEqual(['2026-10-04', '2026-10-05']);
    expect(daySeries('2026-10-08', '2026-10-08')).toEqual(['2026-10-08']);
  });
});

describe('clock labels', () => {
  it('maps hours to a part of the day and a 12-hour number', () => {
    expect([0, 5, 9, 13, 16, 19, 22].map(hourPeriod)).toEqual([
      'night',
      'dawn',
      'morning',
      'noon',
      'afternoon',
      'evening',
      'late',
    ]);
    expect([0, 12, 13, 23].map(hour12)).toEqual([12, 12, 1, 11]);
  });
});

describe('peakKey', () => {
  it('picks the largest positive value, or none', () => {
    const items = [
      { k: 'a', v: 2 },
      { k: 'b', v: 7 },
      { k: 'c', v: 7 },
    ];
    expect(
      peakKey(
        items,
        (i) => i.v,
        (i) => i.k,
      ),
    ).toBe('b');
    expect(
      peakKey(
        [{ k: 'a', v: 0 }],
        (i) => i.v,
        (i) => i.k,
      ),
    ).toBeNull();
  });
});
