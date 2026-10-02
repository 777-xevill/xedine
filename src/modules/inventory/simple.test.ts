import { describe, expect, it } from 'vitest';
import type { StockRow, VarianceRow } from './queries';
import {
  compareBars,
  daysInclusive,
  groupLevels,
  levelGroup,
  lossKind,
  lossTotal,
  splitLoss,
  staffFoodTotal,
} from './simple';

const stock = (over: Partial<StockRow>): StockRow => ({
  branch_id: 'b',
  ingredient_id: over.name ?? 'x',
  name: 'Item',
  name_bn: null,
  base: 'g',
  last_count_date: '2026-09-20',
  stock_qty: 1000,
  in_transit_qty: 0,
  usage_14d_qty: 100,
  days_of_cover: 10,
  band: 'green',
  as_of: '2026-09-21',
  estimated: false,
  since_on: null,
  used_since_qty: null,
  avg_daily_qty: null,
  ...over,
});

const variance = (over: Partial<VarianceRow>): VarianceRow => ({
  branch_id: 'b',
  ingredient_id: over.name ?? 'x',
  name: 'Item',
  name_bn: null,
  base: 'g',
  opening_date: '2026-09-13',
  opening_qty: 0,
  closing_date: '2026-09-20',
  closing_qty: 0,
  purchases_qty: 0,
  purchases_poisha: null,
  transfers_in_qty: 0,
  transfers_out_qty: 0,
  usage_theoretical_qty: 24000,
  waste_qty: 0,
  usage_actual_qty: 24000,
  variance_qty: 0,
  variance_bps: 0,
  variance_poisha: null,
  over_qty: 0,
  over_bps: 0,
  over_poisha: null,
  staff_food_qty: 0,
  staff_food_poisha: null,
  ...over,
});

describe('levelGroup', () => {
  it('puts never-counted items apart, whatever their band', () => {
    expect(levelGroup({ stock_qty: null, band: 'none' })).toBe('notCounted');
  });

  it('maps the cover bands to the three plain headings', () => {
    expect(levelGroup({ stock_qty: 1, band: 'red' })).toBe('low');
    expect(levelGroup({ stock_qty: 1, band: 'yellow' })).toBe('getting');
    expect(levelGroup({ stock_qty: 1, band: 'green' })).toBe('enough');
  });

  it('counted but not used lately is no risk', () => {
    expect(levelGroup({ stock_qty: 500, band: 'none' })).toBe('enough');
  });

  it('a negative stock (more used than recorded) has a red band and stays in "low"', () => {
    expect(levelGroup({ stock_qty: -2000, band: 'red' })).toBe('low');
  });
});

describe('groupLevels', () => {
  it('sorts each heading by what lasts the shortest first, unused items last', () => {
    const g = groupLevels([
      stock({ name: 'Rice', band: 'green', days_of_cover: 15.7 }),
      stock({ name: 'Beef', band: 'green', days_of_cover: 2.3 }),
      stock({ name: 'Salt', band: 'none', days_of_cover: null }),
      stock({ name: 'Chicken', band: 'red', days_of_cover: 1.2 }),
      stock({ name: 'Onion', band: 'red', days_of_cover: -0.4 }),
      stock({ name: 'Mint', band: 'none', stock_qty: null, days_of_cover: null }),
    ]);
    expect(g.low.map((r) => r.name)).toEqual(['Onion', 'Chicken']);
    expect(g.enough.map((r) => r.name)).toEqual(['Beef', 'Rice', 'Salt']);
    expect(g.notCounted.map((r) => r.name)).toEqual(['Mint']);
    expect(g.getting).toEqual([]);
  });
});

