/**
 * The poster designer's toolbox (ADR 0057, 0058): colour schemes worked out from the restaurant's own two
 * colours, display typefaces paired with Bangla faces, text that fits itself, backgrounds, the dish itself
 * (a transparent cut-out, or the real photo in a shape), decorations and headline effects. A layout
 * (poster-layouts.ts) places these; the look (look.ts) says which of each a poster uses.
 *
 * Pure string building with no server imports, so the owner's live preview in the browser and the Chromium
 * renderer on GitHub Actions draw exactly the same poster. Colours come from the restaurant's settings
 * (data); this file holds only neutral rgb() inks and surfaces and a few fixed food-illustration tones
 * (leaf green, chilli red, kraft paper, chalkboard), never a brand colour.
 */
import type { Backdrop, Deco, Head, Look, Plate, Scheme, TypeKey } from './look';
import { seeded } from './seeded';

export { seeded } from './seeded';

export type PosterLang = 'bn' | 'en';

export interface DishArt {
  name: string;
  /** Transparent cut-out (data: or https URL) when the dish could be lifted off its photo cleanly. */
  cutUrl: string | null;
  /** The real photo, always there: framed in a shape when there is no clean cut-out. */
  photoUrl: string;
  /** The menu price as printed, already formatted ("৳৩৫০"), or null when it is not shown. */
  price: string | null;
  /** The restaurant's own menu description of the dish, if it wrote one. */
  note: string | null;
}

/** Every line a layout may draw. One AI call fills all of them, so switching looks needs no new call. */
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
  look: Look;
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
  /** Other dishes from the same menu: the menu layouts show them, the profile mock-up's grid uses their photos. */
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

/** Capitals for English words; Bangla has none. */
export const up = (s: string) => (hasBangla(s) ? s : s.toUpperCase());

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
const KRAFT: Rgb = [206, 172, 128];
const KRAFT_INK: Rgb = [62, 40, 22];
const BOARD: Rgb = [36, 44, 41];
const CHALK: Rgb = [240, 238, 228];

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

/** White or ink, whichever reads better on `bg`. */
export function bestInk(bg: Rgb): Rgb {
  return contrast(WHITE, bg) >= contrast(INK, bg) ? WHITE : INK;
}

/** The colour when it reads well on `bg`, otherwise the colour darkened (or lightened) until it does. */
export function readable(color: Rgb, bg: Rgb, min = 3.2): Rgb {
  let c = color;
  for (let i = 0; i < 14 && contrast(c, bg) < min; i++)
    c = mix(c, luminance(bg) > 0.4 ? INK : WHITE, 0.18);
  return c;
}

/** Every colour a layout paints with, for one scheme and the restaurant's two colours. */
export interface Colors {
  /** The page is dark (white words). */
  dark: boolean;
  bg: Rgb;
  /** A second background tone: gradients, panels, blobs. */
  bg2: Rgb;
  ink: Rgb;
  muted: Rgb;
  /** The big words, and a second colour for stacked lines. */
  head: Rgb;
  head2: Rgb;
  accent: Rgb;
  onAccent: Rgb;
  /** A strong band or panel that stands out from the page, and the words on it. */
  band: Rgb;
  onBand: Rgb;
  /** A light card (frames, bubbles, tickets) and the words on it. */
  card: Rgb;
  onCard: Rgb;
  cardHead: Rgb;
  deco: Rgb;
  deco2: Rgb;
  /** The hard offset shadow of the "shadow" headline effect. */
  shadow: Rgb;
}

/** A brand colour that keeps some contrast on `bg`, else a fallback. */
function standOut(color: Rgb, bg: Rgb, min: number, fallback: Rgb): Rgb {
  return contrast(color, bg) >= min ? color : fallback;
}

