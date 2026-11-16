/**
 * A logo's two main colours (ADR 0061), so a restaurant's posters and videos start in its own brand
 * colours as soon as the logo is uploaded. Pure: the browser passes the logo's pixels (RGBA) from a canvas.
 *
 * Transparent, near-white, near-black and grey pixels are not brand colours and are left out. The rest are
 * grouped into coarse buckets; the biggest bucket is the main colour, and the accent is the biggest one whose
 * hue is clearly different (else a darker or lighter take on the main colour). Null when the logo has no
 * colour at all (a black-and-white logo keeps the colours already set).
 */
export function logoColors(rgba: ArrayLike<number>): { main: string; accent: string } | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const a = rgba[i + 3]!;
    if (a < 160) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 240 && min > 225) continue; // white
    if (max < 28) continue; // black
    if (max - min < 28) continue; // grey
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const cell = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cell.n++;
    cell.r += r;
    cell.g += g;
    cell.b += b;
    buckets.set(key, cell);
  }
  const ranked = [...buckets.values()]
    .filter((c) => c.n >= 4)
    .sort((x, y) => y.n - x.n)
    .map((c) => [c.r / c.n, c.g / c.n, c.b / c.n] as [number, number, number]);
  if (ranked.length === 0) return null;
  const main = ranked[0]!;
  const accent =
    ranked.slice(1).find((c) => hueGap(hue(main), hue(c)) >= 40) ??
    (luma(main) > 120 ? shade(main, 0.55) : shade(main, 1.6));
  return { main: hex(main), accent: hex(accent) };
}

function hue([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function luma([r, g, b]: [number, number, number]): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function shade(c: [number, number, number], k: number): [number, number, number] {
  return c.map((v) => Math.max(0, Math.min(255, v * k))) as [number, number, number];
}

function hex(c: [number, number, number]): string {
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
