import 'server-only';
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import {
  POSTER_SIZE,
  posterHtml,
  REEL_SECONDS,
  REEL_SIZE,
  reelHtml,
  type PostContent,
} from './templates';

/**
 * Turns the poster and reel HTML into a JPEG and an MP4 (ADR 0040). A real Chromium draws them, so
 * Bangla is shaped correctly; on Vercel that is @sparticuz/chromium, on a laptop the browser at
 * CHROME_PATH. ffmpeg (ffmpeg-static) encodes the reel's frames as H.264 + silent AAC, the format
 * Instagram and Facebook Reels accept.
 */
// 24 fps keeps a reel well inside Vercel's 5-minute limit on one vCPU (30 fps took ~3 minutes).
const FPS = 24;

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  let browser: Browser;
  if (process.env.CHROME_PATH) {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--hide-scrollbars'],
    });
  } else {
    const chromium = (await import('@sparticuz/chromium')).default;
    browser = await puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    });
  }
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** Shrink a photo (in the page, with a canvas) to a JPEG whose longest side is at most `edge`. */
export async function shrinkPhoto(
  browser: Browser,
  photo: Uint8Array,
  mime: string,
  edge: number,
): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    const b64 = await page.evaluate(
      async (src: string, max: number) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]!;
      },
      dataUrl(photo, mime),
      edge,
    );
    return new Uint8Array(Buffer.from(b64, 'base64'));
  } finally {
    await page.close();
  }
}

async function open(browser: Browser, html: string, size: { width: number; height: number }) {
  const page = await browser.newPage();
  await page.setViewport({ ...size, deviceScaleFactor: 1 });
  // 'load' waits for the Google Fonts stylesheet; document.fonts.ready below waits for the font files.
  await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
  });
  return page;
}

export async function renderPoster(browser: Browser, content: PostContent): Promise<Uint8Array> {
  const page = await open(browser, posterHtml(content), POSTER_SIZE);
  try {
    return await page.screenshot({ type: 'jpeg', quality: 92 });
  } finally {
    await page.close();
  }
}

async function setFrame(page: Page, ms: number) {
  await page.evaluate((t: number) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t;
    }
  }, ms);
}

function ffmpegPath(): string {
  // ffmpeg-static exports the binary's path (null only on an unsupported platform).
  const p = ffmpegStatic as unknown as string | null;
  if (!p) throw new Error('ffmpeg_missing');
  return p;
}

export async function renderReel(browser: Browser, content: PostContent): Promise<Uint8Array> {
  const page = await open(browser, reelHtml(content), REEL_SIZE);
  const out = join(tmpdir(), `reel-${process.pid}-${Math.random().toString(36).slice(2)}.mp4`);
  try {
    const ff = spawn(
      ffmpegPath(),
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'image2pipe',
        '-framerate',
        String(FPS),
        '-c:v',
        'mjpeg',
        '-i',
        '-',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-shortest',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-profile:v',
        'high',
        '-r',
        String(FPS),
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        out,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let stderr = '';
    ff.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const done = new Promise<void>((resolve, reject) => {
      ff.on('error', reject);
      ff.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr.slice(0, 300)}`)),
      );
    });
    const frames = REEL_SECONDS * FPS;
    for (let i = 0; i < frames; i++) {
      await setFrame(page, (i * 1000) / FPS);
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 90, optimizeForSpeed: true });
      if (!ff.stdin.write(jpeg))
        await new Promise<void>((resolve) => ff.stdin.once('drain', () => resolve()));
    }
    ff.stdin.end();
    await done;
    return new Uint8Array(await readFile(out));
  } finally {
    await page.close().catch(() => undefined);
    await rm(out, { force: true });
  }
}