export function schemeColors(scheme: Scheme, mainHex: string, accentHex: string): Colors {
  const M = rgbOf(mainHex);
  const A = rgbOf(accentHex);
  const light = (bg: Rgb, bg2: Rgb, head: Rgb, extra: Partial<Colors> = {}): Colors => {
    const accent = standOut(A, bg, 1.4, readable(M, bg, 2));
    const band = readable(M, bg, 3);
    return {
      dark: false,
      bg,
      bg2,
      ink: INK,
      muted: mix(INK, bg, 0.3),
      head,
      head2: INK,
      accent,
      onAccent: bestInk(accent),
      band,
      onBand: bestInk(band),
      card: WHITE,
      onCard: INK,
      cardHead: readable(M, WHITE, 4.5),
      deco: readable(A, bg, 1.6),
      deco2: head,
      shadow: standOut(A, head, 1.3, mix(bg, INK, 0.2)),
      ...extra,
    };
  };
  switch (scheme) {
    case 'brand': {
      const ink = bestInk(M);
      const accent = standOut(A, M, 1.5, ink);
      return {
        dark: ink === WHITE,
        bg: M,
        bg2: mix(M, INK, 0.32),
        ink,
        muted: mix(ink, M, 0.25),
        head: ink,
        head2: standOut(A, M, 3, ink),
        accent,
        onAccent: bestInk(accent),
        band: accent,
        onBand: bestInk(accent),
        card: WHITE,
        onCard: INK,
        cardHead: readable(M, WHITE, 4.5),
        deco: standOut(A, M, 1.8, ink),
        deco2: ink,
        shadow: mix(M, INK, 0.5),
      };
    }
    case 'accent': {
      const ink = bestInk(A);
      const band = standOut(M, A, 1.5, ink);
      return {
        dark: ink === WHITE,
        bg: A,
        bg2: mix(A, ink === WHITE ? INK : WHITE, 0.28),
        ink,
        muted: mix(ink, A, 0.25),
        head: readable(M, A, 3.5),
        head2: ink,
        accent: band,
        onAccent: bestInk(band),
        band,
        onBand: bestInk(band),
        card: WHITE,
        onCard: INK,
        cardHead: readable(M, WHITE, 4.5),
        deco: readable(M, A, 1.8),
        deco2: ink,
        shadow: mix(A, INK, 0.45),
      };
    }
    case 'paper':
      return light(PAPER, mix(PAPER, M, 0.08), readable(M, PAPER, 4.5));
    case 'tint': {
      const bg = mix(M, WHITE, 0.86);
      return light(bg, mix(M, WHITE, 0.7), readable(M, bg, 4.5));
    }
    case 'mono': {
      const brand = readable(M, WHITE, 3.5);
      return light(WHITE, [238, 238, 241], INK, {
        head2: brand,
        accent: brand,
        onAccent: bestInk(brand),
        band: INK,
        onBand: WHITE,
        card: [244, 244, 247],
        deco: brand,
        deco2: INK,
        shadow: standOut(A, INK, 1.3, brand),
      });
    }
    case 'kraft': {
      const head = readable(M, KRAFT, 3.2);
      return light(KRAFT, mix(KRAFT, INK, 0.1), head, {
        ink: KRAFT_INK,
        muted: mix(KRAFT_INK, KRAFT, 0.3),
        head2: KRAFT_INK,
        band: KRAFT_INK,
        onBand: PAPER,
        card: PAPER,
        deco: PAPER,
        deco2: KRAFT_INK,
        shadow: PAPER,
      });
    }
    case 'night': {
      const bg = mix(M, INK, 0.84);
      const accent = readable(A, bg, 2.2);
      const band = readable(M, bg, 2.2);
      return {
        dark: true,
        bg,
        bg2: mix(M, INK, 0.62),
        ink: WHITE,
        muted: mix(WHITE, bg, 0.3),
        head: readable(A, bg, 4.5),
        head2: WHITE,
        accent,
        onAccent: bestInk(accent),
        band,
        onBand: bestInk(band),
        card: WHITE,
        onCard: INK,
        cardHead: readable(M, WHITE, 4.5),
        deco: accent,
        deco2: WHITE,
        shadow: mix(bg, INK, 0.7),
      };
    }
    case 'chalk': {
      const accent = readable(A, BOARD, 3);
      return {
        dark: true,
        bg: BOARD,
        bg2: mix(BOARD, WHITE, 0.06),
        ink: CHALK,
        muted: mix(CHALK, BOARD, 0.3),
        head: readable(A, BOARD, 4.5),
        head2: CHALK,
        accent,
        onAccent: bestInk(accent),
        band: CHALK,
        onBand: BOARD,
        card: CHALK,
        onCard: INK,
        cardHead: readable(M, CHALK, 4.5),
        deco: CHALK,
        deco2: accent,
        shadow: INK,
      };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------------------------

const BANGLA_FONTS = {
  anek: { css: 'Anek+Bangla:wdth,wght@75..100,500..800', family: 'Anek Bangla' },
  hind: { css: 'Hind+Siliguri:wght@500;600;700', family: 'Hind Siliguri' },
  notoSerif: { css: 'Noto+Serif+Bengali:wght@600;800', family: 'Noto Serif Bengali' },
  baloo: { css: 'Baloo+Da+2:wght@600;700;800', family: 'Baloo Da 2' },
  galada: { css: 'Galada', family: 'Galada' },
  atma: { css: 'Atma:wght@500;700', family: 'Atma' },
  tiro: { css: 'Tiro+Bangla', family: 'Tiro Bangla' },
} as const;
type BanglaKey = keyof typeof BANGLA_FONTS;

export interface FontInfo {
  /** Google Fonts family spec. */
  css: string;
  family: string;
  bangla: BanglaKey;
  /** English words in capitals suit this face. */
  upper: boolean;
  /** Relative size: a condensed face can be set bigger than a wide one in the same box. */
  scale: number;
  lineHeight: number;
  weight: number;
}

/**
 * Every face pairs a Latin family with a Bangla one, so a Bangla headline is never drawn in a fallback
 * font. Only the families a poster uses are loaded.
 */
export const FONTS: Record<TypeKey, FontInfo> = {
  anton: {
    css: 'Anton',
    family: 'Anton',
    bangla: 'anek',
    upper: true,
    scale: 1,
    lineHeight: 1,
    weight: 400,
  },
  bebas: {
    css: 'Bebas+Neue',
    family: 'Bebas Neue',
    bangla: 'anek',
    upper: true,
    scale: 1.12,
    lineHeight: 0.92,
    weight: 400,
  },
  oswald: {
    css: 'Oswald:wght@600;700',
    family: 'Oswald',
    bangla: 'anek',
    upper: true,
    scale: 0.94,
    lineHeight: 1.05,
    weight: 700,
  },
  archivo: {
    css: 'Archivo+Black',
    family: 'Archivo Black',
    bangla: 'anek',
    upper: true,
    scale: 0.78,
    lineHeight: 1.02,
    weight: 400,
  },
  bungee: {
    css: 'Bungee',
    family: 'Bungee',
    bangla: 'anek',
    upper: true,
    scale: 0.72,
    lineHeight: 1.05,
    weight: 400,
  },
  righteous: {
    css: 'Righteous',
    family: 'Righteous',
    bangla: 'baloo',
    upper: false,
    scale: 0.86,
    lineHeight: 1.05,
    weight: 400,
  },
  shrikhand: {
    css: 'Shrikhand',
    family: 'Shrikhand',
    bangla: 'baloo',
    upper: false,
    scale: 0.8,
    lineHeight: 1.05,
    weight: 400,
  },
  lobster: {
    css: 'Lobster',
    family: 'Lobster',
    bangla: 'galada',
    upper: false,
    scale: 0.92,
    lineHeight: 1.1,
    weight: 400,
  },
  pacifico: {
    css: 'Pacifico',
    family: 'Pacifico',
    bangla: 'galada',
    upper: false,
    scale: 0.72,
    lineHeight: 1.32,
    weight: 400,
  },
  playfair: {
    css: 'Playfair+Display:ital,wght@0,800;1,800',
    family: 'Playfair Display',
    bangla: 'notoSerif',
    upper: false,
    scale: 0.86,
    lineHeight: 1.06,
    weight: 800,
  },
  dmserif: {
    css: 'DM+Serif+Display',
    family: 'DM Serif Display',
    bangla: 'tiro',
    upper: false,
    scale: 0.92,
    lineHeight: 1.05,
    weight: 400,
  },
  abril: {
    css: 'Abril+Fatface',
    family: 'Abril Fatface',
    bangla: 'notoSerif',
    upper: false,
    scale: 0.84,
    lineHeight: 1.06,
    weight: 400,
  },
  fraunces: {
    css: 'Fraunces:opsz,wght@9..144,800',
    family: 'Fraunces',
    bangla: 'notoSerif',
    upper: false,
    scale: 0.86,
    lineHeight: 1.05,
    weight: 800,
  },
  poppins: {
    css: 'Poppins:wght@500;600;700;800',
    family: 'Poppins',
    bangla: 'hind',
    upper: false,
    scale: 0.8,
    lineHeight: 1.1,
    weight: 800,
  },
  caveat: {
    css: 'Caveat:wght@600;700',
    family: 'Caveat',
    bangla: 'atma',
    upper: false,
    scale: 1.08,
    lineHeight: 1,
    weight: 700,
  },
};

export function fontsUrl(keys: readonly TypeKey[]): string {
  const families = new Set<string>();
  // Poppins (body text, signatures) and Archivo Black (prices, badges) are on every poster.
  for (const k of new Set<TypeKey>([...keys, 'poppins', 'archivo'])) {
    families.add(FONTS[k].css);
    families.add(BANGLA_FONTS[FONTS[k].bangla].css);
  }
  return `https://fonts.googleapis.com/css2?${[...families].map((f) => `family=${f}`).join('&')}&display=block`;
}

export function stack(key: TypeKey): string {
  return `'${FONTS[key].family}','${BANGLA_FONTS[FONTS[key].bangla].family}',sans-serif`;
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
  fonts: readonly TypeKey[],
  bg: string,
  ink: string,
  styles: string,
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
${styles}
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

/** The biggest box of the given aspect (width ÷ height) inside `box`, centred, resting on `anchor`. */
export function fitBox(box: Box, aspect: number, anchor: 'bottom' | 'center' | 'top'): Box {
  const width = Math.min(box.width, box.height * aspect);
  const height = width / aspect;
  const top =
    anchor === 'top'
      ? box.top
      : anchor === 'center'
        ? box.top + (box.height - height) / 2
        : box.top + box.height - height;
  return {
    left: Math.round(box.left + (box.width - width) / 2),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

const SOFT_SHADOW =
  'drop-shadow(0 26px 30px rgb(0 0 0 / .30)) drop-shadow(0 6px 8px rgb(0 0 0 / .18))';

/** A thick sticker edge around a cut-out (four hard shadows), then a soft shadow under it. */
function stickerEdge(color: string, w: number): string {
  return `drop-shadow(${w}px 0 0 ${color}) drop-shadow(-${w}px 0 0 ${color}) drop-shadow(0 ${w}px 0 ${color}) drop-shadow(0 -${w}px 0 ${color}) drop-shadow(0 22px 24px rgb(0 0 0 / .32))`;
}

export interface PlateOptions {
  /** Overrides the look's way of showing the dish. */
  kind?: Plate;
  anchor?: 'bottom' | 'center' | 'top';
  rotate?: number;
  z?: number;
  /** Overrides the cut-out's shadow. */
  shadow?: string;
  /** Colour of a photo's ring or frame. */
  ring?: string;
}

/**
 * The dish in a box. A clean cut-out stands in the box (resting on its bottom edge by default); without one,
 * or for the photo treatments, the real photo is shown in a circle, card, blob, arch or polaroid.
 */
export function plate(
  d: DishArt,
  box: Box,
  kind: Plate,
  c: Colors,
  rnd: () => number,
  o: PlateOptions = {},
): string {
  const anchor = o.anchor ?? 'bottom';
  const rot = o.rotate ? `transform:rotate(${o.rotate}deg);` : '';
  const z = o.z !== undefined ? `z-index:${o.z};` : '';
  const ring = o.ring ?? css(c.card, 0.96);
  const photoImg = (b: Box, style: string) =>
    `<img class="photo" alt="" src="${cssUrl(d.photoUrl)}" style="left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;${style}${rot}${z}">`;
  const circle = (thick = 0.022, ringColor = ring) => {
    const b = fitBox(box, 1, anchor);
    return photoImg(
      b,
      `border-radius:50%;box-shadow:0 34px 60px rgb(0 0 0 / .32),0 0 0 ${Math.round(b.width * thick)}px ${ringColor};`,
    );
  };
  const cutImg = (filter: string) =>
    `<img class="cut" alt="" src="${cssUrl(d.cutUrl ?? '')}" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;object-position:center ${anchor};filter:${filter};${rot}${z}">`;

  switch (kind) {
    case 'float':
      return d.cutUrl ? cutImg(o.shadow ?? SOFT_SHADOW) : circle();
    case 'sticker':
      if (d.cutUrl) return cutImg(o.shadow ?? stickerEdge(css(c.card), 9));
      return photoImg(
        fitBox(box, 1.15, anchor),
        `border-radius:34px;border:16px solid ${ring};box-shadow:0 30px 50px rgb(0 0 0 / .3);transform:rotate(${o.rotate ?? -4}deg);`,
      );
    case 'podium': {
      if (!d.cutUrl) return circle(0.05, css(c.accent));
      const disc = fitBox(
        { ...box, top: box.top + box.height * 0.12, height: box.height * 0.88 },
        1,
        'center',
      );
      return `<div class="abs" style="left:${disc.left}px;top:${disc.top}px;width:${disc.width}px;height:${disc.height}px;border-radius:50%;background:${css(c.accent)};box-shadow:inset 0 -24px 0 ${css(INK, 0.08)};${z}"></div>
${cutImg(o.shadow ?? SOFT_SHADOW)}`;
    }
    case 'circle':
      return circle();
    case 'card':
      return photoImg(
        fitBox(box, 4 / 3, anchor),
        `border-radius:28px;border:14px solid ${ring};box-shadow:0 34px 60px rgb(0 0 0 / .3);`,
      );
    case 'blob': {
      const r = () => 38 + Math.round(rnd() * 24);
      const a = r();
      const b = r();
      const e = r();
      const f = r();
      return photoImg(
        fitBox(box, 1, anchor),
        `border-radius:${a}% ${100 - a}% ${b}% ${100 - b}% / ${e}% ${f}% ${100 - f}% ${100 - e}%;box-shadow:0 34px 60px rgb(0 0 0 / .3);`,
      );
    }
    case 'arch': {
      const b = fitBox(box, 0.78, anchor);
      return photoImg(
        b,
        `border-radius:${Math.round(b.width / 2)}px ${Math.round(b.width / 2)}px 26px 26px;border:12px solid ${ring};box-shadow:0 34px 60px rgb(0 0 0 / .3);`,
      );
    }
    case 'polaroid': {
      const b = fitBox(box, 0.84, anchor);
      const pad = Math.round(b.width * 0.06);
      const inner = b.width - pad * 2;
      const tape = (left: number, angle: number) =>
        `<div class="abs" style="left:${left}px;top:-26px;width:${Math.round(b.width * 0.26)}px;height:52px;background:rgb(255 255 255 / .55);box-shadow:0 2px 6px rgb(0 0 0 / .12);transform:rotate(${angle}deg)"></div>`;
      return `<div class="abs" style="left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;background:${css(WHITE)};box-shadow:0 30px 60px rgb(0 0 0 / .32);${rot}${z}">
<img class="photo" alt="" src="${cssUrl(d.photoUrl)}" style="left:${pad}px;top:${pad}px;width:${inner}px;height:${inner}px">
${tape(Math.round(b.width * 0.08), -8)}${tape(Math.round(b.width * 0.66), 7)}
</div>`;
    }
  }
}

/** Where a polaroid's caption goes (the white strip under its photo), for the box given to plate(). */
export function polaroidCaption(box: Box, anchor: 'bottom' | 'center' | 'top' = 'bottom'): Box {
  const b = fitBox(box, 0.84, anchor);
  const pad = Math.round(b.width * 0.06);
  const photo = b.width - pad * 2;
  return {
    left: b.left + pad,
    top: b.top + pad + photo + 10,
    width: photo,
    height: b.height - photo - pad * 2 - 10,
  };
}

/**
 * The logo, or the restaurant's initial in a round badge when there is no logo. On a strong background
 * pass `onBrand` so the badge turns light and stays visible.
 */
export function logo(
  c: PostContent,
  size: number,
  style: string,
  k: Colors,
  onBrand = false,
): string {
  if (c.logoUrl)
    return `<img class="abs logo" alt="" src="${cssUrl(c.logoUrl)}" style="height:${size}px;max-width:${size * 3}px;${style}">`;
  const initial = [...c.restaurant.trim()][0] ?? '•';
  const bg = onBrand ? css(k.card) : css(k.band);
  const ink = onBrand ? css(k.cardHead) : css(k.onBand);
  return `<div class="abs" style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:${ink};display:grid;place-items:center;font-family:${stack('archivo')};font-size:${Math.round(size * 0.48)}px;${style}">${escapeHtml(initial)}</div>`;
}

export function contactLine(c: PostContent): string {
  return [c.area, c.phone].filter((x): x is string => Boolean(x)).join('  •  ');
}

/** Restaurant name and contact, the way every layout signs off. */
export function signature(
  c: PostContent,
  box: { left: number; bottom: number; width: number },
  ink: string,
  o: { align?: 'left' | 'center' | 'right'; logoSize?: number; size?: number } = {},
): string {
  const align = o.align ?? 'left';
  const size = o.logoSize ?? 78;
  const scale = o.size ?? 1;
  const justify = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
  const logoEl = c.logoUrl
    ? `<img class="logo" alt="" src="${cssUrl(c.logoUrl)}" style="height:${size}px;max-width:${size * 3}px">`
    : '';
  return `<div class="abs" style="left:${box.left}px;bottom:${box.bottom}px;width:${box.width}px;display:flex;align-items:center;justify-content:${justify};gap:20px;color:${ink};text-align:${align}">
${logoEl}<div style="min-width:0;max-width:${box.width - (c.logoUrl ? size * 2 : 0)}px">
${text(c.restaurant, 'nowrap', `font-weight:800;font-size:${Math.round(34 * scale)}px;overflow:hidden;height:${Math.round(46 * scale)}px;width:100%`)}
${contactLine(c) ? text(contactLine(c), 'nowrap', `font-size:${Math.round(24 * scale)}px;font-weight:600;opacity:.88;overflow:hidden;height:${Math.round(34 * scale)}px;width:100%`) : ''}
</div></div>`;
}

// ---------------------------------------------------------------------------------------------
// Doodles: drawn with currentColor (unless they are food), so the layout sets their colour.
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
  chilli: `<svg viewBox="0 0 140 70"><path d="M20 30 C 40 12, 90 10, 130 40 C 92 58, 46 60, 20 44 C 14 40, 14 34, 20 30Z" fill="rgb(214 38 38)"/><path d="M34 30 C 60 22, 92 24, 118 38" stroke="rgb(250 140 120)" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M22 36 C 12 30, 8 20, 14 10 C 18 18, 22 22, 28 26Z" fill="rgb(60 140 60)"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="rgb(237 73 86)"><path d="M12 21s-7.5-4.6-10-9.3C.3 8.5 2.2 4.5 6 4.5c2.2 0 3.6 1.2 4.4 2.5h3.2c.8-1.3 2.2-2.5 4.4-2.5 3.8 0 5.7 4 4 7.2C19.5 16.4 12 21 12 21z" transform="translate(-0.1 0)"/></svg>`,
  heartLine: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.3-9.3-8.7C1.1 8.3 2.9 4.6 6.4 4.6c2 0 3.3 1.1 4.1 2.3h3c.8-1.2 2.1-2.3 4.1-2.3 3.5 0 5.3 3.7 3.7 6.7C19 15.7 12 20 12 20z"/></svg>`,
  comment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.7 16.3A9.5 9.5 0 1 0 17 20l4.4 1.3z" stroke-linejoin="round"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M22 3 9.2 10.1M22 3l-7 18-3.8-8.1L3 9z"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V3h14z"/></svg>`,
  dots: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
  star: `<svg viewBox="0 0 100 100" fill="currentColor"><path d="M50 4l13 31 33 3-25 22 8 33-29-18-29 18 8-33L4 38l33-3z"/></svg>`,
  squiggle: `<svg viewBox="0 0 160 40" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"><path d="M6 24 C 24 4, 40 4, 52 20 S 82 38, 98 20 S 132 4, 154 18"/></svg>`,
  zigzag: `<svg viewBox="0 0 140 40" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 30 L 28 10 L 50 30 L 72 10 L 94 30 L 116 10 L 134 26"/></svg>`,
  spark: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"><path d="M50 8 L 50 34"/><path d="M14 30 L 32 46"/><path d="M86 30 L 68 46"/></svg>`,
  dot: `<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="9"/></svg>`,
  ring: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="3.4"><circle cx="10" cy="10" r="7.5"/></svg>`,
  /** A starburst for prices and shouts. */
  burst: `<svg viewBox="0 0 200 200" fill="currentColor"><path d="M100 0 L116 34 L152 14 L148 54 L190 52 L166 84 L200 104 L164 122 L184 158 L144 154 L144 196 L112 172 L92 200 L78 164 L40 182 L48 142 L8 140 L34 110 L0 88 L38 74 L22 36 L62 44 L66 4 L94 30Z"/></svg>`,
} as const;
export type DoodleName = keyof typeof DOODLES;

export function doodle(
  name: DoodleName,
  box: { left: number; top: number; width: number; height?: number },
  color: string,
  extra = '',
): string {
  return `<div class="abs" style="left:${Math.round(box.left)}px;top:${Math.round(box.top)}px;width:${Math.round(box.width)}px;height:${Math.round(box.height ?? box.width)}px;color:${color};${extra}">${DOODLES[name].replace('<svg ', '<svg width="100%" height="100%" ')}</div>`;
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

// ---------------------------------------------------------------------------------------------
// Backgrounds and decorations
// ---------------------------------------------------------------------------------------------

/** The page background for a backdrop: CSS for <body>, and any shapes drawn behind the layout. */
export function backdrop(
  kind: Backdrop,
  k: Colors,
  rnd: () => number,
  focus: { x: number; y: number },
  size: { width: number; height: number } = POSTER_SIZE,
): { bg: string; html: string } {
  const base = css(k.bg);
  const line = k.dark ? 'rgb(255 255 255 / .07)' : 'rgb(0 0 0 / .06)';
  const shade = (a: number) => css(k.dark ? WHITE : k.deco, a);
  const { width: W, height: H } = size;
  switch (kind) {
    case 'flat':
      return { bg: base, html: '' };
    case 'glow':
      return {
        bg: `radial-gradient(circle at ${focus.x}px ${focus.y}px,${k.dark ? 'rgb(255 255 255 / .2)' : 'rgb(255 255 255 / .62)'},transparent 62%),${base}`,
        html: '',
      };
    case 'gradient':
      return {
        bg: `linear-gradient(${150 + Math.round(rnd() * 60)}deg,${base},${css(k.bg2)})`,
        html: '',
      };
    case 'dots': {
      const s = 30 + Math.round(rnd() * 18);
      return {
        bg: `radial-gradient(${shade(0.16)} 3.2px,transparent 3.8px) 0 0/${s}px ${s}px,${base}`,
        html: '',
      };
    }
    case 'stripes':
      return {
        bg: `repeating-linear-gradient(${rnd() < 0.5 ? 45 : -45}deg,${line} 0 22px,transparent 22px 54px),${base}`,
        html: '',
      };
    case 'gingham': {
      const g = shade(0.14);
      return {
        bg: `repeating-linear-gradient(0deg,${g} 0 46px,transparent 46px 92px),repeating-linear-gradient(90deg,${g} 0 46px,transparent 46px 92px),${base}`,
        html: '',
      };
    }
    case 'rays':
      return {
        bg: `repeating-conic-gradient(from ${Math.round(rnd() * 20)}deg at ${focus.x}px ${focus.y}px,${shade(k.dark ? 0.07 : 0.12)} 0deg 7deg,transparent 7deg 15deg),${base}`,
        html: '',
      };
    case 'grid':
      return {
        bg: `linear-gradient(${line} 2px,transparent 2px) 0 0/56px 56px,linear-gradient(90deg,${line} 2px,transparent 2px) 0 0/56px 56px,${base}`,
        html: '',
      };
    case 'grain':
      return {
        bg: base,
        html: `<svg class="abs" width="${W}" height="${H}" style="left:0;top:0;opacity:${k.dark ? 0.16 : 0.22};mix-blend-mode:${k.dark ? 'screen' : 'multiply'}"><filter id="noise"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#noise)"/></svg>`,
      };
    case 'blobs': {
      const blob = (fill: string) => {
        const s = 480 + Math.round(rnd() * 340);
        const x = Math.round(rnd() * W) - s / 2;
        const y = Math.round(rnd() * H) - s / 2;
        const r = () => 36 + Math.round(rnd() * 28);
        const [a, b, e, f] = [r(), r(), r(), r()];
        return `<div class="abs" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;background:${fill};border-radius:${a}% ${100 - a}% ${b}% ${100 - b}% / ${e}% ${f}% ${100 - f}% ${100 - e}%"></div>`;
      };
      return {
        bg: base,
        html: blob(css(k.bg2, 0.9)) + blob(css(k.accent, 0.22)) + blob(css(k.bg2, 0.6)),
      };
    }
    case 'confetti': {
      const colours = [k.accent, k.head, k.deco];
      const bits = Array.from({ length: 26 }, () => {
        const x = Math.round(rnd() * W);
        const y = Math.round(rnd() * H);
        const color = css(colours[Math.floor(rnd() * colours.length)]!, 0.7);
        const r = rnd();
        if (r < 0.45)
          return doodle('dot', { left: x, top: y, width: 14 + Math.round(rnd() * 12) }, color);
        if (r < 0.75)
          return `<div class="abs" style="left:${x}px;top:${y}px;width:30px;height:10px;border-radius:5px;background:${color};transform:rotate(${Math.round(rnd() * 180)}deg)"></div>`;
        return doodle(
          'squiggle',
          { left: x, top: y, width: 70, height: 18 },
          color,
          `transform:rotate(${Math.round(rnd() * 180)}deg)`,
        );
      });
      return { bg: base, html: bits.join('') };
    }
    case 'waves': {
      const y = Math.round(H * (0.68 + rnd() * 0.12));
      const wave = (y0: number, amp: number, fill: string) =>
        `<svg class="abs" style="left:0;top:0" width="${W}" height="${H}"><path d="M0 ${y0} C ${W * 0.25} ${y0 - amp}, ${W * 0.45} ${y0 + amp}, ${W * 0.7} ${y0} S ${W} ${y0 - amp}, ${W} ${y0} L ${W} ${H} L 0 ${H} Z" fill="${fill}"/></svg>`;
      return {
        bg: base,
        html: wave(y, 70, css(k.bg2, 0.85)) + wave(y + 90, 50, css(k.accent, 0.3)),
      };
    }
    case 'halftone': {
      const corner = rnd() < 0.5 ? '100% 0' : '0 100%';
      return {
        bg: base,
        html: `<div class="abs" style="inset:0;background:radial-gradient(${shade(0.32)} 34%,transparent 37%) 0 0/24px 24px;-webkit-mask-image:radial-gradient(circle at ${corner},black,transparent 68%);mask-image:radial-gradient(circle at ${corner},black,transparent 68%)"></div>`,
      };
    }
    case 'frame':
      return {
        bg: base,
        html: `<div class="abs" style="inset:26px;border:3px solid ${css(k.head2, 0.7)}"></div><div class="abs" style="inset:40px;border:1.5px solid ${css(k.head2, 0.45)}"></div>`,
      };
  }
}

const DECO_SET: Record<
  Exclude<Deco, 'none'>,
  { names: readonly DoodleName[]; count: [number, number]; size: [number, number] }
> = {
  sparkles: { names: ['sparkle'], count: [4, 6], size: [30, 72] },
  stars: { names: ['star', 'sparkle'], count: [4, 6], size: [28, 60] },
  doodles: { names: ['squiggle', 'spark', 'zigzag', 'sparkle'], count: [3, 5], size: [60, 130] },
  leaves: { names: ['leaf', 'leafDark'], count: [4, 6], size: [64, 120] },
  confetti: { names: ['dot', 'ring', 'squiggle', 'zigzag'], count: [8, 12], size: [20, 60] },
  spice: { names: ['chilli', 'leaf', 'leafDark'], count: [3, 5], size: [70, 120] },
  hearts: { names: ['heart', 'heartLine', 'sparkle'], count: [3, 5], size: [34, 72] },
  steam: { names: ['steam'], count: [1, 2], size: [100, 150] },
};

/** The look's decorations, scattered inside the free areas a layout offers. */
export function decorate(kind: Deco, zones: readonly Box[], k: Colors, rnd: () => number): string {
  if (kind === 'none' || zones.length === 0) return '';
  const set = DECO_SET[kind];
  const n = set.count[0] + Math.floor(rnd() * (set.count[1] - set.count[0] + 1));
  const colours = [css(k.deco), css(k.deco2), css(k.deco, 0.8)];
  return Array.from({ length: n }, (_, i) => {
    const zone = zones[i % zones.length]!;
    const name = set.names[Math.floor(rnd() * set.names.length)]!;
    const size = set.size[0] + Math.round(rnd() * (set.size[1] - set.size[0]));
    const wide = name === 'squiggle' || name === 'zigzag' || name === 'underline';
    const h = name === 'chilli' || name.startsWith('leaf') ? size / 2 : wide ? size / 4 : size;
    const left = zone.left + rnd() * Math.max(0, zone.width - size);
    const top = zone.top + rnd() * Math.max(0, zone.height - h);
    const color = kind === 'steam' ? css(k.dark ? WHITE : k.muted, 0.7) : colours[i % 3]!;
    const turn = name === 'steam' ? 0 : Math.round(rnd() * 70 - 35);
    return doodle(
      name,
      { left, top, width: size, height: h },
      color,
      `transform:rotate(${turn}deg);opacity:.92`,
    );
  }).join('');
}

// ---------------------------------------------------------------------------------------------
// Style: the look applied to one post
// ---------------------------------------------------------------------------------------------

export interface HeadOptions {
  color?: Rgb;
  align?: 'left' | 'center' | 'right';
  /** Capitals for English words (default: what suits the face). */
  upper?: boolean;
  effect?: Head;
  /** Where the words sit in a box taller than they need. */
  valign?: 'top' | 'center' | 'bottom';
  /** One line only. */
  nowrap?: boolean;
  /** Extra CSS (a rotation, a z-index). */
  extra?: string;
  font?: TypeKey;
}

export interface Style {
  look: Look;
  k: Colors;
  rnd: () => number;
  font: FontInfo & { key: TypeKey; stack: string };
  /** x of a box in the mirrored layout (left-right flipped when the look is mirrored). */
  x(left: number, width: number): number;
  /** text-align in the mirrored layout. */
  align(a: 'left' | 'right' | 'center'): 'left' | 'right' | 'center';
  /** Big words in the look's typeface and headline effect. */
  head(s: string, box: Box, size: number, o?: HeadOptions): string;
  /** The dish shown the look's way (or another way for this spot). */
  plate(d: DishArt, box: Box, o?: PlateOptions): string;
  /** The look's decorations in these free areas. */
  deco(zones: readonly Box[]): string;
  /** The badge (best seller, perfect for lunch…) as a tilted sticker, as wide as its words. */
  sticker(c: PostContent, left: number, top: number, rotate?: number): string;
  /** The menu price in a round tag (or a starburst). */
  price(d: DishArt, left: number, top: number, size?: number, kind?: 'round' | 'burst'): string;
  /** A rounded button-like pill with words. */
  pill(
    words: string,
    left: number,
    top: number,
    bg: Rgb,
    ink: Rgb,
    size?: number,
    extra?: string,
  ): string;
  /** The whole page: fonts, the backdrop behind, then the layout. */
  page(
    body: string,
    o?: {
      css?: string;
      fonts?: TypeKey[];
      focus?: { x: number; y: number };
      bg?: string;
      backdrop?: boolean;
    },
  ): string;
}

function outline(color: string, w: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    parts.push(`${(Math.cos(a) * w).toFixed(1)}px ${(Math.sin(a) * w).toFixed(1)}px 0 ${color}`);
  }
  return parts.join(',');
}

export function styleOf(c: PostContent): Style {
  const look = c.look;
  const k = schemeColors(look.scheme, c.colorMain, c.colorAccent);
  const rnd = seeded(`style:${look.seed}`);
  const font = { ...FONTS[look.type], key: look.type, stack: stack(look.type) };
  const x = (left: number, width: number) =>
    look.mirror ? POSTER_SIZE.width - left - width : left;
  const align = (a: 'left' | 'right' | 'center') =>
    !look.mirror || a === 'center' ? a : a === 'left' ? 'right' : 'left';
  const s: Style = {
    look,
    k,
    rnd,
    font,
    x,
    align,
    head(words, box, size, o = {}) {
      const f = o.font ? { ...FONTS[o.font], stack: stack(o.font) } : font;
      const effect = o.effect ?? look.head;
      const color = o.color ?? k.head;
      const upper = (o.upper ?? f.upper) && !hasBangla(words);
      const shown = upper ? words.toUpperCase() : words;
      const px = Math.round(size * f.scale);
      const valign = o.valign ?? 'top';
      const flex =
        valign === 'top'
          ? ''
          : `display:flex;flex-direction:column;justify-content:safe ${valign === 'center' ? 'center' : 'flex-end'};`;
      let fx = '';
      if (effect === 'shadow') {
        const d = Math.max(3, Math.round(px * 0.045));
        fx = `text-shadow:${d}px ${d}px 0 ${css(k.shadow)};`;
      } else if (effect === 'sticker') {
        const stroke = luminance(color) > 0.4 ? css(INK) : css(WHITE);
        fx = `text-shadow:${outline(stroke, Math.max(3, Math.round(px * 0.04)))},0 ${Math.round(px * 0.06)}px ${Math.round(px * 0.1)}px rgb(0 0 0 / .25);`;
      }
      const inner =
        effect === 'highlight'
          ? `<span style="background:${css(k.accent)};color:${css(k.onAccent)};padding:0 .16em;border-radius:.1em;-webkit-box-decoration-break:clone;box-decoration-break:clone">${escapeHtml(shown)}</span>`
          : escapeHtml(shown);
      const bn = hasBangla(words) ? ' bn' : '';
      const el = `<div class="abs${o.nowrap ? ' nowrap' : ''}${bn}" data-fit style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;font-family:${f.stack};font-weight:${f.weight};font-size:${px}px;line-height:${f.lineHeight};color:${css(color)};text-align:${o.align ?? 'left'};overflow:hidden;${flex}${fx}${o.extra ?? ''}">${inner}</div>`;
      if (effect !== 'underline') return el;
      const w = Math.round(box.width * 0.62);
      const left =
        (o.align ?? 'left') === 'center'
          ? box.left + (box.width - w) / 2
          : (o.align ?? 'left') === 'right'
            ? box.left + box.width - w
            : box.left;
      return `${el}${doodle('underline', { left, top: box.top + box.height + 2, width: w, height: 34 }, css(k.accent))}`;
    },
    plate(d, box, o = {}) {
      return plate(d, box, o.kind ?? look.plate, k, rnd, o);
    },
    deco(zones) {
      return decorate(look.deco, zones, k, rnd);
    },
    sticker(post, left, top, rotate = -8) {
      if (!post.badge) return '';
      const width = Math.min(440, 64 + [...post.badge].length * 17);
      return text(
        post.badge,
        'abs nowrap',
        `left:${left}px;top:${top}px;width:${width}px;height:62px;padding:0 24px;border-radius:999px;background:${css(k.accent)};color:${css(k.onAccent)};font-weight:800;font-size:28px;text-align:center;line-height:62px;box-shadow:0 12px 26px rgb(0 0 0 / .22);transform:rotate(${rotate}deg);overflow:hidden;z-index:5`,
      );
    },
    price(d, left, top, size = 160, kind = 'round') {
      if (!d.price) return '';
      // The tag must stand out from the page: the accent when it does, else the card.
      const bg = contrast(k.accent, k.bg) >= 1.5 ? k.accent : k.card;
      const ink = bg === k.accent ? k.onAccent : k.onCard;
      const words = text(
        d.price,
        'nowrap',
        `font-family:${stack('archivo')};font-size:${Math.round(size * 0.27)}px;width:${Math.round(size * 0.8)}px;height:${Math.round(size * 0.42)}px;text-align:center;overflow:hidden;color:${css(ink)}`,
      );
      if (kind === 'burst')
        return `<div class="abs" style="left:${left}px;top:${top}px;width:${size}px;height:${size}px;transform:rotate(-10deg);filter:drop-shadow(0 12px 18px rgb(0 0 0 / .25));z-index:5">
${doodle('burst', { left: 0, top: 0, width: size }, css(bg))}
<div class="abs" style="inset:0;display:grid;place-items:center">${words}</div></div>`;
      return `<div class="abs" style="left:${left}px;top:${top}px;width:${size}px;height:${size}px;border-radius:50%;background:${css(bg)};display:grid;place-items:center;transform:rotate(-10deg);box-shadow:0 14px 30px rgb(0 0 0 / .25);z-index:5">${words}</div>`;
    },
    pill(words, left, top, bg, ink, size = 32, extra = '') {
      return `<div class="abs" style="left:${left}px;top:${top}px;${extra}"><span class="pill${hasBangla(words) ? ' bn' : ''}" style="background:${css(bg)};color:${css(ink)};font-size:${size}px">${escapeHtml(words)}</span></div>`;
    },
    page(body, o = {}) {
      const back =
        o.backdrop === false
          ? { bg: css(k.bg), html: '' }
          : backdrop(look.backdrop, k, rnd, o.focus ?? { x: 540, y: 760 });
      return page(
        POSTER_SIZE,
        [font.key, ...(o.fonts ?? [])],
        o.bg ?? back.bg,
        css(k.ink),
        o.css ?? '',
        back.html + body,
      );
    },
  };
  return s;
}
