import { describe, expect, it } from 'vitest';
import { posterPrice } from './prices';
import { cutoutUsable, maskStats } from './cutout';
import { captionFor } from './jobs/autopilot';
import { makeState, readState } from './meta';
import { normalizeFacebookLink } from './facebook-link';
import { contrast, cssUrl, readable, rgbOf, PAPER } from './poster-kit';
import {
  angleForDay,
  autopilotOrder,
  bestSellers,
  formatForDay,
  isPostingDay,
  slotAt,
} from './schedule';
import {
  fitLook,
  LAYOUTS,
  layoutFits,
  type Look,
  lookForPost,
  lookPage,
  LookSchema,
  resolveLook,
} from './look';
import {
  escapeHtml,
  headlineSize,
  inkOn,
  posterHtml,
  reelHtml,
  type DishArt,
  type PostContent,
} from './templates';
import {
  ApprovedWordsSchema,
  asciiDigits,
  inventedNumber,
  moodWord,
  posterLang,
  posterWords,
  type SocialWords,
} from './words';
import { describeColour, dishPrompt } from './image-ai';
import {
  makeTikTokState,
  pickPrivacy,
  readTikTokState,
  refreshTikTokToken,
  startTikTokPost,
  tiktokPublishStatus,
  tiktokTitle,
} from './tiktok';

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

  const dish = (id: string, sold: number, lastPostedAt: string | null) => ({
    id,
    name: id,
    sold,
    lastPostedAt,
  });

  it('posts only the dishes the owner marked, taking turns (ADR 0058)', () => {
    const dishes = [
      dish('kacchi', 90, '2026-11-10T07:00:00Z'),
      dish('borhani', 5, '2026-11-01T07:00:00Z'),
      dish('firni', 0, null),
    ];
    const order = autopilotOrder(dishes, new Set(['kacchi', 'borhani']));
    expect(order.map((o) => o.dish.id)).toEqual(['borhani', 'kacchi']);
    expect(order.every((o) => o.reason === 'marked')).toBe(true);
    // The dish of the last post goes last when another can go.
    expect(autopilotOrder(dishes, new Set(['kacchi', 'firni']), 'firni')[0]!.dish.id).toBe(
      'kacchi',
    );
  });

  it('with nothing marked, takes turns among the five best sellers, then the rest', () => {
    const dishes = [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => dish(id, 100 - i * 10, null)),
      dish('g', 0, null),
    ];
    expect([...bestSellers(dishes)].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    const order = autopilotOrder(dishes, new Set());
    expect(order[0]).toEqual({ dish: dishes[0], reason: 'best_seller' });
    expect(order.slice(0, 5).every((o) => o.reason === 'best_seller')).toBe(true);
    expect(order.slice(5).map((o) => o.reason)).toEqual(['turn', 'turn']);
    // Posted yesterday: the next best seller goes first.
    const posted = dishes.map((d) =>
      d.id === 'a' ? { ...d, lastPostedAt: '2026-11-14T07:00:00Z' } : d,
    );
    expect(autopilotOrder(posted, new Set())[0]!.dish.id).toBe('b');
    // No sales at all: the whole menu in turn.
    expect(
      autopilotOrder([dish('x', 0, '2026-11-01T00:00:00Z'), dish('y', 0, null)], new Set())[0],
    ).toEqual({
      dish: dish('y', 0, null),
      reason: 'turn',
    });
    expect(autopilotOrder([], new Set())).toEqual([]);
  });
});

