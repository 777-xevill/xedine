import type { Role } from './context';

/**
 * The app's navigation model (ADR 0024). One pure function decides what each person sees, so the
 * sidebar, the settings hub and the tests agree. Hiding a link never grants or removes access —
 * pages and RLS still decide that; this only keeps the screen simple.
 *
 * - core: always in the sidebar (when the role allows).
 * - optional: off until the owner switches the feature on in Settings → Features. A link can be
 *   core for a role whose whole job it is (a purchaser always sees Purchases).
 * - settings: reached through the Settings hub, never the sidebar.
 */

export const FEATURE_KEYS = [
  'recipes',
  'purchasing',
  'planning',
  'customers',
  'reviews',
  'branches',
  'compliance',
  'staffRecords',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type IconKey =
  | 'home'
  | 'chat'
  | 'stock'
  | 'sales'
  | 'leaks'
  | 'menu'
  | 'recipes'
  | 'menuProfit'
  | 'purchases'
  | 'plan'
  | 'customers'
  | 'campaigns'
  | 'growth'
  | 'reviews'
  | 'branches'
  | 'benchmarks'
  | 'compliance'
  | 'staffRecords'
  | 'pos'
  | 'kds'
  | 'settings'
  | 'general'
  | 'features'
  | 'team'
  | 'staff'
  | 'branchSetup'
  | 'discountCodes'
  | 'costs'
  | 'billing'
  | 'setup'
  | 'assistantRules'
  | 'telegram'
  | 'social';

export interface NavLink {
  /** Also the `nav.*` message key for the label. */
  key: IconKey;
  href: string;
  /** Match only this exact path (the home page), not its children. */
  exact?: boolean;
}

interface LinkRule {
  key: IconKey;
  path: string;
  roles: Role[];
  feature?: FeatureKey;
  /** Roles for whom an optional link is core anyway. */
  coreFor?: Role[];
}

const MONEY: Role[] = ['owner', 'accountant'];
const LEADS: Role[] = ['owner', 'manager', 'accountant'];
const STOCK: Role[] = ['owner', 'manager', 'kitchen', 'purchaser', 'accountant'];

const CORE: LinkRule[] = [
  {
    key: 'home',
    path: '',
    roles: ['owner', 'manager', 'cashier', 'kitchen', 'purchaser', 'accountant'],
  },
  { key: 'stock', path: '/stock', roles: STOCK },
  // Dish ingredients (ADR 0037): stock goes down by what is written here, so it is never switched off.
  { key: 'recipes', path: '/recipes', roles: ['owner', 'manager', 'kitchen', 'accountant'] },
  { key: 'sales', path: '/sales', roles: LEADS },
  { key: 'leaks', path: '/leaks', roles: MONEY },
  { key: 'menu', path: '/menu', roles: ['owner'] },
];

const OPTIONAL: LinkRule[] = [
  { key: 'menuProfit', path: '/menu-profit', roles: MONEY, feature: 'recipes' },
  {
    key: 'purchases',
    path: '/purchases',
    roles: ['owner', 'purchaser', 'accountant'],
    feature: 'purchasing',
    coreFor: ['purchaser'],
  },
  {
    key: 'plan',
    path: '/plan',
    roles: STOCK,
    feature: 'planning',
    coreFor: ['purchaser', 'kitchen'],
  },
  { key: 'customers', path: '/customers', roles: LEADS, feature: 'customers' },
  { key: 'campaigns', path: '/campaigns', roles: ['owner', 'manager'], feature: 'customers' },
  { key: 'growth', path: '/growth', roles: ['owner', 'manager'], feature: 'customers' },
  { key: 'reviews', path: '/reviews', roles: ['owner', 'manager'], feature: 'reviews' },
  { key: 'branches', path: '/branches', roles: LEADS, feature: 'branches' },
  { key: 'benchmarks', path: '/benchmarks', roles: MONEY, feature: 'branches' },
  { key: 'compliance', path: '/compliance', roles: LEADS, feature: 'compliance' },
  { key: 'staffRecords', path: '/staff/records', roles: LEADS, feature: 'staffRecords' },
];

const SETTINGS: LinkRule[] = [
  { key: 'general', path: '/settings', roles: ['owner'] },
  { key: 'features', path: '/settings/features', roles: ['owner'] },
  { key: 'assistantRules', path: '/settings/assistant', roles: ['owner'] },
  { key: 'team', path: '/team', roles: ['owner'] },
  { key: 'telegram', path: '/settings/telegram', roles: ['owner'] },
  { key: 'social', path: '/settings/social', roles: ['owner'] },
  { key: 'staff', path: '/staff', roles: ['owner', 'manager'] },
  { key: 'branchSetup', path: '/branch', roles: ['owner', 'manager'] },
  { key: 'discountCodes', path: '/discount-codes', roles: ['owner', 'manager'] },
  { key: 'costs', path: '/costs', roles: ['owner'] },
  { key: 'billing', path: '/billing', roles: MONEY },
  { key: 'setup', path: '/setup', roles: ['owner'] },
];

/** Which features each switch turns on, for the Features page. */
export const FEATURE_LINKS: Record<FeatureKey, IconKey[]> = Object.fromEntries(
  FEATURE_KEYS.map((f) => [f, OPTIONAL.filter((l) => l.feature === f).map((l) => l.key)]),
) as Record<FeatureKey, IconKey[]>;

export function parseFeatures(value: unknown): FeatureKey[] {
  if (!Array.isArray(value)) return [];
  return FEATURE_KEYS.filter((k) => value.includes(k));
}

export interface Navigation {
  core: NavLink[];
  /** Optional modules this org switched on, in a fixed order. */
  more: NavLink[];
  /** Full-screen surfaces that leave the dashboard. */
  apps: NavLink[];
  canChat: boolean;
  settings: NavLink[];
}

/**
 * Plain-word sections for the sidebar, so the list reads as a few small groups instead of one long
 * column. Grouping only changes how links are laid out; which links exist is still decided above.
 */
export type NavSectionKey = 'top' | 'daily' | 'money' | 'customers' | 'restaurant';

const SECTION_OF: Partial<Record<IconKey, NavSectionKey>> = {
  home: 'top',
  stock: 'daily',
  recipes: 'daily',
  purchases: 'daily',
  plan: 'daily',
  sales: 'money',
  leaks: 'money',
  menuProfit: 'money',
  benchmarks: 'money',
  customers: 'customers',
  campaigns: 'customers',
  growth: 'customers',
  reviews: 'customers',
  menu: 'restaurant',
  branches: 'restaurant',
  staffRecords: 'restaurant',
  compliance: 'restaurant',
};

const SECTION_ORDER: NavSectionKey[] = ['top', 'daily', 'money', 'customers', 'restaurant'];

export function groupNavigation(links: NavLink[]): { section: NavSectionKey; links: NavLink[] }[] {
  return SECTION_ORDER.map((section) => ({
    section,
    links: links
      .filter((l) => (SECTION_OF[l.key] ?? 'restaurant') === section)
      // Keep each section in the order the model above lists them.
      .sort((a, b) => orderIndex(a.key) - orderIndex(b.key)),
  })).filter((g) => g.links.length > 0);
}

function orderIndex(key: IconKey): number {
  const i = Object.keys(SECTION_OF).indexOf(key);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

export function buildNavigation(input: {
  slug: string;
  roles: Role[];
  enabled: FeatureKey[];
}): Navigation {
  const base = `/${input.slug}`;
  const has = (roles: Role[]) => roles.some((r) => input.roles.includes(r));
  const link = (r: LinkRule): NavLink => ({
    key: r.key,
    href: `${base}${r.path}`,
    ...(r.path === '' ? { exact: true } : {}),
  });
  const coreByRole = OPTIONAL.filter((r) => has(r.roles) && r.coreFor && has(r.coreFor));
  const core = [...CORE.filter((r) => has(r.roles)), ...coreByRole].map(link);
  const more = OPTIONAL.filter(
    (r) =>
      has(r.roles) && !coreByRole.includes(r) && r.feature && input.enabled.includes(r.feature),
  ).map(link);
  const settings = SETTINGS.filter((r) => has(r.roles)).map(link);
  return {
    core,
    more,
    apps: [
      ...(has(['owner', 'manager', 'cashier']) ? [{ key: 'pos' as const, href: '/pos' }] : []),
      ...(has(['owner', 'manager', 'kitchen']) ? [{ key: 'kds' as const, href: '/kds' }] : []),
    ],
    canChat: has(LEADS),
    settings,
  };
}
