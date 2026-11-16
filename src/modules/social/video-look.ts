import { z } from 'zod';
import {
  BACKDROPS,
  DECOS,
  SCHEMES,
  TYPES,
  type Backdrop,
  type Scheme,
  type SocialTone,
  type TypeKey,
} from './look';
import { seeded } from './seeded';

/**
 * A short video's look (ADR 0061): like a poster's look (ADR 0058) it is put together from independent
 * parts, each one deterministic from a seed, so the same look always plays the same video:
 *
 * - kind: what the video says (one dish shown big, "this or that?", "1 is good, 2 is better", a menu
 *   carousel, a ring of plates, a search that finds the dishes, a real offer). The kind fits the number of
 *   dishes (1, 2 or 3) and whether the restaurant made a real offer.
 * - the poster parts that carry over: colour scheme, display typeface, background, decorations.
 * - motion: how the hook's words come in, how a dish enters, how one scene cuts to the next, the stage the
 *   dishes stand on, an ambient effect, and how the logo closes the video.
 *
 * Pure (no server imports), so a live preview can resolve looks in the browser.
 */
export const VIDEO_KINDS = [
  'showcase',
  'versus',
  'combo',
  'carousel',
  'ring',
  'search',
  'offer',
] as const;
export type VideoKind = (typeof VIDEO_KINDS)[number];

/** How the hook's words arrive. */
export const HOOK_MOTIONS = ['pop', 'type', 'slam', 'split', 'rise'] as const;
export type HookMotion = (typeof HOOK_MOTIONS)[number];

/** How a dish enters. */
export const ENTERS = ['rise', 'spin', 'drop', 'zoom', 'swing'] as const;
export type Enter = (typeof ENTERS)[number];

/** How one scene gives way to the next. */
export const CUTS = ['wipe', 'iris', 'push', 'whip', 'tear', 'flash'] as const;
export type Cut = (typeof CUTS)[number];

/** What the dishes stand on. */
export const STAGES = ['plain', 'diagonal', 'band', 'table', 'torn', 'spotlight'] as const;
export type Stage = (typeof STAGES)[number];

/** A gentle effect over the whole video. */
export const AMBIENTS = ['none', 'drift', 'bokeh', 'sparkle'] as const;
export type Ambient = (typeof AMBIENTS)[number];

/** How the logo closes the video. */
export const OUTROS = ['reveal', 'stamp', 'card'] as const;
export type Outro = (typeof OUTROS)[number];

export const VideoLookSchema = z
  .object({
    v: z.literal(1),
    kind: z.enum(VIDEO_KINDS),
    scheme: z.enum(SCHEMES),
    type: z.enum(TYPES),
    backdrop: z.enum(BACKDROPS),
    deco: z.enum(DECOS),
    hook: z.enum(HOOK_MOTIONS),
    /** The hook plays over the first dish's photo, blurred and dark, instead of the stage. */
    hookOnPhoto: z.boolean(),
    enter: z.enum(ENTERS),
    cut: z.enum(CUTS),
    stage: z.enum(STAGES),
    ambient: z.enum(AMBIENTS),
    /** Steam rises from the dish (hot food). */
    steam: z.boolean(),
    outro: z.enum(OUTROS),
    seed: z.number().int().min(0).max(2_147_483_647),
  })
  .strict();
export type VideoLook = z.infer<typeof VideoLookSchema>;

/** What the restaurant has for this video. */
export interface VideoContext {
  tone: SocialTone;
  /** 1, 2 or 3 dishes. */
  dishes: number;
  /** The first dish has a real offer the owner made (an old and a new menu price). */
  offer: boolean;
  /** The dish is served hot (steam suits it). */
  hot: boolean;
}

/** Which kinds fit this many dishes; an offer video needs a real offer. */
export function kindsFor(ctx: VideoContext): VideoKind[] {
  if (ctx.dishes <= 1) return ctx.offer ? ['showcase', 'offer'] : ['showcase'];
  if (ctx.dishes === 2) return ['versus', 'combo', 'search'];
  return ['carousel', 'ring', 'search'];
}

// Weights are [friendly, premium, fun].
type W = readonly [number, number, number];
const TONE: Record<SocialTone, 0 | 1 | 2> = { friendly: 0, premium: 1, fun: 2 };

