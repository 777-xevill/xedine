import 'server-only';
import { join } from 'node:path';

/**
 * Dish cut-outs (ADR 0057): the dish (with its plate, bowl or glass) lifted off its background, so a poster
 * can stand it on a flat colour, a band or a frame the way a designer would. BiRefNet-lite (MIT licence)
 * does it on the CPU through transformers.js + onnxruntime-node: free, no account, no quota.
 *
 * It runs only where the autopilot runs (GitHub Actions, ADR 0044) and in local scripts, never inside the web
 * app: a Cloudflare Worker cannot load the native ONNX runtime. The ~214 MB model is downloaded once into
 * SOCIAL_MODEL_DIR (cached between GitHub runs).
 */
export const CUTOUT_MODEL = 'onnx-community/BiRefNet_lite-ONNX';

/** Where the subject sits in the photo, as fractions of the width and height. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MaskStats {
  /** Share of the photo that is dish (0–1). */
  coverage: number;
  /** Share of the photo's outer edge that is dish: a plate cut off by the frame touches the edge. */
  edge: number;
  box: Box;
}

const OPAQUE = 128;

/**
 * Reads the alpha channel of an RGBA image (or a one-channel mask): how much is dish, how much of the
 * border it touches, and its bounding box. Pure, so it is unit-tested without the model.
 */
export function maskStats(
  data: ArrayLike<number>,
  width: number,
  height: number,
  channels: 1 | 4,
): MaskStats {
  const alpha = (x: number, y: number) => data[(y * width + x) * channels + (channels - 1)]!;
  let opaque = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (alpha(x, y) >= OPAQUE) {
        opaque++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  let border = 0;
  let touching = 0;
  for (let x = 0; x < width; x++)
    for (const y of height > 1 ? [0, height - 1] : [0]) {
      border++;
      if (alpha(x, y) >= OPAQUE) touching++;
    }
  for (let y = 1; y < height - 1; y++)
    for (const x of width > 1 ? [0, width - 1] : [0]) {
      border++;
      if (alpha(x, y) >= OPAQUE) touching++;
    }
  const total = width * height;
  return {
    coverage: total ? opaque / total : 0,
    edge: border ? touching / border : 0,
    box:
      maxX < 0
        ? { x: 0, y: 0, w: 0, h: 0 }
        : {
            x: minX / width,
            y: minY / height,
            w: (maxX - minX + 1) / width,
            h: (maxY - minY + 1) / height,
          },
  };
}

/**
 * A cut-out a poster can stand on its own: something was found, it is not the whole photo, and it is not
 * a close-up whose plate runs off the frame (that would show a hard straight edge). Otherwise the poster
 * shows the photo itself in a round or rounded frame.
 */
export function cutoutUsable(s: MaskStats): boolean {
  return s.coverage >= 0.06 && s.coverage <= 0.9 && s.edge <= 0.1;
}

type Segmenter = (image: unknown) => Promise<RawImageLike>;
interface RawImageLike {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  channels: number;
  crop(box: [number, number, number, number]): Promise<RawImageLike>;
  resize(width: number, height: number): Promise<RawImageLike>;
  toSharp(): {
    webp(o: { quality: number; alphaQuality: number }): { toBuffer(): Promise<Buffer> };
  };
}

let segmenter: Promise<Segmenter> | null = null;
let readImage: ((blob: Blob) => Promise<RawImageLike>) | null = null;

async function load(): Promise<Segmenter> {
  const t = await import('@huggingface/transformers');
  t.env.cacheDir = process.env.SOCIAL_MODEL_DIR ?? join(process.cwd(), '.cache', 'models');
  readImage = (blob) => t.RawImage.fromBlob(blob) as unknown as Promise<RawImageLike>;
  const pipe = await t.pipeline('background-removal', CUTOUT_MODEL, {
    dtype: 'fp32',
    // Allocate each tensor when it is needed and free it after, instead of one big pre-planned block:
    // the 1024×1024 model then fits a laptop with a few GB free, not only the 16 GB GitHub runner.
    session_options: { enableCpuMemArena: false, enableMemPattern: false },
  });
  return pipe as unknown as Segmenter;
}

export interface Cutout {
  /** Transparent WebP, trimmed to the dish with a small margin. */
  webp: Uint8Array;
  width: number;
  height: number;
  stats: MaskStats;
  usable: boolean;
}

/** Longest side of a stored cut-out: a poster never shows a dish bigger than ~900 px. */
const MAX_EDGE = 1000;

export async function cutOut(photo: Uint8Array, mime = 'image/jpeg'): Promise<Cutout> {
  segmenter ??= load();
  const run = await segmenter;
  const image = await readImage!(new Blob([new Uint8Array(photo)], { type: mime }));
  const out = await run(image);
  const stats = maskStats(out.data, out.width, out.height, out.channels === 4 ? 4 : 1);
  const usable = cutoutUsable(stats);
  // Trim to the dish plus 3% so drop shadows have room; keep the whole photo when nothing usable was found.
  let img = out;
  if (stats.box.w > 0) {
    const pad = 0.03;
    const x0 = Math.max(0, Math.floor((stats.box.x - pad) * out.width));
    const y0 = Math.max(0, Math.floor((stats.box.y - pad) * out.height));
    const x1 = Math.min(out.width - 1, Math.ceil((stats.box.x + stats.box.w + pad) * out.width));
    const y1 = Math.min(out.height - 1, Math.ceil((stats.box.y + stats.box.h + pad) * out.height));
    img = await out.crop([x0, y0, x1, y1]);
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  if (scale < 1)
    img = await img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
  const webp = await img.toSharp().webp({ quality: 88, alphaQuality: 92 }).toBuffer();
  return { webp: new Uint8Array(webp), width: img.width, height: img.height, stats, usable };
}
