import { describe, expect, it } from 'vitest';
import { looksLikeSpotText, photonUrl, placesFromPhoton, spellingVariants } from './photon';

describe('photonUrl', () => {
  it('asks only inside Bangladesh and trims the text', () => {
    const url = new URL(photonUrl('  gulshan 2 '));
    expect(url.origin).toBe('https://photon.komoot.io');
    expect(url.searchParams.get('q')).toBe('gulshan 2');
    expect(url.searchParams.get('bbox')).toBe('88.0,20.5,92.7,26.7');
  });
});

describe('placesFromPhoton', () => {
  it('builds a readable name, flips lon/lat, rounds and drops repeats', () => {
    const feature = {
      geometry: { coordinates: [90.413712, 23.794712] },
      properties: {
        name: 'Gulshan 2',
        district: 'Gulshan',
        city: 'Dhaka',
        state: 'Dhaka Division',
      },
    };
    const places = placesFromPhoton({ features: [feature, feature] });
    expect(places).toEqual([{ name: 'Gulshan 2, Gulshan, Dhaka', lat: 23.79471, lon: 90.41371 }]);
  });

  it('does not repeat a word the name already has, and skips rows with no spot or no name', () => {
    const places = placesFromPhoton({
      features: [
        { geometry: { coordinates: [90.4, 23.8] }, properties: { name: 'Dhaka', city: 'Dhaka' } },
        { properties: { name: 'No spot' } },
        { geometry: { coordinates: [90.4, 23.8] }, properties: {} },
      ],
    });
    expect(places.map((p) => p.name)).toEqual(['Dhaka']);
  });

  it('copes with nothing', () => {
    expect(placesFromPhoton(null)).toEqual([]);
    expect(placesFromPhoton({})).toEqual([]);
  });
});

describe('spellingVariants', () => {
  it('turns ghulshan into gulshan and never returns the original', () => {
    expect(spellingVariants('ghulshan 2')).toContain('gulshan 2');
    expect(spellingVariants('Gulshan 2')).not.toContain('Gulshan 2');
  });
});

describe('looksLikeSpotText', () => {
  it('is true for links and numbers only', () => {
    expect(looksLikeSpotText('https://maps.app.goo.gl/abc')).toBe(true);
    expect(looksLikeSpotText('23.8759, 90.3795')).toBe(true);
    expect(looksLikeSpotText('gulshan 2')).toBe(false);
    expect(looksLikeSpotText('Sector 7')).toBe(false);
  });
});
