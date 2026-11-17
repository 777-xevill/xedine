/**
 * Renders the Android app's shortcut icons and the Google Play feature graphics (ADR 0065).
 *
 *   node android/tools/store-graphics.mjs
 *
 * Writes public/brand/shortcut-{till,kitchen}-192.png (the long-press shortcuts) and
 * docs/play-store/graphics/feature-graphic-{en,bn}.png (1024 x 500, Play's banner above the listing).
 * The founder's three colours only (ADR 0063); fonts from Google Fonts, as on the site.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GREY = '#2b2d31';
const SILVER = '#d9dadc';
const YELLOW = '#ffc93c';

// Lucide icons (ISC licence), the same set the app's UI uses.
const ICONS = {
  // receipt-text (the plain receipt has a dollar sign; Xedine bills in the restaurant's own money).
  till: [
    'M13 16H8',
    'M14 8H8',
    'M16 12H8',
    'M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z',
  ],
  kitchen: [
    'M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z',
    'M6 17h12',
  ],
};

/** A maskable shortcut icon: grey ground, the yellow glyph inside the 40% safe circle. */
const shortcutHtml = (paths) => `<!doctype html><html><body style="margin:0">
<div style="width:192px;height:192px;background:${GREY};display:grid;place-items:center">
  <svg width="84" height="84" viewBox="0 0 24 24" fill="none" stroke="${YELLOW}" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>
</div></body></html>`;

const logo = `data:image/png;base64,${readFileSync(join(ROOT, 'public', 'brand', 'logo-chef-512.png')).toString('base64')}`;

const COPY = {
  en: {
    font: "'Inter', sans-serif",
    title: 'See where your money is leaking.',
    accent: 'Fix it from one app.',
    chips: ['Till', 'Kitchen', 'Stock', 'Menu profit', 'Social posts'],
  },
  bn: {
    font: "'Noto Sans Bengali', 'Inter', sans-serif",
    title: 'আপনার টাকা কোথায় হারাচ্ছে দেখুন।',
    accent: 'এক অ্যাপেই ঠিক করুন।',
    chips: ['ক্যাশ', 'কিচেন', 'স্টক', 'মেনুর লাভ', 'সোশ্যাল পোস্ট'],
  },
};

const featureHtml = ({ font, title, accent, chips }) => `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800&family=Noto+Sans+Bengali:wght@500;700;800&display=block" rel="stylesheet">
<style>
  body{margin:0}
  .fg{position:relative;width:1024px;height:500px;overflow:hidden;background:${GREY};font-family:${font};color:${SILVER}}
  .glow{position:absolute;inset:auto;width:620px;height:620px;left:-140px;top:-60px;border-radius:50%;
        background:radial-gradient(circle, color-mix(in srgb, ${YELLOW} 26%, transparent) 0%, transparent 62%)}
  .rim{position:absolute;inset:0;border-bottom:6px solid ${YELLOW}}
  .logo{position:absolute;left:78px;top:100px;width:300px;height:300px;border-radius:21%;
        box-shadow:0 24px 60px color-mix(in srgb, black 45%, transparent), 0 0 0 2px color-mix(in srgb, ${SILVER} 40%, transparent)}
  .text{position:absolute;left:430px;right:56px;top:96px}
  .name{font-size:76px;font-weight:800;letter-spacing:-0.03em;line-height:1;color:${SILVER}}
  .title{margin-top:26px;font-size:34px;font-weight:700;line-height:1.2;letter-spacing:-0.01em}
  .accent{margin-top:6px;font-size:34px;font-weight:800;line-height:1.2;color:${YELLOW}}
  .chips{margin-top:30px;display:flex;flex-wrap:wrap;gap:10px}
  .chip{font-size:18px;font-weight:600;padding:7px 15px;border-radius:999px;
        border:1.5px solid color-mix(in srgb, ${SILVER} 35%, transparent);color:${SILVER};
        background:color-mix(in srgb, ${SILVER} 6%, transparent)}
</style></head><body>
<div class="fg"><div class="glow"></div><div class="rim"></div>
  <img class="logo" src="${logo}" alt="">
  <div class="text">
    <div class="name">Xedine</div>
    <div class="title">${title}</div>
    <div class="accent">${accent}</div>
    <div class="chips">${chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>
  </div>
</div></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 192, height: 192 } });
  for (const [name, paths] of Object.entries(ICONS)) {
    await page.setContent(shortcutHtml(paths));
    await page.screenshot({ path: join(ROOT, 'public', 'brand', `shortcut-${name}-192.png`) });
  }
  await page.setViewportSize({ width: 1024, height: 500 });
  for (const [lang, copy] of Object.entries(COPY)) {
    await page.setContent(featureHtml(copy), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // Play wants a JPEG or a 24-bit PNG without transparency: the page is opaque, so PNG is fine.
    await page.screenshot({
      path: join(ROOT, 'docs', 'play-store', 'graphics', `feature-graphic-${lang}.png`),
      omitBackground: false,
    });
  }
  console.log('shortcut icons and feature graphics written');
} finally {
  await browser.close();
}
