import { describe, expect, it } from 'vitest';
import { buildNavigation, FEATURE_KEYS, FEATURE_LINKS, parseFeatures } from './navigation';

const keys = (links: { key: string }[]) => links.map((l) => l.key);

describe('navigation (ADR 0024)', () => {
  it('an owner with nothing switched on sees only the core sections', () => {
    const nav = buildNavigation({ slug: 'demo', roles: ['owner'], enabled: [] });
    expect(keys(nav.core)).toEqual(['home', 'stock', 'sales', 'leaks', 'menu']);
    expect(nav.more).toEqual([]);
    expect(keys(nav.apps)).toEqual(['pos', 'kds']);
    expect(nav.canChat).toBe(true);
    expect(nav.core[0]).toEqual({ key: 'home', href: '/demo', exact: true });
  });

  it('switching a feature on adds its links, still filtered by role', () => {
    const owner = buildNavigation({
      slug: 'd',
      roles: ['owner'],
      enabled: ['recipes', 'customers'],
    });
    expect(keys(owner.more)).toEqual(['recipes', 'menuProfit', 'customers', 'campaigns', 'growth']);
    // Menu profit shows money: a manager never gets the link, even with the feature on.
    const manager = buildNavigation({ slug: 'd', roles: ['manager'], enabled: ['recipes'] });
    expect(keys(manager.more)).toEqual(['recipes']);
  });

  it('a module that is a role’s whole job stays in that role’s core list', () => {
    const purchaser = buildNavigation({ slug: 'd', roles: ['purchaser'], enabled: [] });
    expect(keys(purchaser.core)).toEqual(['home', 'stock', 'purchases', 'plan']);
    expect(purchaser.canChat).toBe(false);
    expect(purchaser.apps).toEqual([]);
    const kitchen = buildNavigation({ slug: 'd', roles: ['kitchen'], enabled: ['planning'] });
    expect(keys(kitchen.core)).toEqual(['home', 'stock', 'recipes', 'plan']);
    expect(kitchen.more).toEqual([]);
  });

  it('money sections never appear for roles that cannot see money', () => {
    for (const role of ['manager', 'cashier', 'kitchen', 'purchaser'] as const) {
      const nav = buildNavigation({ slug: 'd', roles: [role], enabled: [...FEATURE_KEYS] });
      const all = keys([...nav.core, ...nav.more, ...nav.settings]);
      for (const money of ['leaks', 'menuProfit', 'benchmarks', 'billing', 'costs'])
        expect(all, `${role} → ${money}`).not.toContain(money);
    }
  });

  it('owner-only settings stay owner-only', () => {
    const manager = buildNavigation({ slug: 'd', roles: ['manager'], enabled: [] });
    expect(keys(manager.settings)).toEqual(['staff', 'branchSetup']);
    const cashier = buildNavigation({ slug: 'd', roles: ['cashier'], enabled: [] });
    expect(cashier.settings).toEqual([]);
  });

  it('every feature switch turns on at least one link, and unknown values are dropped', () => {
    for (const f of FEATURE_KEYS) expect(FEATURE_LINKS[f].length, f).toBeGreaterThan(0);
    expect(parseFeatures(['reviews', 'nope', 42])).toEqual(['reviews']);
    expect(parseFeatures(null)).toEqual([]);
  });
});
