/**
 * The plans shown on the home page's pricing (ADR 0064, prices from ADR 0008). The same numbers as the
 * `plans` table (pricing.test.ts reads the migration that seeds it), in poisha per branch per month.
 */
export const PRICE_CURRENCY = 'BDT';

/** Every plan starts with this many free days (`metric_billing`, migration 20261008000001). */
export const TRIAL_DAYS = 30;

export type PlanCode = 'starter' | 'growth' | 'chain';

export const PRICING_PLANS: readonly {
  code: PlanCode;
  minor: number;
  /** How many lines its list has (`landing3d.day.pricing.plans.<code>.p1…pN`). */
  points: number;
  /** The plan the section points to (the yellow button). */
  featured?: boolean;
}[] = [
  { code: 'starter', minor: 250000, points: 5 },
  { code: 'growth', minor: 450000, points: 5, featured: true },
  { code: 'chain', minor: 350000, points: 4 },
];
