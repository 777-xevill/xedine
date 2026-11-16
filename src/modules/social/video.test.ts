import { describe, expect, it } from 'vitest';
import { logoColors } from './logo-colors';
import {
  kindForDishes,
  occasionForDay,
  partnersFor,
  videoKindFor,
  videoTimes,
  voiceFor,
} from './schedule';
import { videoPlan, type VideoContent } from './video';
import { kindsFor, resolveVideoLook, VIDEO_KINDS, VideoLookSchema } from './video-look';
import { occasionOfCalendarKey, OCCASION_THEME, OCCASIONS, videoWordsFor } from './video-words';

const DISH = {
  name: 'Kacchi',
  cutUrl: null,
  photoUrl: 'https://example.com/kacchi.jpg',
  price: '৳350',
  was: null,
  note: null,
};

function content(
  kind: (typeof VIDEO_KINDS)[number],
  extra: Partial<VideoContent> = {},
): VideoContent {
  const n =
    kind === 'showcase' || kind === 'offer' ? 1 : kind === 'versus' || kind === 'combo' ? 2 : 3;
  return {
    look: resolveVideoLook(
      42,
      { tone: 'friendly', dishes: n, offer: kind === 'offer', hot: true },
      kind,
    ),
    words: {
      hook: 'Hungry?',
      punch: "It's two!",
      question: 'Which one?',
      tagline: 'Fresh today',
      cta: 'Order now',
    },
    labels: { or: 'OR', onlyAt: 'Only at', now: 'Now' },
    restaurant: 'Kacchi Ghor',
    area: 'Dhanmondi',
    phone: '01712-345678',
    colorMain: '#0F5C4A',
    colorAccent: '#F2B33D',
    logoUrl: null,
    dishes: Array.from({ length: n }, (_, i) => ({
      ...DISH,
      name: `Dish ${i + 1}`,
      was: kind === 'offer' ? '৳450' : null,
    })),
    ...extra,
  };
}

describe('video looks (ADR 0061)', () => {
  it('only offers kinds that fit the dishes; an offer only with a real offer', () => {
    expect(kindsFor({ tone: 'fun', dishes: 1, offer: false, hot: true })).toEqual(['showcase']);
    expect(kindsFor({ tone: 'fun', dishes: 1, offer: true, hot: true })).toEqual([
      'showcase',
      'offer',
    ]);
    expect(kindsFor({ tone: 'fun', dishes: 2, offer: false, hot: true })).toEqual([
      'versus',
      'combo',
      'search',
    ]);
    expect(kindsFor({ tone: 'fun', dishes: 3, offer: false, hot: true })).toEqual([
      'carousel',
      'ring',
      'search',
    ]);
  });

  it('is the same for the same seed, varied across seeds, and always valid', () => {
    const ctx = { tone: 'premium' as const, dishes: 2, offer: false, hot: true };
    expect(resolveVideoLook(7, ctx)).toEqual(resolveVideoLook(7, ctx));
    const looks = Array.from({ length: 40 }, (_, i) => resolveVideoLook(i, ctx));
    for (const l of looks) expect(VideoLookSchema.safeParse(l).success).toBe(true);
    expect(new Set(looks.map((l) => `${l.stage}|${l.cut}|${l.hook}`)).size).toBeGreaterThan(10);
    // A spotlight is always a dark room.
    for (const l of looks) if (l.stage === 'spotlight') expect(l.scheme).toBe('night');
  });
});

describe('the video page', () => {
  it('builds every kind with its words, sounds in order inside the video, and its own length', () => {
    for (const kind of VIDEO_KINDS) {
      const plan = videoPlan(content(kind));
      expect(plan.seconds).toBe(11);
      expect(plan.html).toContain('Kacchi Ghor');
      expect(plan.html).toContain('Order now');
      expect(plan.hits.length).toBeGreaterThan(0);
      expect(
        plan.hits.every((h, i) => h.t >= 0 && h.t < 11 && (i === 0 || plan.hits[i - 1]!.t <= h.t)),
      ).toBe(true);
      // Every cut has its whoosh.
      expect(plan.hits.some((h) => h.sound === 'whoosh')).toBe(true);
    }
  });

  it('a spoken hook makes the video 12 s; lengths stay within 10–12 s', () => {
    expect(videoPlan(content('showcase', { seconds: 12, hookSeconds: 3.6 })).seconds).toBe(12);
    expect(videoPlan(content('showcase', { seconds: 30 })).seconds).toBe(12);
    expect(videoPlan(content('showcase', { seconds: 3 })).seconds).toBe(10);
  });

  it('greets a special day with fixed words, and escapes whatever text it is given', () => {
    const html = videoPlan(
      content('versus', {
        occasion: { greeting: 'Eid Mubarak', theme: 'islamic' },
        words: { hook: '<script>x</script>', punch: '', question: 'Q', tagline: 'T', cta: 'Go' },
      }),
    ).html;
    expect(/Mubarak|MUBARAK/.test(html)).toBe(true);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows the old price only on an offer video, and plays by itself only in the preview', () => {
    expect(videoPlan(content('offer')).html).toContain('৳450');
    expect(videoPlan(content('showcase')).html).not.toContain('৳450');
    expect(videoPlan(content('showcase')).html).not.toContain('setInterval');
    expect(videoPlan(content('showcase', { preview: true })).html).toContain('setInterval');
  });
});

