import { FEATURES, FEATURE_GROUPS, type FeatureGroup, type FeatureId } from './features';

/**
 * The plan on the home page's pricing (the founder, 2026-11-18): one plan from $19 a month that lists every
 * feature Xedine has, each with a tick (in the plan) or a cross (needs a bigger plan, named later), and the
 * weekly limits. The bigger plans come later. The app does not charge or enforce this plan yet: the `plans`
 * table still holds the taka plans of ADR 0008.
 */
export const PLAN_PRICE = { minor: 1900, currency: 'USD' } as const;

/** Every plan starts with this many free days (`metric_billing`, migration 20261008000001). */
export const TRIAL_DAYS = 30;

/** Rows the plan lists that are not a feature of their own on the A–Z list. */
export type ExtraRow = 'deliveryChannels' | 'deepAi';
export type PlanRowId = FeatureId | ExtraRow;

/**
 * Not in the $19 plan: the QR code system (the table QR and what only works through it: games at the table,
 * food facts on the table menu, offer notifications the customer allows on the table page), delivery apps
 * like foodpanda, and the member card.
 */
export const NOT_IN_PLAN: ReadonlySet<PlanRowId> = new Set<PlanRowId>([
  'tableQr',
  'games',
  'foodFacts',
  'offers',
  'memberCard',
  'deliveryChannels',
]);

/** How many times a week the plan allows each one (`soon`: not built yet). */
export const WEEKLY_LIMITS: readonly { id: PlanRowId; perWeek: number; soon?: boolean }[] = [
  { id: 'posters', perWeek: 3 },
  { id: 'videos', perWeek: 3 },
  { id: 'assistant', perWeek: 10 },
  { id: 'deepAi', perWeek: 3, soon: true },
];

/** Where the extra rows sit: right after this feature. */
const EXTRA_AFTER: Record<ExtraRow, { after: FeatureId; group: FeatureGroup }> = {
  deliveryChannels: { after: 'offline', group: 'daily' },
  deepAi: { after: 'assistant', group: 'daily' },
};

export type PlanRow = {
  id: PlanRowId;
  group: FeatureGroup;
  included: boolean;
  perWeek?: number;
  soon?: boolean;
};

/** Every row in A–Z order, with the extra rows in place: what the plan card shows. */
export const PLAN_ROWS: readonly PlanRow[] = (() => {
  const rows: PlanRow[] = [];
  const row = (id: PlanRowId, group: FeatureGroup): PlanRow => {
    const limit = WEEKLY_LIMITS.find((l) => l.id === id);
    return {
      id,
      group,
      included: !NOT_IN_PLAN.has(id),
      ...(limit ? { perWeek: limit.perWeek, ...(limit.soon ? { soon: true } : {}) } : {}),
    };
  };
  for (const g of FEATURE_GROUPS) {
    for (const f of FEATURES.filter((x) => x.group === g)) {
      rows.push(row(f.id, g));
      for (const [extra, at] of Object.entries(EXTRA_AFTER) as [
        ExtraRow,
        (typeof EXTRA_AFTER)[ExtraRow],
      ][]) {
        if (at.after === f.id) rows.push(row(extra, at.group));
      }
    }
  }
  return rows;
})();
