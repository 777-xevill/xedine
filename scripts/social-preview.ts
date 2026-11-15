/**
 * See the social autopilot's pictures on your own machine (ADR 0057), without the database:
 *
 *   pnpm social:preview cutout <photo> [<photo>…] --out <dir>
 *       lift each dish off its background; writes <name>.webp and prints whether a poster may use it.
 *
 *   pnpm social:preview posters <main photo> [<more photos>…] --dish "Kacchi Biryani" [--price 35000]
 *       [--lang en|bn] [--design status] [--reel] [--html] [--out <dir>]
 *       draws every poster design (or one) with sample words; prices are in poisha. --reel also makes the
 *       8-second video from the first design's content; --html keeps each poster's page next to its JPEG.
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
import { dataUrl, renderPoster, renderReel, withBrowser } from '@/modules/social/render';
import { isPosterDesign, POSTER_DESIGNS } from '@/modules/social/schedule';
import {
  type DishArt,
  type PostContent,
  posterHtml,
  type PosterWords,
} from '@/modules/social/templates';

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

async function posters(files: string[], out: string) {
  if (!process.env.CHROME_PATH) throw new Error('Set CHROME_PATH to a local Chrome/Chromium');
  await mkdir(out, { recursive: true });
  const lang = arg('lang') === 'bn' ? 'bn' : 'en';
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
  const only = arg('design');
  const designs = only && isPosterDesign(only) ? [only] : POSTER_DESIGNS;
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
    for (const design of designs) {
      const content: PostContent = {
        design,
        lang,
        words,
        cta: t('cta'),
        badge: design === 'centre' || design === 'giant' ? t('badgeStar') : null,
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
      const file = join(out, `${design}-${lang}.jpg`);
      await writeFile(file, jpeg);
      // --html also keeps the page itself, to open in a browser or embed the way Growth's preview does.
      if (process.argv.includes('--html'))
        await writeFile(join(out, `${design}-${lang}.html`), posterHtml(content));
      console.log(`${design.padEnd(9)} ${file}  ${Math.round(performance.now() - t0)} ms`);
      if (process.argv.includes('--reel') && design === designs[0]) {
        const t1 = performance.now();
        const reel = join(out, `reel-${lang}.mp4`);
        await writeFile(reel, await renderReel(browser, content));
        console.log(`reel      ${reel}  ${Math.round(performance.now() - t1)} ms`);
      }
    }
  });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const files = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));
  const out = arg('out') ?? join('.cache', 'social-preview');
  if (command === 'cutout') return cutouts(files, out);
  if (command === 'posters') return posters(files, out);
  console.log(
    'usage: pnpm social:preview cutout|posters <photo…> [--out <dir>] (see the top of this file)',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
