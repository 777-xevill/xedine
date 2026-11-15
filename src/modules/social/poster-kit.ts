/**
 * The poster designer's toolbox (ADR 0057): fonts, colour maths, text that fits itself, hand-drawn doodles
 * and the dish itself (a transparent cut-out, or the real photo in a frame when the dish could not be lifted
 * cleanly). Pure string building with no server imports, so the owner's live preview in the browser and the
 * Chromium renderer on GitHub Actions draw exactly the same poster.
 *
 * Colours come from the restaurant's settings (data). This file holds only neutral rgb() inks and a few
 * fixed food-illustration tones (leaf green, heart red), never a brand colour.
 */
import type { PosterDesign } from './schedule';

export type PosterLang = 'bn' | 'en';

export interface DishArt {
  name: string;
  /** Transparent cut-out (data: or https URL) when the dish could be lifted off its photo cleanly. */
  cutUrl: string | null;
  /** The real photo, always there: framed in a circle or card when there is no clean cut-out. */
  photoUrl: string;
  /** The menu price as printed, already formatted ("৳৩৫০"), or null when it is not shown. */
  price: string | null;
  /** The restaurant's own menu description of the dish, if it wrote one. */
  note: string | null;
}

/** Every line a design may draw. One AI call fills all of them, so switching designs needs no new call. */
export interface PosterWords {
  hook: string;
  headline: string;
  tagline: string;
  kicker: string;
  statusQ: string;
  statusA: string;
  statusB: string;
  statusC: string;
  moodTop: string;
  moodWord: MoodWord;
  moodBottom: string;
}
export const MOOD_WORDS = ['MOOD', 'FOOD', 'GOOD'] as const;
export type MoodWord = (typeof MOOD_WORDS)[number];

/** Words drawn on mock-ups (buttons on the phone, the order button), from the app's translations. */
export interface PosterLabels {
  orderNow: string;
  follow: string;
  message: string;
  callUs: string;
}

export interface PostContent {
  design: PosterDesign;
  /** The language the poster's own words are in (the caption can still carry both). */
  lang: PosterLang;
  words: PosterWords;
  cta: string;
  badge: string | null;
  restaurant: string;
  area: string | null;
  phone: string | null;
  colorMain: string;
  colorAccent: string;
  dish: DishArt;
  /** Other dishes from the same menu: the menu designs show them, the profile mock-up's grid uses their photos. */
  more: DishArt[];
  logoUrl: string | null;
  labels: PosterLabels;
}

