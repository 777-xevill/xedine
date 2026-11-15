/**
 * See the social autopilot's pictures on your own machine (ADR 0057, 0058), without the database:
 *
 *   pnpm social:preview cutout <photo> [<photo>…] --out <dir>
 *       lift each dish off its background; writes <name>.webp and prints whether a poster may use it.
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
import { dataUrl, renderPoster, renderReel, withBrowser } from '@/modules/social/render';
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
    await sheet(browser, shots, join(out, `sheet-${lang}-${only ?? (process.argv.includes('--every') ? 'every' : pageNo)}.jpg`));
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
