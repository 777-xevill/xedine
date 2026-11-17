/**
 * Phone and tablet screenshots for the Google Play listing (ADR 0065), from the live site signed in as the
 * public demo owner (synthetic seed data only):
 *
 *   node android/tools/store-screenshots.mjs            # English
 *   node android/tools/store-screenshots.mjs --lang bn  # Bangla
 *
 * Phone: 360 x 640 CSS px at 3x = 1080 x 1920 (Play: 16:9, each side 320-3840 px).
 * Tablet: 1280 x 800 at 1.5x = 1920 x 1200.
 * Writes docs/play-store/graphics/{phone,tablet}-<lang>-<n>-<page>.png.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs', 'play-store', 'graphics');
const SITE = process.env.XEDINE_SITE ?? 'https://xedine.org';
const ORG = 'demo-kacchi-house';
// The public demo login (it is in the seed, ADR 0011): synthetic data, safe to show.
const EMAIL = 'owner@demo-kacchi.xedine.example';
const PASSWORD = 'demo-password-123';
const lang = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : 'en';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

// In the order they should appear on Play: the promise first. (The till and kitchen screen need a paired
// device, which would write to the database, so they are not shot here.)
const PAGES = [
  ['leaks', `/${ORG}/leaks`],
  ['assistant', `/${ORG}/assistant`],
  ['menu-profit', `/${ORG}/menu-profit`],
  ['stock', `/${ORG}/stock`],
  ['plan', `/${ORG}/plan`],
  ['sales', `/${ORG}/sales`],
  ['growth', `/${ORG}/growth`],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [kind, viewport, scale] of [
    ['phone', { width: 360, height: 640 }, 3],
    ['tablet', { width: 1280, height: 800 }, 1.5],
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: scale,
      isMobile: kind === 'phone',
      hasTouch: true,
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    });
    await context.addCookies([
      { name: 'NEXT_LOCALE', value: lang, domain: new URL(SITE).hostname, path: '/' },
    ]);
    const page = await context.newPage();
    await page.goto(`${SITE}/sign-in`, { waitUntil: 'networkidle' });
    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.click('form:has(#email) button[type=submit]');
    await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60_000 });

    let n = 0;
    for (const [name, path] of PAGES) {
      n += 1;
      if (only && only !== name) continue;
      await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle', timeout: 90_000 });
      // Let charts and the page cascade settle.
      await page.waitForTimeout(2500);
      const file = join(OUT, `${kind}-${lang}-${n}-${name}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