describe('lossKind — the founder’s rule (ADR 0027)', () => {
  // Recipe 24 kg; the line at 1%.
  it('24 kg used is on recipe; 25 kg and 26 kg are losses of 1 kg and 2 kg', () => {
    expect(lossKind(variance({ over_qty: 0, over_bps: 0 }))).toBe('onRecipe');
    expect(lossKind(variance({ over_qty: 1000, over_bps: 417 }))).toBe('loss');
    expect(lossKind(variance({ over_qty: 2000, over_bps: 833 }))).toBe('loss');
  });

  it('1% or more over the recipe is a loss to act on; under it, still a (small) loss', () => {
    expect(lossKind(variance({ over_qty: 240, over_bps: 100 }))).toBe('loss');
    expect(lossKind(variance({ over_qty: 330, over_bps: 132 }))).toBe('loss');
    expect(lossKind(variance({ over_qty: 200, over_bps: 83 }))).toBe('small');
    expect(lossKind(variance({ over_qty: 1, over_bps: 0 }))).toBe('small');
  });

  it('follows the org’s own line', () => {
    expect(lossKind(variance({ over_qty: 330, over_bps: 132 }), 200)).toBe('small');
    expect(lossKind(variance({ over_qty: 600, over_bps: 250 }), 200)).toBe('loss');
  });

  it('using less than the recipes is under-usage, never a gain', () => {
    expect(lossKind(variance({ over_qty: -1000, over_bps: -417 }))).toBe('under');
  });

  it('something used that no recipe needs is a loss', () => {
    expect(lossKind(variance({ usage_theoretical_qty: 0, over_qty: 50, over_bps: null }))).toBe(
      'loss',
    );
  });
});

describe('splitLoss and lossTotal', () => {
  const rows = [
    variance({ name: 'Beef', over_qty: 330, over_bps: 132, over_poisha: 23_760 }),
    variance({ name: 'Chicken', over_qty: 9_554, over_bps: 1_899, over_poisha: 305_700 }),
    variance({ name: 'Water', over_qty: 1, over_bps: 94, over_poisha: 1_000 }),
    variance({ name: 'Egg', over_qty: -9, over_bps: -287, over_poisha: -11_700 }),
    variance({ name: 'Salt', over_qty: 0, over_bps: 0, over_poisha: 0 }),
  ];

  it('puts each item under one heading, the biggest money first', () => {
    const g = splitLoss(rows, 100);
    expect(g.loss.map((r) => r.name)).toEqual(['Chicken', 'Beef']);
    expect(g.small.map((r) => r.name)).toEqual(['Water']);
    expect(g.under.map((r) => r.name)).toEqual(['Egg']);
    expect(g.onRecipe.map((r) => r.name)).toEqual(['Salt']);
  });

  it('adds up every loss, small ones included, and never subtracts under-usage', () => {
    // 3,05,700 + 23,760 + 1,000 = 3,30,460; the egg's −11,700 is not netted.
    expect(lossTotal(rows)).toBe(330_460);
  });

  it('an item with no price yet adds nothing, and no loss is zero', () => {
    expect(lossTotal([variance({ over_qty: 500, over_bps: 300, over_poisha: null })])).toBe(0);
    expect(lossTotal([])).toBe(0);
  });
});

describe('daysInclusive', () => {
  it('counts both ends, across a month end', () => {
    expect(daysInclusive('2026-10-01', '2026-10-04')).toBe(4);
    expect(daysInclusive('2026-09-29', '2026-10-02')).toBe(4);
    expect(daysInclusive('2026-10-02', '2026-10-02')).toBe(1);
  });
  it('a start after the end or a bad date is no days', () => {
    expect(daysInclusive('2026-10-05', '2026-10-02')).toBe(0);
    expect(daysInclusive('', '2026-10-02')).toBe(0);
  });
});

describe('staffFoodTotal', () => {
  it('adds staff food on its own and leaves the loss total alone', () => {
    const rows = [
      variance({
        name: 'Chicken',
        over_qty: 100,
        over_poisha: 3_200,
        staff_food_qty: 600,
        staff_food_poisha: 19_200,
      }),
      variance({ name: 'Rice', staff_food_qty: 400, staff_food_poisha: 4_000 }),
      variance({ name: 'Oil', staff_food_qty: 50, staff_food_poisha: null }),
    ];
    expect(staffFoodTotal(rows)).toBe(23_200);
    expect(lossTotal(rows)).toBe(3_200);
    expect(staffFoodTotal([])).toBe(0);
  });
});

describe('compareBars', () => {
  it('draws the longer one full and the other to scale', () => {
    expect(compareBars(50.32, 59.874)).toEqual({ should: 84, really: 100 });
    expect(compareBars(100, 25)).toEqual({ should: 100, really: 25 });
  });

  it('handles nothing used, and never goes negative', () => {
    expect(compareBars(0, 0)).toEqual({ should: 0, really: 0 });
    expect(compareBars(0, 10)).toEqual({ should: 0, really: 100 });
    expect(compareBars(-5, 10)).toEqual({ should: 0, really: 100 });
  });
});