export const POSTER_SIZE = { width: 1080, height: 1350 } as const;
export const REEL_SIZE = { width: 1080, height: 1920 } as const;
export const REEL_SECONDS = 8;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** For url('…') inside a style attribute: data and https URLs only, never a quote or bracket. */
export function cssUrl(url: string): string {
  if (!/^(data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+|https:\/\/[^'"()\s<>]+)$/.test(url))
    return 'about:blank';
  return url;
}

export function hasBangla(text: string): boolean {
  return /[ঀ-৿]/.test(text);
}

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

export type Rgb = [number, number, number];

export function rgbOf(hex: string): Rgb {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function css([r, g, b]: Rgb, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`
    : `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${alpha})`;
}

/** a → b by t (0 = a, 1 = b). */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const WHITE: Rgb = [255, 255, 255];
export const INK: Rgb = [22, 22, 30];
export const PAPER: Rgb = [250, 249, 245];

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Dark ink on a light colour, white on a dark one (WCAG relative luminance). */
export function inkOn(hex: string): string {
  return luminance(rgbOf(hex)) > 0.45 ? css(INK) : css(WHITE);
}

/** The brand colour when it reads well on `bg`, otherwise the brand colour darkened until it does. */
export function readable(color: Rgb, bg: Rgb, min = 3.2): Rgb {
  let c = color;
  for (let i = 0; i < 12 && contrast(c, bg) < min; i++)
    c = mix(c, luminance(bg) > 0.4 ? INK : WHITE, 0.18);
  return c;
}

/** Brand colours, the inks that sit on them and a few tints, worked out once per poster. */
export interface Palette {
  main: Rgb;
  accent: Rgb;
  onMain: string;
  onAccent: string;
  /** The brand colour as text on a light paper background. */
  mainOnPaper: Rgb;
  /** A dark version of the brand colour, for bands and deep backgrounds. */
  deep: Rgb;
  /** A soft light tint of the brand colour. */
  tint: Rgb;
}

export function palette(c: Pick<PostContent, 'colorMain' | 'colorAccent'>): Palette {
  const main = rgbOf(c.colorMain);
  const accent = rgbOf(c.colorAccent);
  return {
    main,
    accent,
    onMain: inkOn(c.colorMain),
    onAccent: inkOn(c.colorAccent),
    mainOnPaper: readable(main, PAPER),
    deep: luminance(main) > 0.12 ? mix(main, INK, 0.55) : main,
    tint: mix(main, WHITE, 0.82),
  };
}

// ---------------------------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------------------------

/**
 * Every family pairs a Latin face with a Bangla one, so a Bangla headline is never drawn in a fallback font.
 * Only the families a design uses are loaded.
 */
export const FONTS = {
  anton: { css: 'Anton', stack: "'Anton','Anek Bangla'", bangla: 'anek' },
  archivo: { css: 'Archivo+Black', stack: "'Archivo Black','Anek Bangla'", bangla: 'anek' },
  bebas: { css: 'Bebas+Neue', stack: "'Bebas Neue','Anek Bangla'", bangla: 'anek' },
  poppins: {
    css: 'Poppins:wght@500;600;700;800',
    stack: "'Poppins','Hind Siliguri'",
    bangla: 'hind',
  },
  playfair: {
    css: 'Playfair+Display:ital,wght@0,600;0,800;1,600;1,800',
    stack: "'Playfair Display','Noto Serif Bengali'",
    bangla: 'notoSerif',
  },
  shrikhand: { css: 'Shrikhand', stack: "'Shrikhand','Baloo Da 2'", bangla: 'baloo' },
  caveat: { css: 'Caveat:wght@600;700', stack: "'Caveat','Hind Siliguri'", bangla: 'hind' },
} as const;
const BANGLA_FONTS = {
  anek: 'Anek+Bangla:wdth,wght@75..100,500..800',
  hind: 'Hind+Siliguri:wght@500;600;700',
  notoSerif: 'Noto+Serif+Bengali:wght@600;800',
  baloo: 'Baloo+Da+2:wght@600;700;800',
} as const;
export type FontKey = keyof typeof FONTS;

export function fontsUrl(keys: readonly FontKey[]): string {
  const families = new Set<string>();
  // Poppins (every signature) and Archivo Black (the logo badge, price tags) are on every poster.
  for (const k of new Set<FontKey>([...keys, 'poppins', 'archivo'])) {
    families.add(FONTS[k].css);
    families.add(BANGLA_FONTS[FONTS[k].bangla]);
  }
  return `https://fonts.googleapis.com/css2?${[...families].map((f) => `family=${f}`).join('&')}&display=block`;
}

export function stack(key: FontKey): string {
  return `${FONTS[key].stack},sans-serif`;
}

/**
 * Text that fits its box: every element marked data-fit starts at its CSS size and shrinks until it stops
 * overflowing (its width and height must be set). Runs in the page once fonts are in; the renderer calls it
 * again before the screenshot, and body[data-ready] tells it the poster is laid out.
 */
export const FIT_SCRIPT = `<script>
window.__fit=function(){for(const el of document.querySelectorAll('[data-fit]')){let s=parseFloat(getComputedStyle(el).fontSize);const min=s*0.28;let n=0;while((el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)&&s>min&&n<80){s*=0.96;n++;el.style.fontSize=s+'px';}}document.body.dataset.ready='1';};
document.fonts.ready.then(function(){Promise.all([].slice.call(document.images).map(function(i){return i.decode().catch(function(){})})).then(window.__fit)});
</script>`;

export function page(
  size: { width: number; height: number },
  fonts: readonly FontKey[],
  bg: string,
  ink: string,
  css: string,
  body: string,
): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fontsUrl(fonts)}" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${size.width}px;height:${size.height}px;overflow:hidden}
body{position:relative;background:${bg};color:${ink};font-family:${stack('poppins')};-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.abs{position:absolute}
.up{text-transform:uppercase}
.bn{text-transform:none!important;letter-spacing:0!important;line-height:1.28!important}
.nowrap{white-space:nowrap}
.cut{position:absolute;object-fit:contain}
.photo{position:absolute;object-fit:cover}
.pill{display:inline-block;padding:18px 42px;border-radius:999px;font-weight:800;font-size:32px;letter-spacing:.5px;white-space:nowrap}
.logo{object-fit:contain}
${css}
</style></head><body>
${body}
${FIT_SCRIPT}
</body></html>`;
}

/** A line of text: escaped, and marked Bangla (looser lines, no capitals) when it is. */
export function text(
  s: string,
  cls: string,
  style: string,
  opts: { fit?: boolean; tag?: string } = {},
): string {
  const tag = opts.tag ?? 'div';
  const bn = hasBangla(s) ? ' bn' : '';
  return `<${tag} class="${cls}${bn}" style="${style}"${opts.fit === false ? '' : ' data-fit'}>${escapeHtml(s)}</${tag}>`;
}

// ---------------------------------------------------------------------------------------------
// The dish
// ---------------------------------------------------------------------------------------------

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The dish in a box. A clean cut-out stands in the box (resting on its bottom edge by default) with a soft
 * shadow; otherwise the real photo is shown as a round plate or a framed card.
 */
export function dish(
  d: DishArt,
  box: Box,
  o: {
    fallback?: 'circle' | 'card';
    rotate?: number;
    anchor?: 'bottom' | 'center' | 'top';
    shadow?: string;
    ring?: string;
    z?: number;
  } = {},
): string {
  const rot = o.rotate ? `transform:rotate(${o.rotate}deg);` : '';
  const z = o.z !== undefined ? `z-index:${o.z};` : '';
  if (d.cutUrl) {
    const shadow =
      o.shadow ??
      'drop-shadow(0 26px 30px rgb(0 0 0 / .30)) drop-shadow(0 6px 8px rgb(0 0 0 / .18))';
    return `<img class="cut" alt="" src="${cssUrl(d.cutUrl)}" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;object-position:center ${o.anchor ?? 'bottom'};filter:${shadow};${rot}${z}">`;
  }
  const ring = o.ring ?? 'rgb(255 255 255 / .95)';
  if ((o.fallback ?? 'circle') === 'circle') {
    const size = Math.min(box.width, box.height);
    const left = box.left + (box.width - size) / 2;
    const top =
      o.anchor === 'top'
        ? box.top
        : o.anchor === 'center'
          ? box.top + (box.height - size) / 2
          : box.top + box.height - size;
    return `<img class="photo" alt="" src="${cssUrl(d.photoUrl)}" style="left:${left}px;top:${top}px;width:${size}px;height:${size}px;border-radius:50%;box-shadow:0 34px 60px rgb(0 0 0 / .32),0 0 0 ${Math.round(size * 0.022)}px ${ring};${rot}${z}">`;
  }
  return `<img class="photo" alt="" src="${cssUrl(d.photoUrl)}" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;border-radius:30px;border:14px solid ${ring};box-shadow:0 34px 60px rgb(0 0 0 / .30);${rot}${z}">`;
}

/**
 * The logo, or the restaurant's initial in a round badge when there is no logo. On a brand-coloured
 * background pass `onBrand` so the badge turns white and stays visible.
 */
export function logo(
  c: PostContent,
  size: number,
  style: string,
  p: Palette,
  onBrand = false,
): string {
  if (c.logoUrl)
    return `<img class="abs logo" alt="" src="${cssUrl(c.logoUrl)}" style="height:${size}px;max-width:${size * 3}px;${style}">`;
  const initial = [...c.restaurant.trim()][0] ?? '•';
  const bg = onBrand ? css(WHITE) : css(p.main);
  const ink = onBrand ? css(readable(p.main, WHITE, 3)) : p.onMain;
  return `<div class="abs" style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:${ink};display:grid;place-items:center;font-family:${stack('archivo')};font-size:${Math.round(size * 0.48)}px;${style}">${escapeHtml(initial)}</div>`;
}

export function contactLine(c: PostContent): string {
  return [c.area, c.phone].filter((x): x is string => Boolean(x)).join('  •  ');
}

/** Restaurant name and contact, the way every design signs off. */
export function signature(
  c: PostContent,
  p: Palette,
  box: { left: number; bottom: number; width: number },
  ink: string,
  o: { align?: 'left' | 'center' | 'right'; logoSize?: number } = {},
): string {
  const align = o.align ?? 'left';
  const size = o.logoSize ?? 78;
  const justify = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
  const logoEl = c.logoUrl
    ? `<img class="logo" alt="" src="${cssUrl(c.logoUrl)}" style="height:${size}px;max-width:${size * 3}px">`
    : '';
  return `<div class="abs" style="left:${box.left}px;bottom:${box.bottom}px;width:${box.width}px;display:flex;align-items:center;justify-content:${justify};gap:20px;color:${ink};text-align:${align}">
${logoEl}<div style="min-width:0;max-width:${box.width - (c.logoUrl ? size * 2 : 0)}px">
${text(c.restaurant, 'nowrap', `font-weight:800;font-size:34px;overflow:hidden;height:46px;width:100%`)}
${contactLine(c) ? text(contactLine(c), 'nowrap', `font-size:24px;font-weight:600;opacity:.88;overflow:hidden;height:34px;width:100%`) : ''}
</div></div>`;
}

// ---------------------------------------------------------------------------------------------
// Doodles: drawn with currentColor, so the design sets their colour.
// ---------------------------------------------------------------------------------------------

export const DOODLES = {
  /** A hand-drawn arrow with a loop, ending bottom-right. */
  loopArrow: `<svg viewBox="0 0 220 260" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M70 12 C 18 70, 20 150, 70 168 C 118 186, 132 120, 96 110 C 58 100, 52 170, 110 210 C 140 230, 168 238, 196 236"/><path d="M168 212 L 198 236 L 166 252"/></svg>`,
  circle: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="7"><circle cx="50" cy="50" r="40"/></svg>`,
  checkCircle: `<svg viewBox="0 0 110 100" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M80 22 A 40 40 0 1 0 90 50"/><path d="M28 50 L 47 70 L 100 6"/></svg>`,
  sparkle: `<svg viewBox="0 0 100 100" fill="currentColor"><path d="M50 0 C 54 34 66 46 100 50 C 66 54 54 66 50 100 C 46 66 34 54 0 50 C 34 46 46 34 50 0Z"/></svg>`,
  steam: `<svg viewBox="0 0 120 140" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"><path d="M24 132 C 4 108, 44 92, 24 66 S 44 24, 26 6"/><path d="M60 126 C 40 102, 80 86, 60 60 S 80 18, 62 0"/><path d="M96 132 C 76 108, 116 92, 96 66 S 116 24, 98 6"/></svg>`,
  underline: `<svg viewBox="0 0 300 30" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"><path d="M6 20 C 80 6, 180 4, 294 14"/><path d="M40 26 C 110 16, 190 14, 260 22"/></svg>`,
  leaf: `<svg viewBox="0 0 120 60"><path d="M2 30 C 30 -6, 92 -6, 118 30 C 92 66, 30 66, 2 30Z" fill="rgb(76 160 70)"/><path d="M10 30 C 46 26, 80 26, 112 30" stroke="rgb(196 230 160)" stroke-width="3" fill="none"/></svg>`,
  leafDark: `<svg viewBox="0 0 120 60"><path d="M2 30 C 30 -6, 92 -6, 118 30 C 92 66, 30 66, 2 30Z" fill="rgb(46 120 52)"/><path d="M10 30 C 46 26, 80 26, 112 30" stroke="rgb(150 200 120)" stroke-width="3" fill="none"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="rgb(237 73 86)"><path d="M12 21s-7.5-4.6-10-9.3C.3 8.5 2.2 4.5 6 4.5c2.2 0 3.6 1.2 4.4 2.5h3.2c.8-1.3 2.2-2.5 4.4-2.5 3.8 0 5.7 4 4 7.2C19.5 16.4 12 21 12 21z" transform="translate(-0.1 0)"/></svg>`,
  comment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.7 16.3A9.5 9.5 0 1 0 17 20l4.4 1.3z" stroke-linejoin="round"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M22 3 9.2 10.1M22 3l-7 18-3.8-8.1L3 9z"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V3h14z"/></svg>`,
  dots: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
  star: `<svg viewBox="0 0 100 100" fill="currentColor"><path d="M50 4l13 31 33 3-25 22 8 33-29-18-29 18 8-33L4 38l33-3z"/></svg>`,
} as const;

export function doodle(
  name: keyof typeof DOODLES,
  box: { left: number; top: number; width: number; height?: number },
  color: string,
  extra = '',
): string {
  return `<div class="abs" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height ?? box.width}px;color:${color};${extra}">${DOODLES[name].replace('<svg ', '<svg width="100%" height="100%" ')}</div>`;
}

/** A small deterministic random sequence, so a poster looks the same every time it is drawn. */
export function seeded(seedText: string): () => number {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** A torn hole in paper: a jagged ring of points around an ellipse (SVG polygon points). */
export function tornEdge(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rnd: () => number,
): string {
  const pts: string[] = [];
  const n = 46;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.86 + rnd() * 0.22;
    pts.push(`${Math.round(cx + Math.cos(a) * rx * k)},${Math.round(cy + Math.sin(a) * ry * k)}`);
  }
  return pts.join(' ');
}
