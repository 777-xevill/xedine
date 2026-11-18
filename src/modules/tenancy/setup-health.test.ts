import { describe, expect, it } from 'vitest';
import { parseSetupRows, SETUP_HREF, summarizeSetup, type SetupRow } from './setup-health';

const row = (step: string, category: SetupRow['category'], required: boolean, done: boolean) => ({
  category,
  step,
  required,
  done,
  have: done ? 1 : 0,
  need: 1,
});

describe('summarizeSetup', () => {
  const rows: SetupRow[] = [
    row('profile', 'basics', true, true),
    row('receipt', 'basics', true, false),
    row('branch_location', 'basics', false, true),
    row('menu', 'menu', true, false),
    row('member_card', 'customers', false, false),
  ];

  it('health counts required steps only, rounded down', () => {
    const s = summarizeSetup(rows);
    expect(s.health).toBe(33); // 1 of 3
    expect([s.requiredDone, s.requiredTotal]).toEqual([1, 3]);
    expect([s.optionalDone, s.optionalTotal]).toEqual([1, 2]);
  });

  it('the next step is the first required one not done, in list order', () => {
    const s = summarizeSetup(rows);
    expect(s.next?.step).toBe('receipt');
    expect(s.missing.map((r) => r.step)).toEqual(['receipt', 'menu']);
  });

  it('groups keep the fixed order and skip empty groups; an extras-only group completes on its extras', () => {
    const s = summarizeSetup(rows);
    expect(s.categories.map((c) => c.category)).toEqual(['basics', 'menu', 'customers']);
    expect(s.categories[0]).toMatchObject({ requiredDone: 1, requiredTotal: 2, complete: false });
    expect(s.categories[2]).toMatchObject({ optionalTotal: 1, complete: false });
  });

  it('100 only when every required step is done', () => {
    const all = rows.map((r) => ({ ...r, done: r.required ? true : r.done }));
    expect(summarizeSetup(all).health).toBe(100);
    expect(summarizeSetup(all).next).toBeNull();
    expect(summarizeSetup([]).health).toBe(0);
  });

  it('parses database rows and drops unknown groups', () => {
    const parsed = parseSetupRows([
      { category: 'menu', step: 'menu', required: true, done: false, have: '2', need: '5' },
      { category: 'mystery', step: 'x', required: true, done: true, have: 1, need: 1 },
    ]);
    expect(parsed).toEqual([
      { category: 'menu', step: 'menu', required: true, done: false, have: 2, need: 5 },
    ]);
    expect(parseSetupRows(null)).toEqual([]);
  });

  it('every step the database knows has a page to go to', () => {
    for (const s of [
      'profile',
      'place',
      'tax',
      'receipt',
      'branch_location',
      'menu',
      'dish_photos',
      'food_facts',
      'discount_codes',
      'channels',
      'commissions',
      'staff_pins',
      'pos_device',
      'tables',
      'recipes',
      'ingredient_prices',
      'fixed_costs',
      'salaries',
      'opening_count',
      'suppliers',
      'shelf_life',
      'daily_checks',
      'managers',
      'purchaser_telegram',
      'owner_whatsapp',
      'google_review',
      'member_card',
      'social',
      'first_order',
    ]) {
      expect(SETUP_HREF).toHaveProperty(s);
    }
  });
});
