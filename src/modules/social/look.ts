import { z } from 'zod';
import { seeded } from './seeded';

/**
 * A poster's look (ADR 0058). A poster is no longer one of a few fixed designs: it is put together from
 * independent parts — a layout (where the dish, the words and the contact go), a colour scheme worked out
 * from the restaurant's own two colours, a display typeface (each paired with a Bangla face), a background,
 * a way of showing the dish, decorations and a headline effect — plus a seed for the small random touches
 * (rotations, positions, mirroring). Thousands of combinations, each one deterministic: the same look always
 * draws the same poster, so the owner's live preview and the job's render agree.
 *
 * Pure (no server imports): the Growth preview resolves looks in the browser.
 */
export const LAYOUTS = [
  'spotlight',
  'stack',
  'corner',
  'halo',
  'cover',
  'side',
  'bubble',
  'ticket',
  'burst',
  'polaroid',
  'vintage',
  'chalkboard',
  'collage',
  'status',
  'mood',
  'giant',
  'band',
  'split',
  'frame',
  'menu',
  'breakout',
  'minimal',
] as const;
export type Layout = (typeof LAYOUTS)[number];

/** Colour schemes: how the restaurant's main and accent colours are spread over the poster. */
export const SCHEMES = [
  'brand',
  'accent',
  'paper',
  'tint',
  'night',
  'mono',
  'kraft',
  'chalk',
] as const;
export type Scheme = (typeof SCHEMES)[number];

/** Display typefaces (the Latin face; each has a Bangla partner in poster-kit's FONTS). */
export const TYPES = [
  'anton',
  'bebas',
  'oswald',
  'archivo',
  'bungee',
  'righteous',
  'shrikhand',
  'lobster',
  'pacifico',
  'playfair',
  'dmserif',
  'abril',
  'fraunces',
  'poppins',
  'caveat',
] as const;
export type TypeKey = (typeof TYPES)[number];

export const BACKDROPS = [
  'flat',
  'glow',
  'gradient',
  'dots',
  'stripes',
  'gingham',
  'rays',
  'grid',
  'grain',
  'blobs',
  'confetti',
  'waves',
  'halftone',
  'frame',
] as const;
export type Backdrop = (typeof BACKDROPS)[number];

/**
 * How the dish is shown. The first three stand the dish's cut-out on the poster (falling back to its photo
 * in a circle when the dish could not be lifted cleanly); the rest show the real photo in a shape.
 */
export const PLATES = [
  'float',
  'sticker',
  'podium',
  'circle',
  'card',
  'blob',
  'arch',
  'polaroid',
] as const;
export type Plate = (typeof PLATES)[number];
export const CUT_PLATES: readonly Plate[] = ['float', 'sticker', 'podium'];

export const DECOS = [
  'none',
  'sparkles',
  'stars',
  'doodles',
  'leaves',
  'confetti',
  'spice',
  'hearts',
  'steam',
] as const;
export type Deco = (typeof DECOS)[number];

export const HEADS = ['plain', 'shadow', 'sticker', 'highlight', 'underline'] as const;
export type Head = (typeof HEADS)[number];

export const LookSchema = z
  .object({
    v: z.literal(1),
    layout: z.enum(LAYOUTS),
    scheme: z.enum(SCHEMES),
    type: z.enum(TYPES),
    backdrop: z.enum(BACKDROPS),
    plate: z.enum(PLATES),
    deco: z.enum(DECOS),
    head: z.enum(HEADS),
    mirror: z.boolean(),
    seed: z.number().int().min(0).max(2_147_483_647),
  })
  .strict();
export type Look = z.infer<typeof LookSchema>;

export type SocialTone = 'friendly' | 'premium' | 'fun';
const TONE_INDEX: Record<SocialTone, 0 | 1 | 2> = { friendly: 0, premium: 1, fun: 2 };