describe('when and what the autopilot videos are', () => {
  it('spreads the day’s videos over good times, away from the daily post', () => {
    expect(videoTimes('13:00', 3)).toEqual(['19:30', '16:00', '21:00']);
    expect(videoTimes('09:00', 2)).toEqual(['12:30', '19:30']);
    expect(videoTimes('13:00', 0)).toEqual([]);
  });

  it('takes turns over the kinds and falls back when fewer dishes can be used', () => {
    const kinds = new Set(Array.from({ length: 12 }, (_, i) => videoKindFor('2026-11-16', i)));
    expect(kinds.size).toBe(6);
    expect(kindForDishes('carousel', 3)).toBe('carousel');
    expect(kindForDishes('carousel', 2)).toBe('versus');
    expect(kindForDishes('combo', 1)).toBe('showcase');
  });

  it('speaks on every other video with "half"', () => {
    expect(voiceFor('all', '2026-11-16', 1)).toBe(true);
    expect(voiceFor('none', '2026-11-16', 1)).toBe(false);
    expect(voiceFor('half', '2026-11-16', 1)).not.toBe(voiceFor('half', '2026-11-16', 2));
  });

  it('greets a festival first, Jummah on Fridays, nothing with greetings off', () => {
    expect(occasionForDay('2026-11-20', true, null)).toBe('jummah'); // a Friday
    expect(occasionForDay('2026-11-19', true, null)).toBeNull();
    expect(occasionForDay('2026-11-20', true, 'eid_fitr')).toBe('eid_fitr');
    expect(occasionForDay('2026-11-20', false, 'eid_fitr')).toBeNull();
    expect(occasionOfCalendarKey('eidulfitr-2027')).toBe('eid_fitr');
    expect(occasionOfCalendarKey('ekushey-2027')).toBeNull();
    expect(occasionOfCalendarKey('ashura-2027')).toBeNull();
    for (const o of OCCASIONS) expect(OCCASION_THEME[o]).toBeTruthy();
  });

  it('pairs a dish with what customers order with it, then best sellers', () => {
    const pool = [
      { id: 'k', name: 'Kacchi', sold: 90, lastPostedAt: null },
      { id: 'b', name: 'Borhani', sold: 10, lastPostedAt: null },
      { id: 'f', name: 'Firni', sold: 40, lastPostedAt: null },
      { id: 'n', name: 'Naan', sold: 70, lastPostedAt: null },
    ];
    const pairs = [
      { item_a: 'b', item_b: 'k', orders: 30 },
      { item_a: 'f', item_b: 'k', orders: 5 },
      { item_a: 'k', item_b: 'x', orders: 99 }, // not allowed
    ];
    expect(partnersFor('k', pairs, pool, 2)).toEqual(['b', 'f']);
    expect(partnersFor('k', pairs, pool, 3)).toEqual(['b', 'f', 'n']);
    expect(partnersFor('n', [], pool, 1)).toEqual(['k']);
  });
});

describe('video words', () => {
  it('takes the owner’s line, else the AI’s, else the fixed default', () => {
    const defaults = { hook: 'H', punch: 'P', question: 'Q', tagline: 'T' };
    const ai = { hook_en: 'AI hook', hook_bn: 'এআই', tagline_en: '', tagline_bn: '' };
    const w = videoWordsFor('en', ai, { hook: '', tagline: 'Mine' }, defaults, 'Go');
    expect(w).toEqual({ hook: 'AI hook', punch: 'P', question: 'Q', tagline: 'Mine', cta: 'Go' });
    expect(videoWordsFor('bn', ai, null, defaults, 'Go').hook).toBe('এআই');
  });
});

describe('logo colours', () => {
  const px = (rgb: [number, number, number], n: number, a = 255) =>
    Array.from({ length: n }, () => [...rgb, a]).flat();

  it('finds the main colour and a different accent, ignoring white, black, grey and see-through', () => {
    const data = [
      ...px([255, 255, 255], 500),
      ...px([0, 0, 0], 300),
      ...px([128, 128, 128], 200),
      ...px([200, 30, 40], 120, 0),
      ...px([20, 120, 70], 300),
      ...px([240, 180, 40], 100),
    ];
    const c = logoColors(data)!;
    expect(c.main).toMatch(/^#1[0-9A-F]7[0-9A-F]4[0-9A-F]$/);
    expect(c.accent).toMatch(/^#F[0-9A-F]B[0-9A-F]2[0-9A-F]$/);
  });

  it('a black-and-white logo keeps the colours already set', () => {
    expect(logoColors([...px([255, 255, 255], 100), ...px([0, 0, 0], 100)])).toBeNull();
  });
});
