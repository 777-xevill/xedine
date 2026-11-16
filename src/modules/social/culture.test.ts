import { describe, expect, it } from 'vitest';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import {
  COUNTRIES,
  COUNTRY_CODES,
  countryName,
  countryOf,
  easterOf,
  isCountry,
  isTimeZone,
  MOVING_DATES_UNTIL,
  nthWeekday,
  occasionLook,
  occasionOnDate,
  occasionsFor,
  pricesSupported,
  timezoneOf,
  timezonesOf,
} from './culture';
import { slotAt } from './schedule';
import { OCCASIONS } from './video-words';

describe('culture by country', () => {
  it('computes Easter, Thanksgiving and Mother’s Day the way calendars print them', () => {
    expect(easterOf(2027)).toBe('2027-03-28');
    expect(easterOf(2028)).toBe('2028-04-16');
    expect(nthWeekday(2026, 11, 4, 4)).toBe('2026-11-26'); // 4th Thursday of November
    expect(nthWeekday(2026, 10, 1, 2)).toBe('2026-10-12'); // 2nd Monday of October
    expect(nthWeekday(2027, 5, 0, -1)).toBe('2027-05-30'); // last Sunday of May
  });

  it('greets a country’s own days and not other countries’', () => {
    expect(occasionOnDate('US', '2026-11-26')).toBe('thanksgiving');
    expect(occasionOnDate('CA', '2026-11-26')).toBeNull();
    expect(occasionOnDate('CA', '2026-10-12')).toBe('thanksgiving');
    expect(occasionOnDate('US', '2026-07-04')).toBe('national_day');
    expect(occasionOnDate('GB', '2026-07-04')).toBeNull();
    expect(occasionOnDate('IN', '2026-11-08')).toBe('diwali');
    expect(occasionOnDate('SG', '2027-02-06')).toBe('lunar_new_year');
    expect(occasionOnDate('FR', '2026-07-14')).toBe('national_day');
    expect(occasionOnDate('GB', '2027-03-07')).toBe('mothers_day'); // Mothering Sunday
    expect(occasionOnDate('US', '2027-05-09')).toBe('mothers_day');
    expect(occasionOnDate('SA', '2027-05-09')).toBeNull();
    expect(occasionOnDate('US', '2026-12-25')).toBe('christmas');
    expect(occasionOnDate('SA', '2027-12-25')).toBeNull();
  });

  it('greets Friday only where Friday prayer is the week’s rhythm', () => {
    expect(occasionOnDate('PK', '2026-11-20')).toBe('jummah');
    expect(occasionOnDate('AE', '2026-11-20')).toBe('jummah');
    expect(occasionOnDate('US', '2026-11-20')).toBeNull();
    expect(occasionOnDate('IN', '2026-11-20')).toBeNull();
    expect(occasionOnDate('PK', '2026-11-19')).toBeNull();
  });

  it('greets Ramadan on its first day, iftar after, and Eid with a day either side', () => {
    expect(occasionOnDate('SA', '2027-02-08')).toBe('ramadan');
    expect(occasionOnDate('SA', '2027-02-20')).toBe('iftar');
    expect(occasionOnDate('SA', '2027-03-09')).toBe('eid_fitr'); // the day before the estimate
    expect(occasionOnDate('SA', '2027-03-10')).toBe('eid_fitr');
    expect(occasionOnDate('SA', '2027-03-11')).toBe('eid_fitr');
    expect(occasionOnDate('SA', '2027-03-13')).toBeNull();
    expect(occasionOnDate('US', '2027-02-20')).toBeNull();
  });

  it('keeps the moving dates covered for the next years (extend the tables when this fails)', () => {
    expect(MOVING_DATES_UNTIL).toBeGreaterThanOrEqual(new Date().getUTCFullYear() + 1);
  });

  it('lists the country’s own special days first and the rest after', () => {
    const us = occasionsFor('US', OCCASIONS);
    expect(us.own).toContain('thanksgiving');
    expect(us.own).not.toContain('jummah');
    expect(us.other).toContain('boishakh');
    expect(us.own.filter((o) => us.other.includes(o))).toEqual([]);
    expect(occasionsFor('SA', OCCASIONS).own).toContain('jummah');
    for (const code of COUNTRY_CODES) {
      const l = occasionsFor(code, OCCASIONS);
      expect([...l.own, ...l.other, 'custom'].sort()).toEqual([...OCCASIONS].sort());
    }
  });

  it('has valid time zones, flags and national days for every country', () => {
    for (const code of COUNTRY_CODES) {
      expect(isCountry(code)).toBe(true);
      for (const tz of timezonesOf(code)) expect(isTimeZone(tz), `${code} ${tz}`).toBe(true);
      const c = COUNTRIES[code] as {
        festivals: readonly string[];
        national?: { month: number; day: number };
        flag?: readonly unknown[];
      };
      if (c.festivals.includes('national_day')) {
        expect(c.national, code).toBeTruthy();
        expect(c.flag?.length, code).toBeGreaterThan(0);
        expect(c.national!.month).toBeGreaterThanOrEqual(1);
        expect(c.national!.day).toBeLessThanOrEqual(31);
      }
    }
    expect(isCountry('XX')).toBe(false);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });

  it('dresses a national day in the country’s own flag, not Bangladesh’s', () => {
    expect(occasionLook('national_day', 'US').palette).toEqual(COUNTRIES.US.flag);
    expect(occasionLook('national_day', 'FR').palette).toEqual(COUNTRIES.FR.flag);
    expect(occasionLook('victory_day', 'US').palette).toEqual(COUNTRIES.BD.flag);
    expect(occasionLook('lunar_new_year', 'CN').lanterns).toBe('red');
    expect(occasionLook('eid_fitr', 'SA').theme).toBe('islamic');
  });

  it('posts at the restaurant’s own local time, not Dhaka’s', () => {
    expect(slotAt('2026-11-26', '12:30').toISOString()).toBe('2026-11-26T06:30:00.000Z');
    expect(slotAt('2026-11-26', '12:30', 'America/New_York').toISOString()).toBe(
      '2026-11-26T17:30:00.000Z',
    );
    // Summer time in London: 19:30 BST is 18:30 UTC.
    expect(slotAt('2027-07-01', '19:30', 'Europe/London').toISOString()).toBe(
      '2027-07-01T18:30:00.000Z',
    );
  });

  it('falls back to Bangladesh and the country’s own clock when a saved value is missing or wrong', () => {
    expect(countryOf(null)).toBe('BD');
    expect(countryOf('ZZ')).toBe('BD');
    expect(countryOf('US')).toBe('US');
    expect(timezoneOf('US', 'Mars/Olympus')).toBe('America/New_York');
    expect(timezoneOf('US', 'America/Denver')).toBe('America/Denver');
    expect(timezoneOf(undefined, undefined)).toBe('Asia/Dhaka');
    expect(countryName('US')).toBe('United States');
  });

  it('shows prices only where the app has the currency', () => {
    expect(pricesSupported('BD')).toBe(true);
    expect(pricesSupported('US')).toBe(false);
  });

  it('has a greeting and a name in both languages for every special day', () => {
    const get = (m: unknown, group: string, k: string) =>
      (m as { social: { video: Record<string, Record<string, string>> } }).social.video[group]?.[k];
    for (const o of OCCASIONS) {
      for (const m of [en, bn]) {
        if (o !== 'custom') expect(get(m, 'occasions', o), `greeting ${o}`).toBeTruthy();
        expect(get(m, 'occasionNames', o), `name ${o}`).toBeTruthy();
      }
    }
  });
});
