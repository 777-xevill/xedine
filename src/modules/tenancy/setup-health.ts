/**
 * Setup health (docs/METRICS.md § Setup health). The rows come from metric_setup_health, which ticks each
 * step from the data; this only adds them up, so the page shows nothing the database did not say.
 *
 * - health: required steps done ÷ required steps, rounded down, so 100 means every required step is done.
 * - extras: optional steps done, shown apart and never pulling the health down.
 * - next: the first required step not done, in the order the list gives (the order a new owner works in).
 */

export const SETUP_CATEGORIES = [
  'basics',
  'menu',
  'selling',
  'costs',
  'stock',
  'team',
  'alerts',
  'customers',
  'golive',
] as const;
export type SetupCategory = (typeof SETUP_CATEGORIES)[number];

export interface SetupRow {
  category: SetupCategory;
  step: string;
  required: boolean;
  done: boolean;
  have: number;
  need: number;
}

export interface CategorySummary {
  category: SetupCategory;
  steps: SetupRow[];
  requiredDone: number;
  requiredTotal: number;
  optionalDone: number;
  optionalTotal: number;
  /** Every required step in the group is done (a group with none is complete once its extras are). */
  complete: boolean;
}

export interface SetupSummary {
  health: number;
  requiredDone: number;
  requiredTotal: number;
  optionalDone: number;
  optionalTotal: number;
  categories: CategorySummary[];
  next: SetupRow | null;
  /** Required steps still to do, in order. */
  missing: SetupRow[];
}

/** Turns the database's loose rows into typed ones, dropping a group this page does not know. */
export function parseSetupRows(data: unknown): SetupRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r: Record<string, unknown>) => {
    const category = r.category as SetupCategory;
    if (!SETUP_CATEGORIES.includes(category) || typeof r.step !== 'string') return [];
    return [
      {
        category,
        step: r.step,
        required: r.required === true,
        done: r.done === true,
        have: Number(r.have ?? 0),
        need: Number(r.need ?? 0),
      },
    ];
  });
}

export function summarizeSetup(rows: SetupRow[]): SetupSummary {
  const required = rows.filter((r) => r.required);
  const optional = rows.filter((r) => !r.required);
  const requiredDone = required.filter((r) => r.done).length;
  const missing = required.filter((r) => !r.done);
  const categories = SETUP_CATEGORIES.map((category) => {
    const steps = rows.filter((r) => r.category === category);
    const req = steps.filter((r) => r.required);
    const opt = steps.filter((r) => !r.required);
    const reqDone = req.filter((r) => r.done).length;
    const optDone = opt.filter((r) => r.done).length;
    return {
      category,
      steps,
      requiredDone: reqDone,
      requiredTotal: req.length,
      optionalDone: optDone,
      optionalTotal: opt.length,
      complete: req.length > 0 ? reqDone === req.length : optDone === opt.length,
    };
  }).filter((c) => c.steps.length > 0);
  return {
    health: required.length === 0 ? 0 : Math.floor((requiredDone * 100) / required.length),
    requiredDone,
    requiredTotal: required.length,
    optionalDone: optional.filter((r) => r.done).length,
    optionalTotal: optional.length,
    categories,
    next: missing[0] ?? null,
    missing,
  };
}

/** The page each step is done on, under /[org]/ (a path starting with / is outside the dashboard). */
export const SETUP_HREF: Record<string, string> = {
  profile: 'settings#profile',
  place: 'settings',
  tax: 'settings#tax',
  receipt: 'settings#receipt',
  branch_location: 'branch',
  menu: 'setup#menu-import',
  dish_photos: 'menu',
  food_facts: 'nutrition',
  discount_codes: 'discount-codes',
  channels: 'settings#channels',
  commissions: 'settings#channels',
  staff_pins: 'staff',
  pos_device: '/pos',
  tables: 'branch',
  recipes: 'recipes',
  ingredient_prices: 'purchases',
  fixed_costs: 'costs',
  salaries: 'costs',
  opening_count: 'stock',
  suppliers: 'purchases',
  shelf_life: 'food-safety',
  daily_checks: 'daily-checks',
  managers: 'team',
  purchaser_telegram: 'settings/telegram',
  owner_whatsapp: 'settings/telegram',
  google_review: 'table-qr',
  member_card: 'settings/member-card',
  social: 'settings/social',
  first_order: '',
};
