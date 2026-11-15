import { describe, expect, it } from 'vitest';
import { posterPrice } from './prices';
import { cutoutUsable, maskStats } from './cutout';
import { captionFor } from './jobs/autopilot';
import { makeState, readState } from './meta';
import { contrast, cssUrl, readable, rgbOf, PAPER } from './poster-kit';
import {
  angleForDay,
  designFits,
  designForDay,
  formatForDay,
  isPostingDay,
  pickDish,
  POSTER_DESIGNS,
  slotAt,
} from './schedule';
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

  it('rotates through every design the owner allows, never repeating a recent one (ADR 0057)', () => {
    const needs = { english: true, dishes: 5 };
    const days = Array.from({ length: 10 }, (_, i) => `2026-11-${String(10 + i).padStart(2, '0')}`);
    const seen = new Set(
      days.map((d) => designForDay(d, { tone: 'friendly', allowed: POSTER_DESIGNS, needs })),
    );
    expect(seen.size).toBe(10);
    const day = '2026-11-20';
    const first = designForDay(day, { tone: 'fun', allowed: POSTER_DESIGNS, needs });
    const next = designForDay(day, {
      tone: 'fun',
      allowed: POSTER_DESIGNS,
      needs,
      recent: [first],
    });
    expect(next).not.toBe(first);
    // Only the designs the owner allows.
    expect(designForDay(day, { tone: 'premium', allowed: ['frame'], needs })).toBe('frame');
  });

  it('leaves out designs the restaurant cannot fill', () => {
    expect(designFits('mood', { english: false, dishes: 5 })).toBe(false); // the O's are English letters
    expect(designFits('menu', { english: true, dishes: 1 })).toBe(false); // a menu needs two dishes
    expect(designFits('status', { english: false, dishes: 1 })).toBe(true);
    const onlyBangla = new Set(
      ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) =>
        designForDay(d, {
          tone: 'fun',
          allowed: ['mood', 'menu'],
          needs: { english: false, dishes: 1 },
        }),
      ),
    );
    expect(onlyBangla).toEqual(new Set(['centre'])); // nothing fits: the safe spotlight
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
  const content: PostContent = {
    design: 'band',
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
    for (const design of POSTER_DESIGNS)
      for (const cut of [true, false]) {
        const html = posterHtml({ ...content, design, dish: dishArt(evil, cut) });
        expect(html, design).not.toContain('<script>alert');
        expect(html, design).toContain('<!doctype html>');
        expect(html, design).toContain('data-fit');
      }
    expect(posterHtml({ ...content, design: 'band' })).toContain('Kacchi &amp; Co');
    expect(posterHtml({ ...content, design: 'centre' })).toContain('ধীরে রান্না');
    expect(reelHtml(content)).not.toContain('<script>alert');
  });

  it('stands a clean cut-out on the poster and frames the photo when there is none', () => {
    const withCut = posterHtml({ ...content, design: 'status', dish: dishArt('Kacchi', true) });
    expect(withCut).toContain('class="cut"');
    expect(withCut).toContain('CUT0');
    const withPhoto = posterHtml({ ...content, design: 'status', dish: dishArt('Kacchi', false) });
    expect(withPhoto).not.toContain('class="cut"');
    expect(withPhoto).toContain('border-radius:50%');
  });

  it('draws the dishes as the O letters of the MOOD word', () => {
    const html = posterHtml({ ...content, design: 'mood', lang: 'en' });
    const word = html.slice(html.indexOf('data-fit style="left:90px'));
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
  const vat = { included: true, plusVat: '+VAT' };

  it('prints the menu price with the shared formatter, Bangla digits in Bangla', () => {
    expect(posterPrice({ basePoisha: 35000, branchPoisha: [] }, 'en', vat)).toBe('৳350');
    expect(posterPrice({ basePoisha: 35000, branchPoisha: [35000] }, 'bn', vat)).toBe('৳৩৫০');
    expect(posterPrice({ basePoisha: 125050, branchPoisha: [] }, 'en', vat)).toBe('৳1,250.50');
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
      }),
    ).toBe('৳350 +VAT');
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
