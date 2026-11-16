import { describe, expect, it } from 'vitest';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import {
  fallbackWordKeys,
  HOOK_STYLES,
  hookStyleFor,
  isRepeatLine,
  mealMoment,
  type MealMoment,
} from './video-words';

const lookup = (messages: unknown, key: string): unknown =>
  `social.${key}`
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);

describe('video hook styles', () => {
  it('draws many different styles across a restaurant’s videos', () => {
    const seen = new Set(
      Array.from({ length: 60 }, (_, i) => hookStyleFor(i * 7919, 'fun', { hasMoment: true })),
    );
    expect(seen.size).toBe(HOOK_STYLES.length);
  });

  it('keeps dares and POV lines away from premium restaurants, POV for fun ones only', () => {
    for (let i = 0; i < 200; i++) {
      expect(['dare', 'pov']).not.toContain(hookStyleFor(i, 'premium', { hasMoment: true }));
      expect(hookStyleFor(i, 'friendly', { hasMoment: true })).not.toBe('pov');
    }
  });

  it('asks for a meal moment only when the posting time is known', () => {
    for (let i = 0; i < 200; i++)
      expect(hookStyleFor(i, 'fun', { hasMoment: false })).not.toBe('moment');
  });

  it('avoids the styles it is told to, unless nothing else is left', () => {
    for (let i = 0; i < 50; i++)
      expect(hookStyleFor(i, 'fun', { hasMoment: true, avoid: ['craving'] })).not.toBe('craving');
    expect(HOOK_STYLES).toContain(hookStyleFor(3, 'fun', { hasMoment: true, avoid: HOOK_STYLES }));
  });

  it('names the meal by the local posting hour', () => {
    expect([7, 12, 17, 21, 2].map(mealMoment)).toEqual([
      'breakfast',
      'lunch',
      'snack',
      'dinner',
      'late',
    ]);
  });

  it('has a fixed line for every style, moment, tagline and question, in Bangla and English', () => {
    const moments: (MealMoment | null)[] = ['breakfast', 'lunch', 'snack', 'dinner', 'late', null];
    for (const style of HOOK_STYLES)
      for (const m of moments)
        for (let seed = 0; seed < 16; seed++) {
          const k = fallbackWordKeys(style, m, seed);
          for (const messages of [en, bn])
            for (const key of [k.hook, k.tagline, k.question])
              expect(typeof lookup(messages, key), key).toBe('string');
        }
  });

  it('turns taglines and questions by the seed', () => {
    const taglines = new Set(
      Array.from({ length: 16 }, (_, s) => fallbackWordKeys('mood', null, s).tagline),
    );
    const questions = new Set(
      Array.from({ length: 16 }, (_, s) => fallbackWordKeys('mood', null, s).question),
    );
    expect(taglines.size).toBe(4);
    expect(questions.size).toBe(4);
  });

  it('spots a hook used before, whatever its case, spaces or marks', () => {
    expect(isRepeatLine('Still thinking about LUNCH', ['still thinking about lunch?'])).toBe(true);
    expect(isRepeatLine('আজ দুপুরে কী খাবেন?', ['আজ দুপুরে কী খাবেন'])).toBe(true);
    expect(isRepeatLine('Craving something smoky?', ['Still thinking about lunch?'])).toBe(false);
    expect(isRepeatLine('', [''])).toBe(false);
  });
});
