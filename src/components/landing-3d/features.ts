/**
 * Everything Xedine does, A to Z (ADR 0064: "show them full a to z our features"). Each feature names the
 * code that is it (`source`, checked to exist by features.test.ts) and the story beats that show it, so the
 * landing page can never show a feature Xedine doesn't have, nor leave one out. Names and one-line
 * descriptions are messages (`landing3d.features.<id>.name|line`).
 */

export const FEATURE_GROUPS = ['daily', 'money', 'customers', 'team'] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

export type Feature = { id: string; group: FeatureGroup; source: string };

const page = (p: string) => `src/app/(dashboard)/[org]/(pages)/${p}/page.tsx`;

export const FEATURES = [
  // Every day
  { id: 'home', group: 'daily', source: 'src/app/(dashboard)/[org]/(pages)/page.tsx' },
  { id: 'assistant', group: 'daily', source: 'src/app/(dashboard)/[org]/assistant/page.tsx' },
  { id: 'brief', group: 'daily', source: 'src/modules/briefs/jobs/briefs.ts' },
  { id: 'pos', group: 'daily', source: 'src/modules/pos/PosApp.tsx' },
  { id: 'offline', group: 'daily', source: 'src/modules/pos/outbox.ts' },
  { id: 'tillHelper', group: 'daily', source: 'src/modules/pos/cashier-helper.tsx' },
  { id: 'kds', group: 'daily', source: 'src/modules/kds/KdsApp.tsx' },
  { id: 'recipes', group: 'daily', source: page('recipes') },
  { id: 'stock', group: 'daily', source: page('stock') },
  { id: 'stockGuard', group: 'daily', source: 'src/modules/inventory/guard.ts' },
  { id: 'estimate', group: 'daily', source: 'src/modules/inventory/simple.ts' },
  { id: 'purchases', group: 'daily', source: page('purchases') },
  { id: 'telegram', group: 'daily', source: page('settings/telegram') },
  { id: 'waste', group: 'daily', source: 'src/modules/kds/WasteDialog.tsx' },
  { id: 'loss', group: 'daily', source: 'src/modules/inventory/actions.ts' },
  { id: 'foodSafety', group: 'daily', source: page('food-safety') },
  { id: 'dailyChecks', group: 'daily', source: page('daily-checks') },
  { id: 'plan', group: 'daily', source: page('plan') },
  { id: 'weather', group: 'daily', source: 'src/modules/forecasting/jobs/weather.ts' },
  { id: 'menu', group: 'daily', source: page('menu') },
  // Money
  { id: 'sales', group: 'money', source: page('sales') },
  { id: 'leaks', group: 'money', source: page('leaks') },
  { id: 'menuProfit', group: 'money', source: page('menu-profit') },
  { id: 'costs', group: 'money', source: page('costs') },
  {
    id: 'moneyVisibility',
    group: 'money',
    source: 'supabase/migrations/20260922000001_foundation.sql',
  },
  { id: 'approvals', group: 'money', source: 'src/modules/pos/dialogs.tsx' },
  { id: 'discountCodes', group: 'money', source: page('discount-codes') },
  { id: 'tax', group: 'money', source: 'src/modules/tenancy/tax-label.ts' },
  { id: 'audit', group: 'money', source: 'supabase/migrations/20260922000002_tenancy_ops.sql' },
  { id: 'compliance', group: 'money', source: page('compliance') },
  { id: 'benchmarks', group: 'money', source: page('benchmarks') },
  { id: 'branches', group: 'money', source: page('branches') },
  { id: 'newBranch', group: 'money', source: page('branch') },
  // Customers
  { id: 'tableQr', group: 'customers', source: 'src/app/(qr)/t/[token]/page.tsx' },
  { id: 'foodFacts', group: 'customers', source: page('nutrition') },
  { id: 'memberCard', group: 'customers', source: page('settings/member-card') },
  { id: 'games', group: 'customers', source: 'src/app/(qr)/t/[token]/games/page.tsx' },
  { id: 'offers', group: 'customers', source: page('campaigns') },
  { id: 'customers', group: 'customers', source: page('customers') },
  { id: 'privacy', group: 'customers', source: 'src/modules/customers/member-actions.ts' },
  { id: 'reviews', group: 'customers', source: page('complaints') },
  { id: 'social', group: 'customers', source: page('growth') },
  { id: 'posters', group: 'customers', source: 'src/modules/social/poster-layouts.ts' },
  { id: 'videos', group: 'customers', source: 'src/modules/social/video.ts' },
  { id: 'tiktok', group: 'customers', source: 'src/modules/social/tiktok.ts' },
  // Your team and your set-up
  { id: 'staffRecords', group: 'team', source: page('staff/records') },
  { id: 'team', group: 'team', source: page('team') },
  { id: 'staffPins', group: 'team', source: page('staff') },
  { id: 'draftApprove', group: 'team', source: 'src/modules/forecasting/actions.ts' },
  { id: 'assistantRules', group: 'team', source: page('settings/assistant') },
  { id: 'switches', group: 'team', source: page('settings/features') },
  { id: 'languages', group: 'team', source: 'src/messages/bn.json' },
  { id: 'countries', group: 'team', source: 'src/modules/social/culture.ts' },
  { id: 'signIn', group: 'team', source: 'src/app/(auth)/sign-in/page.tsx' },
  { id: 'setup', group: 'team', source: page('setup') },
  { id: 'billing', group: 'team', source: page('billing') },
] as const satisfies readonly Feature[];

export type FeatureId = (typeof FEATURES)[number]['id'];