/** What a layout needs from the restaurant, and which parts suit it. Weights are [friendly, premium, fun]. */
interface LayoutInfo {
  tones: readonly [number, number, number];
  /** The words must be English (the MOOD letters). */
  english?: boolean;
  /** Other dishes the layout shows besides the main one: a cut-out, just the photo, or just the name. */
  extras?: { count: number; need: 'cut' | 'photo' | 'name'; min?: number };
  schemes: readonly Scheme[];
  types: readonly TypeKey[];
  backdrops: readonly Backdrop[];
  plates: readonly Plate[];
  decos: readonly Deco[];
  heads: readonly Head[];
  /** The layout can be drawn left-right mirrored. */
  mirror?: boolean;
}

const BOLD_TYPES: readonly TypeKey[] = ['anton', 'bebas', 'oswald', 'archivo', 'bungee'];
const PLAYFUL_TYPES: readonly TypeKey[] = [
  'righteous',
  'shrikhand',
  'lobster',
  'pacifico',
  'caveat',
];
const SERIF_TYPES: readonly TypeKey[] = ['playfair', 'dmserif', 'abril', 'fraunces'];

export const LAYOUT_INFO: Record<Layout, LayoutInfo> = {
  spotlight: {
    tones: [3, 2, 2],
    schemes: ['brand', 'accent', 'night', 'tint', 'chalk', 'paper'],
    types: [...BOLD_TYPES, 'righteous', 'shrikhand', 'lobster', 'dmserif', 'poppins'],
    backdrops: [
      'glow',
      'rays',
      'dots',
      'flat',
      'confetti',
      'gingham',
      'grain',
      'halftone',
      'gradient',
    ],
    plates: ['float', 'sticker', 'podium', 'circle', 'blob'],
    decos: ['sparkles', 'stars', 'confetti', 'none', 'leaves', 'spice', 'steam'],
    heads: ['plain', 'shadow', 'sticker'],
  },
  stack: {
    tones: [2, 1, 3],
    schemes: ['brand', 'accent', 'paper', 'tint', 'night', 'mono'],
    types: BOLD_TYPES,
    backdrops: ['flat', 'grain', 'dots', 'halftone', 'gradient', 'stripes'],
    plates: ['float', 'sticker', 'circle'],
    decos: ['none', 'sparkles', 'stars'],
    heads: ['plain', 'shadow', 'sticker'],
  },
  corner: {
    tones: [3, 2, 2],
    schemes: SCHEMES,
    types: TYPES,
    backdrops: ['flat', 'gradient', 'grain', 'stripes', 'blobs', 'dots', 'waves'],
    plates: ['float', 'sticker', 'blob', 'circle'],
    decos: ['none', 'sparkles', 'leaves', 'steam', 'spice'],
    heads: ['plain', 'shadow', 'highlight', 'underline'],
    mirror: true,
  },
  halo: {
    tones: [2, 2, 2],
    schemes: ['brand', 'accent', 'paper', 'night', 'tint', 'chalk', 'kraft'],
    types: TYPES,
    backdrops: ['rays', 'flat', 'dots', 'confetti', 'grain'],
    plates: ['float', 'sticker', 'circle'],
    decos: ['sparkles', 'stars', 'none', 'confetti'],
    heads: ['plain', 'shadow', 'underline'],
  },
  cover: {
    tones: [2, 2, 2],
    schemes: ['brand', 'accent', 'tint', 'paper', 'night', 'mono'],
    types: [...BOLD_TYPES, ...SERIF_TYPES],
    backdrops: ['flat', 'glow', 'gradient', 'grain'],
    plates: ['float', 'sticker'],
    decos: ['none', 'sparkles', 'stars'],
    heads: ['plain', 'shadow'],
  },
  side: {
    tones: [2, 3, 1],
    schemes: SCHEMES,
    types: TYPES,
    backdrops: ['flat', 'grain', 'dots', 'stripes', 'gradient'],
    plates: ['float', 'sticker', 'arch', 'blob', 'circle', 'card'],
    decos: ['none', 'sparkles', 'leaves', 'steam'],
    heads: ['plain', 'highlight', 'underline'],
    mirror: true,
  },
  bubble: {
    tones: [2, 0.5, 3],
    schemes: ['tint', 'paper', 'accent', 'brand', 'mono', 'kraft'],
    types: [...PLAYFUL_TYPES, 'archivo', 'poppins'],
    backdrops: ['flat', 'dots', 'confetti', 'grain', 'gingham'],
    plates: ['float', 'sticker', 'circle', 'podium'],
    decos: ['none', 'sparkles', 'hearts', 'confetti', 'steam'],
    heads: ['plain'],
    mirror: true,
  },
  ticket: {
    tones: [2, 1, 2],
    schemes: ['brand', 'accent', 'night', 'tint', 'kraft', 'chalk'],
    types: [...BOLD_TYPES, 'dmserif', 'abril', 'righteous'],
    backdrops: ['dots', 'stripes', 'gingham', 'flat', 'grain', 'grid'],
    plates: ['float', 'sticker', 'circle'],
    decos: ['none', 'sparkles', 'stars'],
    heads: ['plain', 'shadow'],
  },
  burst: {
    tones: [1, 0, 3],
    schemes: ['accent', 'brand', 'tint'],
    types: ['bungee', 'archivo', 'anton', 'shrikhand', 'righteous'],
    backdrops: ['halftone', 'rays', 'dots', 'confetti'],
    plates: ['float', 'sticker'],
    decos: ['sparkles', 'stars', 'confetti'],
    heads: ['shadow', 'sticker'],
  },
  polaroid: {
    tones: [3, 1, 3],
    schemes: ['kraft', 'paper', 'tint', 'chalk', 'mono'],
    types: ['caveat', 'pacifico', 'lobster', 'shrikhand', 'righteous', 'dmserif'],
    backdrops: ['gingham', 'grain', 'dots', 'grid', 'flat', 'stripes'],
    plates: ['polaroid'],
    decos: ['hearts', 'doodles', 'sparkles', 'leaves'],
    heads: ['plain', 'underline'],
  },
  vintage: {
    tones: [1, 3, 1],
    schemes: ['paper', 'kraft', 'chalk', 'night', 'tint'],
    types: ['playfair', 'abril', 'dmserif', 'fraunces', 'bebas', 'oswald', 'lobster'],
    backdrops: ['grain', 'flat'],
    plates: ['circle', 'float', 'arch'],
    decos: ['stars', 'none', 'leaves'],
    heads: ['plain', 'shadow'],
  },
  chalkboard: {
    tones: [2, 1, 2],
    schemes: ['chalk', 'night'],
    types: ['caveat', 'pacifico', 'lobster', 'bebas', 'righteous'],
    backdrops: ['grain'],
    plates: ['float', 'circle', 'sticker'],
    decos: ['doodles', 'steam', 'stars', 'hearts'],
    heads: ['plain', 'underline'],
  },
  collage: {
    tones: [2, 1, 2],
    extras: { count: 3, need: 'photo', min: 1 },
    schemes: SCHEMES,
    types: TYPES,
    backdrops: ['flat'],
    plates: ['card'],
    decos: ['none', 'sparkles'],
    heads: ['plain', 'shadow', 'highlight'],
  },
  status: {
    tones: [2, 0.5, 3],
    schemes: ['paper', 'tint', 'mono', 'kraft', 'chalk'],
    types: ['archivo', 'anton', 'bebas', 'oswald', 'righteous', 'shrikhand', 'poppins', 'caveat'],
    backdrops: ['flat', 'grid', 'dots', 'grain', 'gingham'],
    plates: ['float', 'sticker', 'circle', 'podium'],
    decos: ['none'],
    heads: ['plain'],
  },
  mood: {
    tones: [1, 0, 3],
    english: true,
    extras: { count: 1, need: 'cut' },
    schemes: ['paper', 'tint', 'mono', 'kraft', 'accent'],
    types: ['archivo', 'anton', 'bungee', 'righteous', 'shrikhand', 'bebas', 'oswald'],
    backdrops: ['flat', 'dots', 'grain', 'grid'],
    plates: ['float', 'circle'],
    decos: ['none', 'sparkles'],
    heads: ['plain'],
  },
  giant: {
    tones: [2, 1, 2],
    schemes: ['tint', 'paper', 'accent', 'mono', 'kraft'],
    types: ['anton', 'bebas', 'oswald', 'archivo'],
    backdrops: ['flat', 'dots', 'grain', 'stripes'],
    plates: ['float', 'sticker', 'card'],
    decos: ['sparkles', 'stars', 'none'],
    heads: ['plain'],
    mirror: true,
  },
  band: {
    tones: [2, 1, 2],
    extras: { count: 1, need: 'cut' },
    schemes: ['mono', 'paper', 'tint', 'night', 'kraft'],
    types: ['bebas', 'anton', 'oswald', 'archivo'],
    backdrops: ['flat', 'grain', 'dots', 'grid'],
    plates: ['float', 'sticker', 'circle'],
    decos: ['none', 'sparkles'],
    heads: ['plain'],
  },
  split: {
    tones: [2, 0.5, 3],
    extras: { count: 3, need: 'name' },
    schemes: ['brand', 'accent', 'night'],
    types: ['shrikhand', 'righteous', 'lobster', 'bungee', 'archivo'],
    backdrops: ['flat', 'grain', 'dots'],
    plates: ['float', 'circle', 'sticker'],
    decos: ['leaves', 'spice', 'sparkles'],
    heads: ['plain', 'shadow'],
  },
  frame: {
    tones: [3, 2, 2],
    schemes: SCHEMES,
    types: ['anton', 'bebas', 'oswald', 'archivo', 'playfair', 'dmserif', 'righteous'],
    backdrops: ['flat'],
    plates: ['float'],
    decos: ['none', 'hearts', 'sparkles'],
    heads: ['plain'],
  },
  menu: {
    tones: [2, 2, 1],
    extras: { count: 2, need: 'cut', min: 1 },
    schemes: ['paper', 'tint', 'kraft', 'mono', 'chalk'],
    types: ['bebas', 'anton', 'oswald', 'playfair', 'dmserif', 'abril'],
    backdrops: ['flat', 'grid', 'dots', 'grain'],
    plates: ['float', 'circle', 'sticker'],
    decos: ['none'],
    heads: ['plain'],
  },
  breakout: {
    tones: [2, 1, 2],
    extras: { count: 5, need: 'photo' },
    schemes: ['night', 'brand', 'accent'],
    types: ['archivo', 'anton', 'bungee', 'righteous'],
    backdrops: ['flat'],
    plates: ['float'],
    decos: ['steam'],
    heads: ['plain'],
  },
  minimal: {
    tones: [1, 3, 0.5],
    extras: { count: 1, need: 'cut' },
    schemes: ['paper', 'mono', 'tint', 'kraft', 'night'],
    types: SERIF_TYPES,
    backdrops: ['flat', 'grain', 'frame'],
    plates: ['float', 'circle', 'arch'],
    decos: ['none', 'leaves'],
    heads: ['plain', 'underline'],
  },
};