describe('poster looks (ADR 0058)', () => {
  const ctx = { tone: 'friendly' as const, english: true, others: 3, hasCut: true };

  it('draws the same look from the same seed, and many different ones from others', () => {
    expect(resolveLook(42, ctx)).toEqual(resolveLook(42, ctx));
    const looks = Array.from({ length: 60 }, (_, i) => resolveLook(i, ctx));
    expect(new Set(looks.map((l) => l.layout)).size).toBeGreaterThanOrEqual(15);
    expect(new Set(looks.map((l) => JSON.stringify(l))).size).toBe(60);
    for (const l of looks) expect(LookSchema.safeParse(l).success).toBe(true);
  });

  it('shows new layouts on every "More designs" page until all were shown', () => {
    const seen = new Set<string>();
    for (let page = 0; page < 3; page++)
      for (const l of lookPage(page, 6, ctx, 7)) seen.add(l.layout);
    expect(seen.size).toBe(18);
    expect(lookPage(9, 6, ctx, 7)).toHaveLength(6);
  });

  it('leaves out layouts the restaurant cannot fill', () => {
    const bangla = { ...ctx, english: false, others: 0 };
    expect(layoutFits('mood', bangla)).toBe(false); // the O's are English letters
    expect(layoutFits('menu', bangla)).toBe(false); // a menu needs another dish
    expect(layoutFits('collage', bangla)).toBe(false);
    for (let i = 0; i < 40; i++)
      expect(layoutFits(resolveLook(i, bangla).layout, bangla)).toBe(true);
    const menu = resolveLook(1, ctx, 'menu');
    expect(fitLook(menu, bangla).layout).not.toBe('menu');
  });

  it('the autopilot avoids the layouts of its last posts', () => {
    const recent = LAYOUTS.slice(0, 10);
    for (let i = 0; i < 20; i++)
      expect(recent).not.toContain(lookForPost('org:' + String(i), ctx, recent).layout);
  });

  it('refuses a look with unknown parts', () => {
    const l = resolveLook(3, ctx);
    expect(LookSchema.safeParse({ ...l, layout: 'evil' }).success).toBe(false);
    expect(LookSchema.safeParse({ ...l, extra: 1 }).success).toBe(false);
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
    kicker_en: 'The best is here',
    kicker_bn: 'সেরা স্বাদ',
    status_q_en: "What's your status?",
    status_a_en: 'Single',
    status_b_en: 'Taken',
    status_c_en: 'Hungry',
    status_q_bn: 'আপনার স্ট্যাটাস কী?',
    status_a_bn: 'সিঙ্গেল',
    status_b_bn: 'কমিটেড',
    status_c_bn: 'ক্ষুধার্ত',
    mood_top_en: "What's your",
    mood_word: 'food',
    mood_bottom_en: 'today?',
    caption_bn: 'আজই আসুন',
    caption_en: 'Come today',
  };
  const defaults = {
    kicker: 'K',
    tagline: 'T',
    statusQ: 'Q',
    statusA: 'A',
    statusB: 'B',
    statusC: 'C',
    moodTop: 'top',
    moodBottom: 'bottom',
  };

  it('maps the words into one poster language, with plain defaults for anything missing', () => {
    const bn = posterWords(words, 'bn', 'Kacchi', defaults);
    expect(bn.headline).toBe('আসল স্বাদ');
    expect(bn.statusC).toBe('ক্ষুধার্ত');
    expect(bn.moodWord).toBe('FOOD'); // normalised from the AI's lower case
    const empty = posterWords({}, 'en', 'Kacchi', defaults);
    expect(empty.headline).toBe('Kacchi');
    expect(empty.hook).toBe('Kacchi');
    expect(empty.statusQ).toBe('Q');
    expect(moodWord('nonsense')).toBe('MOOD');
  });

  it('alternates the poster language day by day when the owner chose both, and keeps a single choice', () => {
    expect(new Set([posterLang('both', 10), posterLang('both', 11)])).toEqual(
      new Set(['bn', 'en']),
    );
    expect(posterLang('bn', 11)).toBe('bn');
    expect(posterLang('en', 10)).toBe('en');
  });

  it('accepts only known, short words back from the preview', () => {
    expect(ApprovedWordsSchema.safeParse({ headline_bn: 'আসল স্বাদ' }).success).toBe(true);
    expect(ApprovedWordsSchema.safeParse({ headline_bn: 'x'.repeat(81) }).success).toBe(false);
    expect(ApprovedWordsSchema.safeParse({ script: 'x' }).success).toBe(false);
  });

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
  const evil = '<script>alert(1)</script>';
  const dishArt = (name: string, cut: boolean): DishArt => ({
    name,
    cutUrl: cut ? 'data:image/webp;base64,CUT0' : null,
    photoUrl: 'data:image/jpeg;base64,PHOTO0',
    price: '৳৩৫০',
    note: evil,
  });
  const look = (layout: Look['layout'], seed = 5): Look =>
    resolveLook(seed, { tone: 'fun', english: true, others: 2, hasCut: true }, layout);
  const content: PostContent = {
    look: look('band'),
    lang: 'bn',
    words: {
      hook: 'Hungry?',
      headline: evil,
      tagline: 'ধীরে রান্না',
      kicker: evil,
      statusQ: evil,
      statusA: 'Single',
      statusB: 'Taken',
      statusC: evil,
      moodTop: evil,
      moodWord: 'MOOD',
      moodBottom: evil,
    },
    cta: 'আজই আসুন',
    badge: 'Best seller',
    restaurant: 'Kacchi & Co',
    area: 'Dhanmondi',
    phone: '01700000000',
    colorMain: '#C8102E',
    colorAccent: '#FFC72C',
    dish: dishArt(evil, true),
    more: [dishArt('Borhani', true), dishArt('Firni', false)],
    logoUrl: null,
    labels: { orderNow: 'Order now', follow: 'Follow', message: 'Message', callUs: 'Call us' },
  };

  it('escapes every piece of text in every design, with and without cut-outs', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    for (const layout of LAYOUTS)
      for (const seed of [1, 2, 3])
        for (const cut of [true, false]) {
          const html = posterHtml({
            ...content,
            look: look(layout, seed),
            dish: dishArt(evil, cut),
          });
          expect(html, layout).not.toContain('<script>alert');
          expect(html, layout).toContain('<!doctype html>');
          expect(html, layout).toContain('data-fit');
          expect(html, layout).not.toMatch(/undefined|NaN/);
        }
    expect(posterHtml({ ...content, look: look('band') })).toContain('Kacchi &amp; Co');
    expect(posterHtml({ ...content, look: look('spotlight') })).toContain('ধীরে রান্না');
    expect(reelHtml(content)).not.toContain('<script>alert');
  });

  it('gives a brand-new restaurant six working designs on every page: one dish, no cut-out, nothing filled in', () => {
    const bare: PostContent = {
      ...content,
      cta: '',
      badge: null,
      restaurant: 'New Place',
      area: null,
      phone: null,
      logoUrl: null,
      dish: {
        name: 'Khichuri',
        cutUrl: null,
        photoUrl: 'data:image/jpeg;base64,P',
        price: null,
        note: null,
      },
      more: [],
    };
    for (const tone of ['friendly', 'premium', 'fun'] as const)
      for (const english of [false, true]) {
        const ctx = { tone, english, others: 0, hasCut: false };
        for (let page = 0; page < 20; page++) {
          const looks = lookPage(page, 6, ctx, 12345);
          expect(looks).toHaveLength(6);
          for (const l of looks) {
            expect(layoutFits(l.layout, ctx), l.layout).toBe(true);
            expect(LookSchema.safeParse(l).success).toBe(true);
            const html = posterHtml({ ...bare, lang: english ? 'en' : 'bn', look: l });
            expect(html, `${l.layout}/${l.plate}`).toContain('<!doctype html>');
            expect(html, `${l.layout}/${l.plate}`).not.toMatch(/undefined|NaN|null/);
          }
        }
        // The autopilot's own pick for the same restaurant.
        const auto = lookForPost('org:post-1', ctx, []);
        expect(layoutFits(auto.layout, ctx)).toBe(true);
      }
  });

  it('stands a clean cut-out on the poster and frames the photo when there is none', () => {
    const withCut = posterHtml({
      ...content,
      look: { ...look('status'), plate: 'float' },
      dish: dishArt('Kacchi', true),
    });
    expect(withCut).toContain('class="cut"');
    expect(withCut).toContain('CUT0');
    const withPhoto = posterHtml({
      ...content,
      look: { ...look('status'), plate: 'float' },
      dish: dishArt('Kacchi', false),
    });
    expect(withPhoto).not.toContain('class="cut"');
    expect(withPhoto).toContain('border-radius:50%');
  });

  it('draws the dishes as the O letters of the MOOD word', () => {
    const html = posterHtml({ ...content, look: look('mood'), lang: 'en' });
    const word = html.slice(html.indexOf('data-fit style="left:90px;top:515px'));
    expect(word.split('CUT0').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('only lets data and https pictures into styles', () => {
    expect(cssUrl('https://x.supabase.co/storage/v1/object/public/a/b.webp')).toBe(
      'https://x.supabase.co/storage/v1/object/public/a/b.webp',
    );
    expect(cssUrl("https://x/a.webp') ;background:url('evil")).toBe('about:blank');
    expect(cssUrl('javascript:alert(1)')).toBe('about:blank');
    expect(cssUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('keeps the brand colour readable on paper', () => {
    const yellow = rgbOf('#FFC72C');
    expect(contrast(yellow, PAPER)).toBeLessThan(2);
    expect(contrast(readable(yellow, PAPER, 4.5), PAPER)).toBeGreaterThanOrEqual(4.5);
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

  it('asks the image model for the whole plate on a plain background, never for words', () => {
    const prompt = dishPrompt('Kacchi');
    expect(prompt).toContain('Kacchi');
    expect(prompt).toContain('whole plate');
    expect(prompt).toContain('No text');
  });
});

describe('dish cut-outs (ADR 0057)', () => {
  /** An RGBA image whose alpha is 255 inside the given rectangle. */
  const image = (w: number, h: number, box: [number, number, number, number]) => {
    const data = new Uint8Array(w * h * 4);
    for (let y = box[1]; y < box[3]; y++)
      for (let x = box[0]; x < box[2]; x++) data[(y * w + x) * 4 + 3] = 255;
    return data;
  };

  it('measures how much of the photo is dish, its box, and whether it touches the edge', () => {
    const s = maskStats(image(100, 100, [20, 30, 80, 70]), 100, 100, 4);
    expect(s.coverage).toBeCloseTo(0.24, 5);
    expect(s.edge).toBe(0);
    expect(s.box).toEqual({ x: 0.2, y: 0.3, w: 0.6, h: 0.4 });
    expect(cutoutUsable(s)).toBe(true);
  });

  it('refuses a close-up whose plate runs off the frame, an empty mask and a whole-photo mask', () => {
    const closeUp = maskStats(image(100, 100, [0, 10, 100, 100]), 100, 100, 4);
    expect(closeUp.edge).toBeGreaterThan(0.5);
    expect(cutoutUsable(closeUp)).toBe(false);
    expect(cutoutUsable(maskStats(image(50, 50, [0, 0, 0, 0]), 50, 50, 4))).toBe(false);
    expect(cutoutUsable(maskStats(image(50, 50, [1, 1, 49, 49]), 50, 50, 4))).toBe(false);
  });
});

describe('prices on posters (ADR 0057)', () => {
  const vat = { included: true, plusVat: '+VAT', currency: 'BDT' };

  it('prints the menu price with the shared formatter, Bangla digits in Bangla', () => {
    expect(posterPrice({ basePoisha: 35000, branchPoisha: [] }, 'en', vat)).toBe('৳350');
    expect(posterPrice({ basePoisha: 35000, branchPoisha: [35000] }, 'bn', vat)).toBe('৳৩৫০');
    expect(posterPrice({ basePoisha: 125050, branchPoisha: [] }, 'en', vat)).toBe('৳1,250.50');
    // A restaurant abroad: its own currency (ADR 0062).
    expect(
      posterPrice({ basePoisha: 125050, branchPoisha: [] }, 'en', { ...vat, currency: 'USD' }),
    ).toBe('$1,250.50');
  });

  it('says nothing when branches charge differently, or the dish has no price', () => {
    expect(posterPrice({ basePoisha: 35000, branchPoisha: [38000] }, 'en', vat)).toBeNull();
    expect(posterPrice({ basePoisha: 0, branchPoisha: [] }, 'en', vat)).toBeNull();
  });

  it('adds +VAT when menu prices do not include it', () => {
    expect(
      posterPrice({ basePoisha: 35000, branchPoisha: [] }, 'en', {
        included: false,
        plusVat: '+VAT',
        currency: 'BDT',
      }),
    ).toBe('৳350 +VAT');
  });
});

describe('Facebook connect state', () => {
  it('round-trips, expires after 30 minutes and rejects tampering', () => {
    process.env.META_APP_SECRET = 'test-secret-test-secret';
    const t0 = Date.parse('2026-10-26T07:00:00Z');
    const state = makeState('org-1', 'user-1', t0);
    expect(readState(state, t0 + 60_000)).toEqual({
      orgId: 'org-1',
      userId: 'user-1',
      admin: false,
    });
    expect(readState(state, t0 + 31 * 60_000)).toBeNull();
    expect(readState(state.replace('org-1', 'org-2'), t0 + 60_000)).toBeNull();
    expect(readState('garbage', t0)).toBeNull();
  });

  it('marks an admin connect, and an owner state cannot be turned into one (ADR 0059)', () => {
    process.env.META_APP_SECRET = 'test-secret-test-secret';
    const t0 = Date.parse('2026-11-16T07:00:00Z');
    const admin = makeState('org-1', 'user-1', t0, 'admin');
    expect(readState(admin, t0 + 60_000)).toEqual({
      orgId: 'org-1',
      userId: 'user-1',
      admin: true,
    });
    const owner = makeState('org-1', 'user-1', t0);
    const [o, u, i, sig] = owner.split('.');
    expect(readState(`${o}.${u}.${i}.a.${sig}`, t0 + 60_000)).toBeNull();
    expect(readState(`${o}.${u}.${i}.b.${sig}`, t0 + 60_000)).toBeNull();
  });
});

describe('Facebook link an owner pastes (ADR 0059)', () => {
  it('keeps Facebook links as https and refuses anything else', () => {
    expect(normalizeFacebookLink('facebook.com/kacchihouse')).toBe(
      'https://facebook.com/kacchihouse',
    );
    expect(normalizeFacebookLink(' http://m.facebook.com/profile.php?id=1000 ')).toBe(
      'https://m.facebook.com/profile.php?id=1000',
    );
    expect(normalizeFacebookLink('https://web.facebook.com/kacchi')).toBe(
      'https://web.facebook.com/kacchi',
    );
    expect(normalizeFacebookLink('https://fb.me/kacchi')).toBe('https://fb.me/kacchi');
    expect(normalizeFacebookLink('javascript:alert(1)')).toBeNull();
    expect(normalizeFacebookLink('https://evilfacebook.com/x')).toBeNull();
    expect(normalizeFacebookLink('https://facebook.com.evil.io/x')).toBeNull();
    expect(normalizeFacebookLink('https://facebook.com/')).toBeNull();
    expect(normalizeFacebookLink('https://user:pw@facebook.com/x')).toBeNull();
    expect(normalizeFacebookLink('facebook.com/a b')).toBeNull();
    expect(normalizeFacebookLink('')).toBeNull();
  });
});

describe('TikTok (ADR 0041)', () => {
  process.env.TIKTOK_CLIENT_KEY = 'test-key';
  process.env.TIKTOK_CLIENT_SECRET = 'test-tiktok-secret';

  /** A fake TikTok: answers each call from `replies` in order and records what was sent. */
  function fakeTikTok(replies: { status?: number; body?: unknown }[]) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const r = replies.shift() ?? {};
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    }) as typeof fetch;
    return { calls, impl };
  }
  const ok = (data: unknown) => ({ body: { data, error: { code: 'ok' } } });
  const video = new Uint8Array([1, 2, 3, 4, 5]);

  it('signs its connect state apart from Facebook and expires it after 30 minutes', () => {
    process.env.META_APP_SECRET = 'test-tiktok-secret';
    const t0 = Date.parse('2026-10-29T07:00:00Z');
    const state = makeTikTokState('org-1', 'user-1', t0);
    expect(readTikTokState(state, t0 + 60_000)).toEqual({ orgId: 'org-1', userId: 'user-1' });
    expect(readTikTokState(state, t0 + 31 * 60_000)).toBeNull();
    expect(readTikTokState(state.replace('user-1', 'user-2'), t0)).toBeNull();
    // Even with the same secret, a Facebook state is not a TikTok state.
    expect(readTikTokState(makeState('org-1', 'user-1', t0), t0)).toBeNull();
  });

  it('posts publicly when TikTok allows it, otherwise privately', () => {
    expect(pickPrivacy(['SELF_ONLY', 'PUBLIC_TO_EVERYONE'])).toBe('PUBLIC_TO_EVERYONE');
    expect(pickPrivacy(['FOLLOWER_OF_CREATOR', 'SELF_ONLY'])).toBe('SELF_ONLY');
    expect(pickPrivacy([])).toBe('SELF_ONLY');
  });

  it("keeps the title inside TikTok's limit", () => {
    expect(tiktokTitle('Kacchi')).toBe('Kacchi');
    expect(tiktokTitle('x'.repeat(3000))).toHaveLength(2200);
  });

  it('sends a draft to the inbox and uploads the whole video in one piece', async () => {
    const { calls, impl } = fakeTikTok([
      ok({ publish_id: 'p-1', upload_url: 'https://upload.example/u' }),
      { status: 201 },
    ]);
    expect(await startTikTokPost('tok', 'draft', video, 'caption', impl)).toBe('p-1');
    expect(calls[0]!.url).toContain('/post/publish/inbox/video/init/');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      source_info: { source: 'FILE_UPLOAD', video_size: 5, chunk_size: 5, total_chunk_count: 1 },
    });
    expect(calls[1]!.init.method).toBe('PUT');
    expect((calls[1]!.init.headers as Record<string, string>)['Content-Range']).toBe('bytes 0-4/5');
  });

  it('posts directly, and falls back to private once while TikTok has not audited the app', async () => {
    const { calls, impl } = fakeTikTok([
      ok({ privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] }),
      {
        status: 403,
        body: { error: { code: 'unaudited_client_can_only_post_to_private_accounts' } },
      },
      ok({ publish_id: 'p-2', upload_url: 'https://upload.example/u' }),
      { status: 200 },
    ]);
    expect(await startTikTokPost('tok', 'direct', video, 'Hello', impl)).toBe('p-2');
    const privacy = (i: number) =>
      (JSON.parse(String(calls[i]!.init.body)) as { post_info: { privacy_level: string } })
        .post_info.privacy_level;
    expect(calls[1]!.url).toContain('/post/publish/video/init/');
    expect(privacy(1)).toBe('PUBLIC_TO_EVERYONE');
    expect(privacy(2)).toBe('SELF_ONLY');
  });

  it('sends the video to the inbox when TikTok refuses even a private post from an unaudited app', async () => {
    const refused = {
      status: 403,
      body: { error: { code: 'unaudited_client_can_only_post_to_private_accounts' } },
    };
    const { calls, impl } = fakeTikTok([
      ok({ privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] }),
      refused,
      refused,
      ok({ publish_id: 'p-3', upload_url: 'https://upload.example/u' }),
      { status: 201 },
    ]);
    expect(await startTikTokPost('tok', 'direct', video, 'Hello', impl)).toBe('p-3');
    expect(calls[3]!.url).toContain('/post/publish/inbox/video/init/');
    expect(calls[4]!.init.method).toBe('PUT');
  });

  it('does not hide other TikTok errors behind the private fallback', async () => {
    const { impl } = fakeTikTok([
      ok({ privacy_level_options: ['PUBLIC_TO_EVERYONE'] }),
      { status: 429, body: { error: { code: 'spam_risk_too_many_posts', message: 'too many' } } },
    ]);
    await expect(startTikTokPost('tok', 'direct', video, 'Hello', impl)).rejects.toThrow(
      'too many',
    );
  });

  it('reads where a post is: in the inbox, published, still processing or failed', async () => {
    const status = async (data: unknown) =>
      tiktokPublishStatus('tok', 'p-9', fakeTikTok([ok(data)]).impl);
    expect(await status({ status: 'SEND_TO_USER_INBOX' })).toEqual({
      state: 'done',
      postId: 'inbox:p-9',
    });
    expect(
      await status({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7123] }),
    ).toEqual({ state: 'done', postId: '7123' });
    expect(await status({ status: 'PUBLISH_COMPLETE' })).toEqual({
      state: 'done',
      postId: 'p-9',
    });
    expect(await status({ status: 'PROCESSING_UPLOAD' })).toEqual({ state: 'processing' });
    expect(await status({ status: 'FAILED', fail_reason: 'file_format_check_failed' })).toEqual({
      state: 'failed',
      reason: 'file_format_check_failed',
    });
  });

  it('refreshes the token and keeps the new refresh token and expiry', async () => {
    const at = new Date('2026-10-29T07:00:00Z');
    const { calls, impl } = fakeTikTok([
      {
        body: {
          open_id: 'abc-123',
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 86_400,
        },
      },
    ]);
    const tokens = await refreshTikTokToken('old-refresh', at, impl);
    expect(tokens).toEqual({
      openId: 'abc-123',
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: new Date('2026-10-30T07:00:00Z'),
    });
    expect(String(calls[0]!.init.body)).toContain('grant_type=refresh_token');
    await expect(
      refreshTikTokToken(
        'bad',
        at,
        fakeTikTok([{ status: 400, body: { error: 'invalid_grant' } }]).impl,
      ),
    ).rejects.toThrow('invalid_grant');
  });
});
