import type { FeatureId } from './features';

/**
 * The plan on the home page's pricing (the founder, 2026-11-18): one plan from $19 a month. It lists Xedine's
 * big features only (not every small one on the A–Z list), each with a tick (in the plan) or a cross (needs a
 * bigger plan, named later), and the weekly limits. The app does not charge or enforce this plan yet: the
 * `plans` table still holds the taka plans of ADR 0008.
 */
export const PLAN_PRICE = { minor: 1900, currency: 'USD' } as const;

/** Every plan starts with this many free days (`metric_billing`, migration 20261008000001). */
export const TRIAL_DAYS = 30;

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
  | 'deliveryApps';

export type PlanRow = {
  /** Its words: `landing3d.day.pricing.rows.<id>`. */
  id: PlanRowId;
  /** The A–Z features it stands for (none: not built yet, or not a page of its own). */
  features: readonly FeatureId[];
  included: boolean;
  perWeek?: number;
  /** Not built yet. */
  soon?: boolean;
};

/** The big features, best first; what the plan leaves out comes last. */
export const PLAN_ROWS: readonly PlanRow[] = [
  { id: 'assistant', features: ['assistant'], included: true, perWeek: 10 },
  { id: 'deepAi', features: [], included: true, perWeek: 3, soon: true },
  { id: 'leaks', features: ['leaks', 'loss'], included: true },
  { id: 'brief', features: ['brief', 'home'], included: true },
  { id: 'till', features: ['pos', 'offline', 'tillHelper', 'kds'], included: true },
  { id: 'dishProfit', features: ['recipes', 'menuProfit', 'costs'], included: true },
  { id: 'stock', features: ['stock', 'estimate', 'stockGuard', 'waste'], included: true },
  { id: 'bazarChat', features: ['telegram', 'purchases'], included: true },
  { id: 'posters', features: ['social', 'posters'], included: true, perWeek: 3 },
  { id: 'videos', features: ['videos', 'tiktok'], included: true, perWeek: 3 },
  { id: 'forecast', features: ['plan', 'weather'], included: true },
  { id: 'foodSafety', features: ['foodSafety', 'dailyChecks'], included: true },
  { id: 'branches', features: ['branches', 'benchmarks'], included: true },
  { id: 'tableQr', features: ['tableQr', 'games', 'foodFacts'], included: false },
  { id: 'offers', features: ['offers'], included: false },
  { id: 'memberCard', features: ['memberCard'], included: false },
  { id: 'deliveryApps', features: [], included: false },
];

/** How many times a week the plan allows each one: the tiles above the list. */
export const WEEKLY_LIMITS = PLAN_ROWS.filter(
  (r): r is PlanRow & { perWeek: number } => r.perWeek !== undefined,
);
