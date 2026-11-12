import { describe, expect, it } from 'vitest';
import {
  BD_CALENDAR,
  branchCoords,
  calendarToAdd,
  dailyWeather,
  nextHours,
  parseMetno,
  RAIN_FLAG_MM,
  rainWindow,
  skyOf,
  type WeatherPoint,
} from './outlook';

const hour = (
  iso: string,
  rainMm: number,
  tempC = 28,
  symbol: string | null = null,
): WeatherPoint => ({
  at: iso,
  periodHours: 1,
  tempC,
  rainMm,
  symbol,
});

describe('parseMetno', () => {
  it('takes hourly readings from next_1_hours and six-hour blocks only where there is no hour', () => {
    const json = {
      properties: {
        timeseries: [
          {
            time: '2026-11-14T06:00:00Z',
            data: {
              instant: { details: { air_temperature: 27.34 } },
              next_1_hours: {
                summary: { symbol_code: 'rain' },
                details: { precipitation_amount: 2.3 },
              },
              next_6_hours: {
                summary: { symbol_code: 'rain' },
                details: { precipitation_amount: 9 },
              },
            },
          },
          {
            time: '2026-11-17T00:00:00Z',
            data: {
              instant: { details: { air_temperature: 21 } },
              next_6_hours: {
                summary: { symbol_code: 'cloudy' },
                details: { precipitation_amount: 0 },
              },
            },
          },
          { time: '2026-11-18T00:00:00Z', data: { instant: { details: {} } } },
          { time: 'not a time', data: {} },
        ],
      },
    };
    expect(parseMetno(json)).toEqual([
      { at: '2026-11-14T06:00:00.000Z', periodHours: 1, tempC: 27.3, rainMm: 2.3, symbol: 'rain' },
      { at: '2026-11-17T00:00:00.000Z', periodHours: 6, tempC: 21, rainMm: 0, symbol: 'cloudy' },
    ]);
  });

  it('returns nothing for a response it does not understand', () => {
    expect(parseMetno(null)).toEqual([]);
    expect(parseMetno({ properties: {} })).toEqual([]);
  });
});

describe('skyOf', () => {
  it('reduces symbol codes to five skies', () => {
    expect(skyOf('rainandthunder', 3)).toBe('storm');
    expect(skyOf('lightrainshowers_day', 0.2)).toBe('rain');
    expect(skyOf('fog', 0)).toBe('fog');
    expect(skyOf('cloudy', 0)).toBe('cloudy');
    expect(skyOf('partlycloudy_day', 0)).toBe('clear');
    expect(skyOf('clearsky_night', 0)).toBe('clear');
    expect(skyOf(null, 0)).toBe('clear');
  });
});

describe('dailyWeather', () => {
  // Business day 2026-11-14 in Dhaka (cutoff 04:00) runs 2026-11-13T22:00Z to 2026-11-14T22:00Z.
  it('sums rain per business day and flags a rainy day', () => {
    const days = dailyWeather(
      [
        hour('2026-11-13T21:00:00Z', 9, 24), // 03:00 Dhaka: still the 13th's business day
        hour('2026-11-14T06:00:00Z', 3, 30, 'rain'),
        hour('2026-11-14T07:00:00Z', 2.5, 31, 'rain'),
        hour('2026-11-15T06:00:00Z', 0, 37, 'clearsky_day'),
      ],
      '2026-11-13',
      '2026-11-16',
    );
    expect(days).toEqual([
      { date: '2026-11-13', rainMm: 9, maxC: 24, minC: 24, sky: 'rain', rainy: true, hot: false },
      { date: '2026-11-14', rainMm: 5.5, maxC: 31, minC: 30, sky: 'rain', rainy: true, hot: false },
      { date: '2026-11-15', rainMm: 0, maxC: 37, minC: 37, sky: 'clear', rainy: false, hot: true },
    ]);
    expect(RAIN_FLAG_MM).toBe(5);
  });

  it('does not call a day rainy for a passing drizzle', () => {
    const [d] = dailyWeather(
      [hour('2026-11-14T06:00:00Z', 0.3, 29, 'lightrain')],
      '2026-11-14',
      '2026-11-14',
    );
    expect(d).toMatchObject({ sky: 'cloudy', rainy: false });
  });
});

