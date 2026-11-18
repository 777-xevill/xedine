import type { FeatureId } from './features';

/**
 * The plans on the home page's pricing (the founder, 2026-11-18): Starter at $19, Pro at $27 (the plan Xedine
 * sells most: all of Xedine, the strongest AI 20 times a week, the everyday AI without a limit, 5 posters and 2
 * videos a day) and Partner at $250, the most powerful: all of Pro plus the founder's team doing the work with
 * the restaurant (cinematic films, ads, a visit with a makeover plan, a website, a brand look, custom builds).
 * Starter and Pro list Xedine's big features, each with a tick or a cross. The app does not charge or enforce
 * these plans yet: the `plans` table still holds the taka plans of ADR 0008.
 */

/** Every plan starts with this many free days (`metric_billing`, migration 20261008000001). */
export const TRIAL_DAYS = 30;

/** Days in the "about N a month" next to a daily limit. */
export const DAYS_PER_MONTH = 30;

export type PlanRowId =
  | 'assistant'
  | 'deepAi'
  | 'leaks'
  | 'brief'
  | 'till'
  | 'dishProfit'
  | 'stock'
  | 'bazarChat'
  | 'posters'
  | 'videos'
  | 'forecast'
  | 'foodSafety'
  | 'branches'
  | 'tableQr'
  | 'offers'
  | 'memberCard'
  | 'deliveryApps'
  | 'doneForYou';

/** A big feature the plans list: its words are `landing3d.day.pricing.rows.<id>`. */
export type PlanRow = {
  id: PlanRowId;
  /** The A–Z features it stands for (none: not built yet, or not a page of its own). */
  features: readonly FeatureId[];
  /** Not built yet. */
  soon?: boolean;
};

/** The big features, best first; what Starter leaves out comes last. */
export const PLAN_ROWS: readonly PlanRow[] = [
  { id: 'assistant', features: ['assistant'] },
  { id: 'deepAi', features: [], soon: true },
  { id: 'leaks', features: ['leaks', 'loss'] },
  { id: 'brief', features: ['brief', 'home'] },
  { id: 'till', features: ['pos', 'offline', 'tillHelper', 'kds'] },
  { id: 'dishProfit', features: ['recipes', 'menuProfit', 'costs'] },
  { id: 'stock', features: ['stock', 'estimate', 'stockGuard', 'waste'] },
  { id: 'bazarChat', features: ['telegram', 'purchases'] },
  { id: 'posters', features: ['social', 'posters'] },
  { id: 'videos', features: ['videos', 'tiktok'] },
  { id: 'forecast', features: ['plan', 'weather'] },
  { id: 'foodSafety', features: ['foodSafety', 'dailyChecks'] },
  { id: 'branches', features: ['branches', 'benchmarks'] },
  { id: 'tableQr', features: ['tableQr', 'games', 'foodFacts'] },
  { id: 'offers', features: ['offers'] },
  { id: 'memberCard', features: ['memberCard'] },
  { id: 'deliveryApps', features: [] },
  // The Partner plan's team: crossed on Starter and Pro, so both point to it.
  { id: 'doneForYou', features: [] },
];

/** How often a plan allows something: a number a day or a week, or no limit. */
export type Limit = { n: number; per: 'day' | 'week' } | 'unlimited';

export type PlanCode = 'starter' | 'pro';

export type Plan = {
  code: PlanCode;
  /** Cents a month. */
  minor: number;
  currency: 'USD';
  /** The plan the section points to: the yellow button, the badge and the light round its edge. */
  featured?: boolean;
  /** Rows the plan does not have (a cross: a bigger plan). */
  without: ReadonlySet<PlanRowId>;
  /** The four tiles, in order; the same limits show on their rows. */
  limits: readonly { id: PlanRowId; limit: Limit }[];
};

export const PLANS: readonly Plan[] = [
  {
    code: 'starter',
    minor: 1900,
    currency: 'USD',
    // No QR code system (the table QR and what only works through it), delivery apps or member card.
    without: new Set<PlanRowId>(['tableQr', 'offers', 'memberCard', 'deliveryApps', 'doneForYou']),
    limits: [
      { id: 'assistant', limit: { n: 10, per: 'week' } },
      { id: 'deepAi', limit: { n: 3, per: 'week' } },
      { id: 'posters', limit: { n: 3, per: 'week' } },
      { id: 'videos', limit: { n: 3, per: 'week' } },
    ],
  },
  {
    code: 'pro',
    minor: 2700,
    currency: 'USD',
    featured: true,
    without: new Set<PlanRowId>(['doneForYou']),
    limits: [
      { id: 'assistant', limit: 'unlimited' },
      { id: 'deepAi', limit: { n: 20, per: 'week' } },
      // A poster is ~20 s on the GitHub runner and one AI dish picture (~110 of Cloudflare's 10,000 free
      // neurons a day, then ~$0.0012); a video ~1–2 min of runner. 5 + 2 a day costs well under $1 a month.
      { id: 'posters', limit: { n: 5, per: 'day' } },
      { id: 'videos', limit: { n: 2, per: 'day' } },
    ],
  },
];

export const limitOf = (plan: Plan, id: PlanRowId): Limit | undefined =>
  plan.limits.find((l) => l.id === id)?.limit;

export type PartnerServiceId =
  'films' | 'ads' | 'visit' | 'website' | 'brand' | 'build' | 'review' | 'deepAi';

/**
 * The most powerful plan: everything in Pro, plus the founder's team working with the restaurant every month.
 * Every deliverable is counted (the founder's brief: no unlimited promises). What the restaurant pays for itself
 * (the ad money, printing, building work, hardware) is quoted first and never hidden in the price.
 */
export const PARTNER = {
  code: 'partner',
  /** Cents a month. */
  minor: 25000,
  currency: 'USD',
  /**
   * Cinematic films made with Higgsfield, the one paid tool the founder uses. Its credits cost about $0.05 (the
   * Plus plan: 1,000 for $49); an 8-second clip with sound about 58. A ~30-second film is about four shots at
   * ~three takes each, a reel one shot at two takes: about 1,150 credits, ~$55–60 a restaurant a month.
   */
  filmsPerMonth: 1,
  reelsPerMonth: 4,
  /** The strongest AI: more than Pro's 20 a week (not built yet). */
  deepAiPerWeek: 50,
  services: [
    'films',
    'ads',
    'visit',
    'website',
    'brand',
    'build',
    'review',
    'deepAi',
  ] as const satisfies readonly PartnerServiceId[],
} as const;
