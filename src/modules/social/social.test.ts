import { describe, expect, it } from 'vitest';
import { captionFor } from './jobs/autopilot';
import { makeState, readState } from './meta';
import {
  angleForDay,
  designForDay,
  formatForDay,
  isPostingDay,
  pickDish,
  slotAt,
} from './schedule';
import {
  escapeHtml,
  headlineSize,
  inkOn,
  posterHtml,
  reelHtml,
  type PostContent,
} from './templates';
import { asciiDigits, inventedNumber, type SocialWords } from './writer';
import { describeColour } from './image-ai';

describe('social autopilot schedule (ADR 0040)', () => {
  it('turns a Dhaka post time into the right UTC instant', () => {
    // Dhaka is UTC+6 all year.
    expect(slotAt('2026-10-26', '13:00').toISOString()).toBe('2026-10-26T07:00:00.000Z');
    expect(slotAt('2026-10-26', '00:30:00').toISOString()).toBe('2026-10-25T18:30:00.000Z');
    expect(() => slotAt('2026-10-26', '1pm')).toThrow();
  });

  it('posts only on the chosen weekdays', () => {
    // 2026-10-30 is a Friday (5).
    expect(isPostingDay('2026-10-30', [5, 6])).toBe(true);
    expect(isPostingDay('2026-10-30', [0, 1, 2, 3, 4])).toBe(false);
  });

  it("'mix' alternates poster and reel day by day; fixed formats never change", () => {
    const a = formatForDay('mix', '2026-10-26');
    const b = formatForDay('mix', '2026-10-27');
    expect(new Set([a, b])).toEqual(new Set(['image', 'video']));
    expect(formatForDay('image', '2026-10-27')).toBe('image');
    expect(formatForDay('video', '2026-10-26')).toBe('video');
  });

  it('rotates the story and falls back to a spotlight when the data is missing', () => {
    const days = ['2026-10-26', '2026-10-27', '2026-10-28'];
    const full = days.map((d) => angleForDay(d, { star: true, quietTime: true }));
    expect(new Set(full)).toEqual(new Set(['star', 'quiet_time', 'spotlight']));
    for (const d of days)
      expect(angleForDay(d, { star: false, quietTime: false })).toBe('spotlight');
  });

  it('shows the dish posted longest ago, never-posted first, and not the same dish twice in a row', () => {
    const dishes = [
      { id: 'a', name: 'Kacchi', lastPostedAt: '2026-10-20T07:00:00Z' },
      { id: 'b', name: 'Borhani', lastPostedAt: '2026-10-10T07:00:00Z' },
      { id: 'c', name: 'Firni', lastPostedAt: null },
    ];
    expect(pickDish(dishes)?.id).toBe('c');
    expect(pickDish(dishes, 'c')?.id).toBe('b');
    expect(pickDish([dishes[0]!], 'a')?.id).toBe('a'); // only one dish: still post it
    expect(pickDish([])).toBeNull();
  });

  it('rotates poster designs', () => {
    const seen = new Set(
      ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'].map((d) => designForDay(d)),
    );
    expect(seen.size).toBe(4);
  });
});

describe('social post words', () => {
  const words: SocialWords = {
    hook_en: 'Hungry?',
    hook_bn: 'খিদে পেয়েছে?',
    headline_en: 'Taste The Legend',
    headline_bn: 'আসল স্বাদ',
    tagline_en: 'Slow cooked',
    tagline_bn: 'ধীরে রান্না',
    caption_bn: 'আজই আসুন',
    caption_en: 'Come today',
  };

  it('reads Bangla digits as numbers', () => {
    expect(asciiDigits('১০% ছাড়')).toBe('10% ছাড়');
  });

  it('allows only numbers that are in the fact or the owner note (CLAUDE.md #1)', () => {
    expect(inventedNumber(words, 'A spotlight on Kacchi.')).toBeNull();
    expect(inventedNumber({ ...words, caption_en: 'Only 250 taka!' }, 'Kacchi')).toBe('250');
    expect(
      inventedNumber({ ...words, caption_bn: '২০% ছাড়' }, 'Owner note: 20% off on Friday'),
    ).toBeNull();
    expect(inventedNumber({ ...words, caption_bn: '৩০% ছাড়' }, 'Owner note: 20% off')).toBe('30');
  });

  it('builds the caption in the chosen language', () => {
    expect(captionFor('bn', 'বাংলা', 'English')).toBe('বাংলা');
    expect(captionFor('en', 'বাংলা', 'English')).toBe('English');
    expect(captionFor('both', 'বাংলা', 'English')).toBe('বাংলা\n\nEnglish');
    expect(captionFor('en', 'বাংলা', null)).toBe('বাংলা');
  });
});

describe('poster and reel templates', () => {
  const content: PostContent = {
    design: 'band',
    hook: 'Hungry?',
    headline: '<script>alert(1)</script>',
    tagline: 'ধীরে রান্না',
    cta: 'আজই আসুন',
    badge: 'Best seller',
    restaurant: 'Kacchi & Co',
    area: 'Dhanmondi',
    phone: '01700000000',
    colorMain: '#C8102E',
    colorAccent: '#FFC72C',
    imageUrl: 'data:image/jpeg;base64,AAAA',
    logoUrl: null,
  };

  it('escapes every piece of text it is given', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    for (const design of ['band', 'centre', 'frame', 'split'] as const) {
      const html = posterHtml({ ...content, design });
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('Kacchi &amp; Co');
      expect(html).toContain('ধীরে রান্না');
    }
    expect(reelHtml(content)).not.toContain('<script>alert');
  });

  it('picks readable ink for the background colour', () => {
    expect(inkOn('#FFFFFF')).toBe('rgb(22 22 30)');
    expect(inkOn('#FFC72C')).toBe('rgb(22 22 30)');
    expect(inkOn('#C8102E')).toBe('rgb(255 255 255)');
    expect(inkOn('#0D1120')).toBe('rgb(255 255 255)');
  });

  it('shrinks long headlines', () => {
    expect(headlineSize('Kacchi', 100)).toBe(100);
    expect(headlineSize('A much longer headline here', 100)).toBeLessThan(70);
  });

  it('names the brand colour in words for the image model', () => {
    expect(describeColour('#C8102E')).toContain('red');
    expect(describeColour('#FFC72C')).toContain('yellow');
    expect(describeColour('#FFFFFF')).toBe('white');
  });
});

describe('Facebook connect state', () => {
  it('round-trips, expires after 30 minutes and rejects tampering', () => {
    process.env.META_APP_SECRET = 'test-secret-test-secret';
    const t0 = Date.parse('2026-10-26T07:00:00Z');
    const state = makeState('org-1', 'user-1', t0);
    expect(readState(state, t0 + 60_000)).toEqual({ orgId: 'org-1', userId: 'user-1' });
    expect(readState(state, t0 + 31 * 60_000)).toBeNull();
    expect(readState(state.replace('org-1', 'org-2'), t0 + 60_000)).toBeNull();
    expect(readState('garbage', t0)).toBeNull();
  });
});
