import type { IconKey } from './navigation';

const BY_SEGMENT: Record<string, IconKey> = {
  stock: 'stock',
  sales: 'sales',
  leaks: 'leaks',
  menu: 'menu',
  recipes: 'recipes',
  'menu-profit': 'menuProfit',
  purchases: 'purchases',
  plan: 'plan',
  customers: 'customers',
  campaigns: 'campaigns',
  growth: 'growth',
  reviews: 'reviews',
  branches: 'branches',
  benchmarks: 'benchmarks',
  compliance: 'compliance',
  team: 'team',
  costs: 'costs',
  billing: 'billing',
  setup: 'setup',
  branch: 'branchSetup',
  'discount-codes': 'discountCodes',
  assistant: 'chat',
};

/** Which sidebar page a URL belongs to (`nav.*` key), or null for a page with no entry of its own. */
export function pageKeyFromPath(slug: string, pathname: string): IconKey | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== slug) return null;
  const [, first, second] = parts;
  if (!first) return 'home';
  if (first === 'staff') return second === 'records' ? 'staffRecords' : 'staff';
  if (first === 'settings') {
    if (second === 'features') return 'features';
    if (second === 'assistant') return 'assistantRules';
    if (second === 'telegram') return 'telegram';
    return 'general';
  }
  return BY_SEGMENT[first] ?? null;
}