/** How the typefaces and schemes suit each tone, [friendly, premium, fun]. */
const TYPE_TONE: Record<TypeKey, readonly [number, number, number]> = {
  anton: [3, 1, 2],
  bebas: [3, 2, 2],
  oswald: [3, 2, 1],
  archivo: [2, 1, 3],
  bungee: [1, 0.2, 3],
  righteous: [2, 0.3, 3],
  shrikhand: [1, 0.2, 3],
  lobster: [2, 1, 2],
  pacifico: [1, 0.2, 3],
  playfair: [2, 3, 1],
  dmserif: [2, 3, 1],
  abril: [1, 3, 1],
  fraunces: [1, 3, 1],
  poppins: [3, 2, 1],
  caveat: [2, 0.5, 3],
};
const SCHEME_TONE: Record<Scheme, readonly [number, number, number]> = {
  brand: [3, 1, 3],
  accent: [2, 1, 3],
  paper: [3, 3, 1],
  tint: [3, 2, 2],
  night: [1, 3, 1],
  mono: [2, 3, 1],
  kraft: [2, 2, 1],
  chalk: [1, 1, 2],
};

/** What the restaurant has for this poster. */
export interface LookContext {
  tone: SocialTone;
  /** The poster's words are English. */
  english: boolean;
  /** Other dishes with a photo the poster could show besides the main one. */
  others: number;
  /** The main dish could be lifted off its photo. */
  hasCut: boolean;
}