describe('rainWindow', () => {
  const pts = [
    hour('2026-11-14T08:00:00Z', 0),
    hour('2026-11-14T09:00:00Z', 1.2),
    hour('2026-11-14T10:00:00Z', 4),
    hour('2026-11-14T11:00:00Z', 0.2),
    hour('2026-11-14T12:00:00Z', 3),
  ];
  it('finds the first stretch of real rain in the next hours', () => {
    expect(rainWindow(pts, '2026-11-14T08:10:00Z')).toEqual({
      start: '2026-11-14T09:00:00.000Z',
      end: '2026-11-14T11:00:00.000Z',
      rainMm: 5.2,
    });
  });
  it('is null when no rain is coming within the window', () => {
    expect(rainWindow(pts, '2026-11-14T08:10:00Z', 0.5)).toBeNull();
    expect(rainWindow([hour('2026-11-14T08:00:00Z', 0.4)], '2026-11-14T08:00:00Z')).toBeNull();
  });
  it('ignores six-hour blocks', () => {
    expect(
      rainWindow([{ ...hour('2026-11-14T09:00:00Z', 20), periodHours: 6 }], '2026-11-14T08:00:00Z'),
    ).toBeNull();
  });
  it('nextHours keeps the current hour and the next ones in order', () => {
    expect(nextHours(pts, '2026-11-14T08:30:00Z', 3).map((p) => p.at)).toEqual([
      '2026-11-14T08:00:00Z',
      '2026-11-14T09:00:00Z',
      '2026-11-14T10:00:00Z',
      '2026-11-14T11:00:00Z',
    ]);
  });
});

describe('branchCoords', () => {
  it('prefers the owner-set location, then the area, then the city, then Dhaka', () => {
    expect(
      branchCoords({ latitude: 23.7, longitude: 90.4, area: 'Mirpur', city: 'Dhaka' }),
    ).toEqual({
      lat: 23.7,
      lon: 90.4,
      exact: true,
    });
    expect(
      branchCoords({ latitude: null, longitude: null, area: 'Uttara', city: 'Dhaka' }),
    ).toMatchObject({
      lat: 23.8759,
      exact: false,
    });
    expect(
      branchCoords({ latitude: null, longitude: null, area: 'Mirpur 10', city: 'Dhaka' }),
    ).toMatchObject({ lat: 23.8223 });
    expect(
      branchCoords({ latitude: null, longitude: null, area: 'Uttara Sector 7', city: 'Dhaka' }),
    ).toMatchObject({ lat: 23.8759 });
    expect(
      branchCoords({ latitude: null, longitude: null, area: 'Road 5, Old Dhaka', city: null }),
    ).toMatchObject({ lat: 23.7104 });
    expect(
      branchCoords({ latitude: null, longitude: null, area: "Cox's Bazar sea beach", city: null }),
    ).toMatchObject({ lat: 21.4272 });
    expect(
      branchCoords({ latitude: null, longitude: null, area: 'Nowhere', city: 'Sylhet' }),
    ).toMatchObject({
      lat: 24.8949,
    });
    expect(branchCoords({ latitude: null, longitude: null, area: null, city: null })).toMatchObject(
      {
        lat: 23.8103,
        lon: 90.4125,
      },
    );
  });
});

describe('Bangladesh calendar', () => {
  it('has unique keys and well-formed date ranges', () => {
    expect(new Set(BD_CALENDAR.map((e) => e.key)).size).toBe(BD_CALENDAR.length);
    for (const e of BD_CALENDAR) {
      expect(e.starts_on <= e.ends_on, e.key).toBe(true);
      expect(e.name_bn.trim(), e.key).not.toBe('');
    }
  });
  it('adds what is coming in the next months and nothing that is over', () => {
    const keys = calendarToAdd('2026-12-20', 40).map((e) => e.key);
    expect(keys).toContain('christmas-2026');
    expect(keys).toContain('shabebarat-2027');
    expect(keys).not.toContain('victory-2026');
    expect(keys).not.toContain('ramadan-2027');
  });
});
