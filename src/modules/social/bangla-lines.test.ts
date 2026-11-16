import { describe, expect, it } from 'vitest';
import { allBanglaHooks, banglaCaption, type BanglaContext, banglaWords } from './bangla-lines';
import { HOOK_STYLES, type MealMoment, OCCASIONS } from './video-words';

const MOMENTS: MealMoment[] = ['breakfast', 'lunch', 'snack', 'dinner', 'late'];

const base: BanglaContext = {
  style: 'craving',
  moment: null,
  tone: 'friendly',
  dishes: 1,
  occasion: null,
  fact: null,
  dishName: null,
};

describe('hand-written Bangla video lines', () => {
  it('has at least 200 different hooks', () => {
    expect(allBanglaHooks().length).toBeGreaterThanOrEqual(200);
  });

  it('has a fitting line for every video, with no gaps, placeholders or digits', () => {
    const bad: string[] = [];
    for (const style of HOOK_STYLES)
      for (const moment of style === 'moment' ? MOMENTS : [null])
        for (const tone of ['friendly', 'premium', 'fun'] as const)
          for (const dishes of [1, 2, 3])
            for (const occasion of [null, ...OCCASIONS])
              for (const dishName of [null, 'কাচ্চি বিরিয়ানি'])
                for (const seed of [0, 7, 99]) {
                  const w = banglaWords(
                    { style, tone, dishes, occasion, moment, fact: null, dishName },
                    seed,
                  );
                  for (const line of [w.hook, w.tagline, w.punch, w.question])
                    if (line.length <= 3 || /[{}0-9০-৯]/.test(line))
                      bad.push(`${style}/${tone}/${dishes}/${occasion}: "${line}"`);
                }
    expect(bad).toEqual([]);
  });

  it('names the dish only when it has a Bangla name', () => {
    const named = new Set(
      Array.from({ length: 400 }, (_, s) => banglaWords({ ...base, dishName: 'ফালুদা' }, s).hook),
    );
    expect([...named].some((h) => h.includes('ফালুদা'))).toBe(true);
    for (let s = 0; s < 400; s++) expect(banglaWords(base, s).hook).not.toContain('{dish}');
  });

  it('says "everyone orders this" only when the sales show a best seller', () => {
    const claims = (fact: BanglaContext['fact']) =>
      new Set(
        Array.from(
          { length: 400 },
          (_, s) => banglaWords({ ...base, style: 'claim', fact }, s).hook,
        ),
      );
    expect(claims(null).has('সবাই এটাই অর্ডার করে')).toBe(false);
    expect(claims('best').has('সবাই এটাই অর্ডার করে')).toBe(true);
  });

  it('keeps one-dish lines off multi-dish videos and dares off premium restaurants', () => {
    for (let s = 0; s < 300; s++) {
      expect(banglaWords({ ...base, dishes: 3 }, s).hook).not.toMatch(/খেতে মন চাইছে\?$/u);
      expect(banglaWords({ ...base, style: 'claim', tone: 'premium' }, s).tagline).not.toBe(
        'খাও-দাও-ফুর্তি করো!',
      );
    }
  });

  it('greets the special day on most of its videos', () => {
    const eid = Array.from(
      { length: 90 },
      (_, s) => banglaWords({ ...base, occasion: 'eid_fitr' }, s).hook,
    ).filter((h) => h.includes('ঈদ')).length;
    expect(eid).toBeGreaterThan(40);
  });

  it('skips the lines the restaurant used lately', () => {
    const first = banglaWords({ ...base, style: 'dare' }, 5);
    for (let s = 0; s < 50; s++)
      expect(banglaWords({ ...base, style: 'dare' }, s, [first.hook]).hook).not.toBe(first.hook);
  });

  it('writes a caption with the restaurant, the dishes, the greeting and tags', () => {
    const plain = banglaCaption(
      { ...base, restaurant: 'কাচ্চি ঘর', dishNames: 'কাচ্চি, বোরহানি', greeting: null },
      3,
    );
    expect(plain).toContain('কাচ্চি ঘর');
    expect(plain).toContain('কাচ্চি, বোরহানি');
    expect(plain).toMatch(/#কাচ্চিঘর #\S+ #\S+$/u);
    expect(plain).not.toMatch(/[{}]/);
    const eid = banglaCaption(
      { ...base, restaurant: 'Kacchi Ghor', dishNames: 'কাচ্চি', greeting: 'ঈদ মোবারক' },
      3,
    );
    expect(eid.startsWith('ঈদ মোবারক!')).toBe(true);
    expect(eid).toContain('#KacchiGhor');
  });
});