/** The layout can be filled by this restaurant (language, enough dishes). */
export function layoutFits(layout: Layout, ctx: LookContext): boolean {
  const info = LAYOUT_INFO[layout];
  if (info.english && !ctx.english) return false;
  if (info.extras?.min && ctx.others < info.extras.min) return false;
  return true;
}

/** A stable number for any text (a dish id, an org id and a date). */
export function seedOf(text: string): number {
  return Math.floor(seeded(text)() * 2_147_483_647);
}

function pick<T>(items: readonly T[], weight: (t: T) => number, rnd: () => number): T {
  const weights = items.map((t) => Math.max(0, weight(t)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(rnd() * items.length)]!;
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r < 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/**
 * The look for a seed. The layout is chosen by the tone (or given), the other parts from what suits the
 * layout and the tone; a dish with no clean cut-out is shown through its photo more often.
 */
export function resolveLook(seed: number, ctx: LookContext, layout?: Layout): Look {
  const rnd = seeded(`look:${seed}`);
  const t = TONE_INDEX[ctx.tone];
  const fits = LAYOUTS.filter((l) => layoutFits(l, ctx));
  const chosen = layout ?? pick(fits, (l) => LAYOUT_INFO[l].tones[t], rnd);
  const info = LAYOUT_INFO[chosen];
  const plates = ctx.hasCut ? info.plates : info.plates.filter((p) => !CUT_PLATES.includes(p));
  return {
    v: 1,
    layout: chosen,
    scheme: pick(info.schemes, (s) => SCHEME_TONE[s][t], rnd),
    type: pick(info.types, (k) => TYPE_TONE[k][t], rnd),
    backdrop: pick(info.backdrops, () => 1, rnd),
    // Cut-out plates first when the dish was lifted cleanly; they still fall back to the photo if not.
    plate: pick(plates.length ? plates : info.plates, (p) => (CUT_PLATES.includes(p) ? 2 : 1), rnd),
    deco: pick(info.decos, () => 1, rnd),
    head: pick(info.heads, () => 1, rnd),
    mirror: Boolean(info.mirror) && rnd() < 0.5,
    seed: seed % 2_147_483_647,
  };
}

/** Every layout this restaurant can fill, in an order of its own (a fixed shuffle per salt). */
function layoutOrder(ctx: LookContext, salt: number): Layout[] {
  const rnd = seeded(`order:${salt}`);
  const fits = LAYOUTS.filter((l) => layoutFits(l, ctx));
  for (let i = fits.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [fits[i], fits[j]] = [fits[j]!, fits[i]!];
  }
  return fits;
}

/**
 * A page of looks for the studio's "More designs": each page shows layouts the earlier pages did not,
 * until every layout has been shown; then they come round again in new colours, type and backgrounds.
 */
export function lookPage(page: number, count: number, ctx: LookContext, salt: number): Look[] {
  const order = layoutOrder(ctx, salt);
  return Array.from({ length: count }, (_, i) => {
    const n = page * count + i;
    return resolveLook(seedOf(`${salt}:${n}`), ctx, order[n % order.length]);
  });
}

/**
 * The autopilot's look for one post: a layout its last few posts did not use (when the restaurant can
 * fill another), the rest from the seed.
 */
export function lookForPost(key: string, ctx: LookContext, recent: readonly string[]): Look {
  const seed = seedOf(key);
  const rnd = seeded(`post:${seed}`);
  const t = TONE_INDEX[ctx.tone];
  const fits = LAYOUTS.filter((l) => layoutFits(l, ctx));
  const fresh = fits.filter((l) => !recent.includes(l));
  const layout = pick(fresh.length ? fresh : fits, (l) => LAYOUT_INFO[l].tones[t], rnd);
  return resolveLook(seed, ctx, layout);
}

/** A look the owner sent from the preview, checked; one this restaurant cannot fill is redrawn. */
export function fitLook(look: Look, ctx: LookContext): Look {
  return layoutFits(look.layout, ctx) ? look : resolveLook(look.seed, ctx);
}
