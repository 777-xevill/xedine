import { describe, expect, it } from 'vitest';
import { isMapsLink, parseSpot } from './geocode';

describe('parseSpot', () => {
  it('reads plain numbers', () => {
    expect(parseSpot('23.8759, 90.3795')).toEqual({ lat: 23.8759, lon: 90.3795 });
    expect(parseSpot(' 23.8759 90.3795 ')).toEqual({ lat: 23.8759, lon: 90.3795 });
    expect(parseSpot('-33.86,151.21')).toEqual({ lat: -33.86, lon: 151.21 });
  });

  it('refuses numbers that are not a place on Earth', () => {
    expect(parseSpot('123.5, 90.3')).toBeNull();
    expect(parseSpot('23.8, 190.3')).toBeNull();
  });

  it('reads a Google Maps link: the place pin wins over the map centre', () => {
    const url =
      'https://www.google.com/maps/place/Uttara/@23.8700,90.4000,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d23.8759!4d90.3795';
    expect(parseSpot(url)).toEqual({ lat: 23.8759, lon: 90.3795 });
  });

  it('reads @lat,lng and q= links', () => {
    expect(parseSpot('https://www.google.com/maps/@23.8759,90.3795,17z')).toEqual({
      lat: 23.8759,
      lon: 90.3795,
    });
    expect(parseSpot('https://maps.google.com/?q=23.8759%2C90.3795')).toEqual({
      lat: 23.8759,
      lon: 90.3795,
    });
  });

  it('gives null for a name, a short link (needs opening) or a link from another site', () => {
    expect(parseSpot('Uttara Sector 7, Dhaka')).toBeNull();
    expect(parseSpot('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
    expect(parseSpot('https://evil.example/maps/@23.8759,90.3795')).toBeNull();
  });
});

describe('isMapsLink', () => {
  it('accepts only https Google Maps hosts', () => {
    expect(isMapsLink('https://maps.app.goo.gl/AbCdEf123')).toBe(true);
    expect(isMapsLink('https://www.google.com/maps/place/x')).toBe(true);
    expect(isMapsLink('http://www.google.com/maps')).toBe(false);
    expect(isMapsLink('https://google.com.evil.example/maps')).toBe(false);
    expect(isMapsLink('Uttara')).toBe(false);
  });
});
