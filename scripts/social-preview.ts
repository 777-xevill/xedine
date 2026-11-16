/**
 * See the social autopilot's pictures on your own machine (ADR 0057, 0058), without the database:
 *
 *   pnpm social:preview cutout <photo> [<photo>…] --out <dir>
 *       lift each dish off its background; writes <name>.webp and prints whether a poster may use it.
 *
 *   pnpm social:preview videos <cut-out or photo…> [--dish "A|B|C"] [--lang en|bn] [--tone …] [--count 7]
 *       [--kind showcase|versus|combo|carousel|ring|search|offer] [--seed s] [--html] [--out <dir>]
 *       [--sound] [--voice] [--gender male] [--occasion eid_fitr|jummah|…|custom --occasion-text "…"]
 *       [--country US] (the restaurant's country: its national day's name and flag colours, ADR 0061)
 *       short sample videos (ADR 0061) into <out>/videos; a .webp file is taken as a cut-out. --sound adds
 *       music and motion sounds, --voice reads the hook aloud (needs Python with edge-tts).
 *
 *   pnpm social:preview posters <main photo> [<more photos>…] --dish "Kacchi Biryani|Borhani" [--price 35000]
 *       [--lang en|bn] [--tone friendly|premium|fun] [--count 12] [--page 0] [--layout corner]
 *       [--every] [--reel] [--html] [--out <dir>]
 *       draws a page of looks (as Growth's "More designs" shows them) with sample words, and a contact sheet
 *       of them (sheet-<lang>-<page>.jpg). --every draws one look per layout; --layout draws one layout in
 *       --count different looks. Prices are in poisha. --reel also makes the 8-second video of the first
 *       look; --html keeps each poster's page next to its JPEG.
 *
 * Needs CHROME_PATH (a local Chrome/Chromium) for posters. The cut-out model (~214 MB) is downloaded once
 * into SOCIAL_MODEL_DIR (default .cache/models).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createTranslator } from 'next-intl';
import { formatBDT } from '@/lib/i18n/format';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { cutOut } from '@/modules/social/cutout';
import {
  type Layout,
  LAYOUTS,
  layoutFits,
  type LookContext,
  lookPage,
  resolveLook,
  seedOf,
  type SocialTone,
} from '@/modules/social/look';
import {
  dataUrl,
  renderPoster,
  renderReel,
  renderVideo,
  withBrowser,
} from '@/modules/social/render';
import {
  type DishArt,
  type PostContent,
  posterHtml,
  type PosterWords,
} from '@/modules/social/templates';
import {
  type VideoContent,
  type VideoDish,
  videoHtml,
  type VideoWords,
} from '@/modules/social/video';
import { resolveVideoLook, VIDEO_KINDS, type VideoKind } from '@/modules/social/video-look';
import { fallbackWordKeys, hookStyleFor, type Occasion } from '@/modules/social/video-words';
import { writeSocialVideo } from '@/modules/social/writer';
import { banglaWords } from '@/modules/social/bangla-lines';
import { countryName, countryOf, nationalDayOf, occasionLook } from '@/modules/social/culture';
import { pickTrack, scoreVideo, speak } from '@/modules/social/sound';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function mimeOf(file: string): string {
  const ext = extname(file).toLowerCase();
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
}

async function cutoutCached(file: string, out: string) {
  const name = basename(file, extname(file));
  const webp = join(out, `${name}.webp`);
  const meta = join(out, `${name}.json`);
  if (existsSync(webp) && existsSync(meta)) {
    const m = JSON.parse(await readFile(meta, 'utf8')) as { usable: boolean };
    return { webp: new Uint8Array(await readFile(webp)), usable: m.usable };
  }
  const t0 = performance.now();
  const c = await cutOut(new Uint8Array(await readFile(file)), mimeOf(file));
  await writeFile(webp, c.webp);
  await writeFile(meta, JSON.stringify({ usable: c.usable, stats: c.stats }));
  const s = c.stats;
  console.log(
    `${name.padEnd(28)} ${c.usable ? 'USABLE ' : 'photo  '} coverage ${s.coverage.toFixed(2)}  edge ${s.edge.toFixed(2)}  ${c.width}x${c.height}  ${Math.round(performance.now() - t0)} ms`,
  );
  return { webp: c.webp, usable: c.usable };
}

async function cutouts(files: string[], out: string) {
  await mkdir(out, { recursive: true });
  for (const file of files) await cutoutCached(file, out);
}

const SAMPLE: Record<
  'en' | 'bn',
  Omit<PosterWords, 'statusQ' | 'statusA' | 'statusB' | 'statusC' | 'moodTop' | 'moodBottom'>
> = {
  en: {
    hook: 'Still thinking about lunch?',
    headline: 'Taste the Legend',
    tagline: 'Slow-cooked, fresh every day',
    kicker: 'The best is here',
    moodWord: 'MOOD',
  },
  bn: {
    hook: 'দুপুরে কী খাবেন ভাবছেন?',
    headline: 'আসল স্বাদ',
    tagline: 'দমে রান্না, প্রতিদিন টাটকা',
    kicker: 'সেরা স্বাদ এখানেই',
    moodWord: 'MOOD',
  },
};

/** One contact sheet of the rendered posters, 4 across, each labelled with its look. */
async function sheet(
  browser: Parameters<Parameters<typeof withBrowser>[0]>[0],
  shots: { jpeg: Uint8Array; label: string }[],
  file: string,
) {
  const cols = 4;
  const w = 300;
  const h = 375;
  const tiles = shots
    .map(
      (s) =>
        `<figure><img src="${dataUrl(s.jpeg, 'image/jpeg')}"><figcaption>${s.label}</figcaption></figure>`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:20px;background:rgb(236 236 240);font:600 14px system-ui}
main{display:grid;grid-template-columns:repeat(${cols},${w}px);gap:16px}
figure{margin:0}img{width:${w}px;height:${h}px;display:block;border-radius:8px;box-shadow:0 6px 16px rgb(0 0 0 / .15)}
figcaption{margin-top:6px;color:rgb(40 40 50);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:${w}px}
</style></head><body><main>${tiles}</main></body></html>`;
  const page = await browser.newPage();
  const rows = Math.ceil(shots.length / cols);
  await page.setViewport({ width: cols * w + (cols - 1) * 16 + 40, height: rows * (h + 40) + 40 });
  await page.setContent(html, { waitUntil: 'load' });
  await writeFile(file, await page.screenshot({ type: 'jpeg', quality: 82, fullPage: true }));
  await page.close();
  console.log(`sheet     ${file}`);
}

async function posters(files: string[], out: string) {
  if (!process.env.CHROME_PATH) throw new Error('Set CHROME_PATH to a local Chrome/Chromium');
  await mkdir(out, { recursive: true });
  const lang = arg('lang') === 'bn' ? 'bn' : 'en';
  const tone = (arg('tone') ?? 'friendly') as SocialTone;
  const t = createTranslator({
    locale: lang,
    messages: lang === 'bn' ? bn : en,
    namespace: 'social.poster',
  });
  const price = arg('price');
  const names = (arg('dish') ?? 'Chicken Biryani').split('|');
  const arts: DishArt[] = [];
  for (const [i, file] of files.entries()) {
    const cut = await cutoutCached(file, out);
    const photo = new Uint8Array(await readFile(file));
    arts.push({
      name: names[i] ?? basename(file, extname(file)).replace(/-\d+$/, '').replace(/-/g, ' '),
      cutUrl: cut.usable ? dataUrl(cut.webp, 'image/webp') : null,
      photoUrl: dataUrl(photo, mimeOf(file)),
      price: price ? formatBDT(Number(price) + i * 5000, lang, { poisha: 'never' }) : null,
      note:
        i === 0
          ? null
          : lang === 'bn'
            ? 'ঘরের মশলায় ধীরে রান্না'
            : 'Slow cooked with house spices',
    });
  }
  const ctx: LookContext = {
    tone,
    english: lang === 'en',
    others: arts.length - 1,
    hasCut: Boolean(arts[0]!.cutUrl),
  };
  const count = Number(arg('count') ?? 12);
  const pageNo = Number(arg('page') ?? 0);
  const only = arg('layout') as Layout | undefined;
  const looks = process.argv.includes('--every')
    ? LAYOUTS.filter((l) => layoutFits(l, ctx)).map((l, i) =>
        resolveLook(seedOf(`every:${pageNo}:${i}`), ctx, l),
      )
    : only && (LAYOUTS as readonly string[]).includes(only)
      ? Array.from({ length: count }, (_, i) =>
          resolveLook(seedOf(`${only}:${pageNo}:${i}`), ctx, only),
        )
      : lookPage(pageNo, count, ctx, seedOf(names[0]!));
  const words: PosterWords = {
    ...SAMPLE[lang],
    statusQ: t('defaults.statusQ'),
    statusA: t('defaults.statusA'),
    statusB: t('defaults.statusB'),
    statusC: t('defaults.statusC'),
    moodTop: t('defaults.moodTop'),
    moodBottom: t('defaults.moodBottom'),
  };
  await withBrowser(async (browser) => {
    const shots: { jpeg: Uint8Array; label: string }[] = [];
    for (const [i, look] of looks.entries()) {
      const content: PostContent = {
        look,
        lang,
        words,
        cta: t('cta'),
        badge: i % 3 === 0 ? t('badgeStar') : null,
        restaurant: lang === 'bn' ? 'কাচ্চি ঘর' : 'Kacchi Ghor',
        area: lang === 'bn' ? 'ধানমন্ডি, ঢাকা' : 'Dhanmondi, Dhaka',
        phone: '01712-345678',
        colorMain: arg('main') ?? '#0F5C4A',
        colorAccent: arg('accent') ?? '#F2B33D',
        dish: arts[0]!,
        more: arts.slice(1),
        logoUrl: null,
        labels: {
          orderNow: t('labels.orderNow'),
          follow: t('labels.follow'),
          message: t('labels.message'),
          callUs: t('labels.callUs'),
        },
      };
      const t0 = performance.now();
      const jpeg = await renderPoster(browser, content);
      const name = `${String(i).padStart(2, '0')}-${look.layout}-${lang}`;
      await writeFile(join(out, `${name}.jpg`), jpeg);
      if (process.argv.includes('--html'))
        await writeFile(join(out, `${name}.html`), posterHtml(content));
      const label = `${look.layout} · ${look.scheme} · ${look.type} · ${look.backdrop} · ${look.plate} · ${look.deco} · ${look.head}${look.mirror ? ' · mirror' : ''}`;
      shots.push({ jpeg, label });
      console.log(`${name.padEnd(24)} ${label}  ${Math.round(performance.now() - t0)} ms`);
      if (process.argv.includes('--reel') && i === 0) {
        const t1 = performance.now();
        const reel = join(out, `reel-${lang}.mp4`);
        await writeFile(reel, await renderReel(browser, content));
        console.log(`reel      ${reel}  ${Math.round(performance.now() - t1)} ms`);
      }
    }
    await sheet(
      browser,
      shots,
      join(
        out,
        `sheet-${lang}-${only ?? (process.argv.includes('--every') ? 'every' : pageNo)}.jpg`,
      ),
    );
  });
}

/**
 * Sample videos (ADR 0061) from cut-outs or photos: --count videos, the kinds taking turns (or --kind),
 * each with as many dishes as its kind needs, taken in turn from the files given.
 */
async function videos(files: string[], out: string) {
  if (!process.env.CHROME_PATH) throw new Error('Set CHROME_PATH to a local Chrome/Chromium');
  await mkdir(out, { recursive: true });
  const lang = arg('lang') === 'bn' ? 'bn' : 'en';
  const tone = (arg('tone') ?? 'friendly') as SocialTone;
  const t = createTranslator({
    locale: lang,
    messages: lang === 'bn' ? bn : en,
    namespace: 'social',
  });
  const names = (arg('dish') ?? '').split('|').filter(Boolean);
  const price = Number(arg('price') ?? 35000);
  const dishes: VideoDish[] = [];
  for (const [i, file] of files.entries()) {
    const bytes = new Uint8Array(await readFile(file));
    const url = dataUrl(bytes, mimeOf(file));
    const cut = extname(file).toLowerCase() === '.webp';
    dishes.push({
      name: names[i] ?? basename(file, extname(file)).replace(/-\d+$/, '').replace(/-/g, ' '),
      cutUrl: cut ? url : null,
      photoUrl: url,
      price: formatBDT(price + i * 5000, lang, { poisha: 'never' }),
      was: formatBDT(price + i * 5000 + 10000, lang, { poisha: 'never' }),
      note: null,
    });
  }
  const count = Number(arg('count') ?? VIDEO_KINDS.length);
  const only = arg('kind') as VideoKind | undefined;
  const need: Record<VideoKind, number> = {
    showcase: 1,
    offer: 1,
    versus: 2,
    combo: 2,
    carousel: 3,
    ring: 3,
    search: 3,
  };
  const salt = arg('seed') ?? 'sample';
  const occasion = (arg('occasion') ?? null) as Occasion | null;
  const country = countryOf(arg('country') ?? 'BD');
  const nationalDay = nationalDayOf(country)?.name;
  const greetingOf = (o: Occasion): string =>
    o === 'custom'
      ? (arg('occasion-text') ?? '')
      : o === 'national_day'
        ? nationalDay
          ? t('video.occasions.national_day', { day: nationalDay })
          : t('video.occasions.independence_day')
        : t(`video.occasions.${o}`);
  const said: string[] = [];
  await withBrowser(async (browser) => {
    for (let i = 0; i < count; i++) {
      const kind = only ?? VIDEO_KINDS[i % VIDEO_KINDS.length]!;
      const n = need[kind];
      const picked = Array.from({ length: n }, (_, j) => dishes[(i + j) % dishes.length]!);
      const look = resolveVideoLook(
        seedOf(`${salt}:${i}`),
        { tone, dishes: n, offer: kind === 'offer', hot: true },
        kind,
      );
      // Words as a restaurant gets them: a hook style per video; --ai <org id> asks the real AI (its use is
      // logged to that org), otherwise the app's fixed lines in that style.
      const seed = seedOf(`${salt}:${i}:words`);
      const style = hookStyleFor(seed, tone, { hasMoment: true });
      const moment = (['lunch', 'snack', 'dinner'] as const)[i % 3]!;
      const fixed = fallbackWordKeys(style, moment, seed);
      let words: VideoWords = {
        hook: t(fixed.hook as 'video.defaults.hook'),
        punch: t('video.defaults.punch'),
        question: t(fixed.question as 'video.defaults.question'),
        tagline: t(fixed.tagline as 'video.defaults.tagline'),
        cta: t('poster.cta'),
      };
      const aiOrg = arg('ai');
      if (lang === 'bn') {
        // Bangla is the hand-written lines matched to the video, as restaurants get it.
        const bn = banglaWords(
          {
            style,
            moment,
            tone,
            dishes: n,
            occasion,
            fact: null,
            dishName: picked[0]!.name,
          },
          seed,
          said,
        );
        words = { ...bn, cta: words.cta };
        said.unshift(bn.hook, bn.tagline);
      } else if (aiOrg) {
        const w = await writeSocialVideo({
          orgId: aiOrg,
          restaurant: 'Kacchi Ghor',
          dishes: picked.map((d) => d.name),
          kind,
          fact: `A spotlight on ${picked.map((d) => d.name).join(' and ')} from the menu.`,
          occasion: occasion ? greetingOf(occasion) || null : null,
          ownNote: null,
          tone,
          area: country === 'BD' ? 'Dhanmondi' : null,
          country: countryName(country),
          hookStyle: style,
          moment,
          recentLines: said,
        }).catch(() => null);
        if (w) {
          words = {
            hook: w[`hook_${lang}`] || words.hook,
            punch: w[`punch_${lang}`] || words.punch,
            question: w[`question_${lang}`] || words.question,
            tagline: w[`tagline_${lang}`] || words.tagline,
            cta: words.cta,
          };
          said.unshift(words.hook, words.tagline);
        }
      }
      console.log(`words     ${style}: ${words.hook} | ${words.tagline}`);
      const content: VideoContent = {
        look,
        words,
        labels: { or: t('video.or'), onlyAt: t('video.onlyAt'), now: t('video.now') },
        restaurant: lang === 'bn' ? 'কাচ্চি ঘর' : 'Kacchi Ghor',
        area: lang === 'bn' ? 'ধানমন্ডি, ঢাকা' : 'Dhanmondi, Dhaka',
        phone: '01712-345678',
        colorMain: arg('main') ?? '#0F5C4A',
        colorAccent: arg('accent') ?? '#F2B33D',
        logoUrl: null,
        dishes: picked,
        occasion: occasion
          ? { greeting: greetingOf(occasion), ...occasionLook(occasion, country) }
          : null,
      };
      // --voice reads the hook (and greeting) aloud; the hook stays as long as the voice needs.
      const spoken = content.occasion
        ? `${content.occasion.greeting}! ${content.words.hook}`
        : content.words.hook;
      const voice = process.argv.includes('--voice')
        ? await speak(
            spoken,
            lang,
            arg('gender') === 'male' ? 'male' : 'female',
            join(out, `voice-${i}.mp3`),
          )
        : null;
      if (voice) {
        content.seconds = 12;
        content.hookSeconds = Math.max(2.2, voice.seconds + 0.7);
      }
      const name = `${String(i).padStart(2, '0')}-${kind}-${lang}${occasion ? `-${occasion}` : ''}`;
      if (process.argv.includes('--html'))
        await writeFile(join(out, `${name}.html`), videoHtml(content));
      const t0 = performance.now();
      const made = await renderVideo(browser, content);
      // --sound lays music (by the tone's moods), the motion sounds and the voice under the picture.
      const track = process.argv.includes('--sound')
        ? await pickTrack(
            tone === 'premium'
              ? ['cinematic', 'chill']
              : tone === 'fun'
                ? ['upbeat', 'playful']
                : ['warm', 'upbeat'],
            `${salt}:${i}`,
          )
        : null;
      const mp4 = process.argv.includes('--sound')
        ? await scoreVideo(made.mp4, {
            seconds: made.plan.seconds,
            track,
            voice,
            voiceAt: 0.3,
            hits: made.plan.hits,
          })
        : made.mp4;
      await writeFile(join(out, `${name}.mp4`), mp4);
      if (track) console.log(`  music  ${track.title} — ${track.artist} (CC0)`);
      const label = `${look.scheme} · ${look.type} · ${look.stage}/${look.backdrop} · hook ${look.hook}${look.hookOnPhoto ? ' on photo' : ''} · ${look.enter} · cut ${look.cut} · ${look.ambient}${look.steam ? ' · steam' : ''} · ${look.outro}`;
      console.log(`${name.padEnd(22)} ${label}  ${Math.round(performance.now() - t0)} ms`);
    }
  });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const files = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));
  const out = arg('out') ?? join('.cache', 'social-preview');
  if (command === 'cutout') return cutouts(files, out);
  if (command === 'posters') return posters(files, out);
  if (command === 'videos') return videos(files, join(out, 'videos'));
  console.log(
    'usage: pnpm social:preview cutout|posters <photo…> [--out <dir>] (see the top of this file)',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