const SCHEME_W: Record<Scheme, W> = {
  brand: [3, 2, 3],
  accent: [2, 1, 3],
  paper: [2, 2, 1],
  tint: [2, 1, 2],
  night: [1, 3, 1],
  mono: [1, 2, 1],
  kraft: [2, 2, 1],
  chalk: [1, 2, 1],
};
const TYPE_W: Record<TypeKey, W> = {
  anton: [2, 1, 3],
  bebas: [2, 1, 2],
  oswald: [2, 1, 2],
  archivo: [2, 1, 3],
  bungee: [1, 0, 3],
  righteous: [2, 0, 2],
  shrikhand: [1, 0, 3],
  lobster: [2, 1, 2],
  pacifico: [1, 0, 2],
  playfair: [1, 3, 0],
  dmserif: [1, 3, 0],
  abril: [1, 2, 1],
  fraunces: [1, 3, 0],
  poppins: [3, 1, 2],
  caveat: [1, 0, 2],
};
const HOOK_W: Record<HookMotion, W> = {
  pop: [3, 0, 3],
  type: [2, 3, 1],
  slam: [2, 1, 3],
  split: [2, 1, 2],
  rise: [2, 3, 1],
};
const ENTER_W: Record<Enter, W> = {
  rise: [3, 3, 1],
  spin: [2, 1, 3],
  drop: [2, 0, 3],
  zoom: [2, 3, 2],
  swing: [2, 1, 2],
};
const CUT_W: Record<Cut, W> = {
  wipe: [3, 1, 3],
  iris: [2, 3, 2],
  push: [2, 3, 1],
  whip: [2, 1, 3],
  tear: [2, 1, 2],
  flash: [1, 2, 2],
};
const STAGE_W: Record<Stage, W> = {
  plain: [2, 2, 2],
  diagonal: [3, 1, 3],
  band: [3, 1, 3],
  table: [2, 2, 1],
  torn: [2, 1, 2],
  spotlight: [1, 3, 1],
};
const AMBIENT_W: Record<Ambient, W> = {
  none: [1, 2, 1],
  drift: [2, 1, 2],
  bokeh: [2, 3, 1],
  sparkle: [2, 2, 2],
};
const OUTRO_W: Record<Outro, W> = { reveal: [3, 3, 2], stamp: [2, 1, 3], card: [2, 2, 2] };

function pick<T extends string>(
  items: readonly T[],
  weight: (t: T) => number,
  rnd: () => number,
): T {
  const weights = items.map((t) => Math.max(0, weight(t)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r < 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/** The video look for a seed (the kind given, or chosen from what fits). */
export function resolveVideoLook(seed: number, ctx: VideoContext, kind?: VideoKind): VideoLook {
  const rnd = seeded(`video:${seed}`);
  const t = TONE[ctx.tone];
  const kinds = kindsFor(ctx);
  const chosen = kind && kinds.includes(kind) ? kind : kinds[Math.floor(rnd() * kinds.length)]!;
  const stage = pick(STAGES, (s) => STAGE_W[s][t], rnd);
  // A spotlight is a dark room; the other stages use any scheme.
  const scheme = stage === 'spotlight' ? 'night' : pick(SCHEMES, (s) => SCHEME_W[s][t], rnd);
  const backdrops: readonly Backdrop[] =
    stage === 'plain' ? BACKDROPS : (['flat', 'glow', 'grain', 'dots', 'gradient'] as const);
  return {
    v: 1,
    kind: chosen,
    scheme,
    type: pick(TYPES, (k) => TYPE_W[k][t], rnd),
    backdrop: pick(backdrops, () => 1, rnd),
    deco: pick(
      DECOS.filter((d) => d !== 'steam' && d !== 'none'),
      () => 1,
      rnd,
    ),
    hook: pick(HOOK_MOTIONS, (h) => HOOK_W[h][t], rnd),
    hookOnPhoto: rnd() < 0.4,
    enter: pick(ENTERS, (e) => ENTER_W[e][t], rnd),
    cut: pick(CUTS, (c) => CUT_W[c][t], rnd),
    stage,
    ambient: pick(AMBIENTS, (a) => AMBIENT_W[a][t], rnd),
    steam: ctx.hot && rnd() < 0.6,
    outro: pick(OUTROS, (o) => OUTRO_W[o][t], rnd),
    seed: seed % 2_147_483_647,
  };
}
