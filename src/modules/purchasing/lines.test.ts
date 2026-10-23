import { describe, expect, it } from 'vitest';
import {
  matchIngredient,
  parseQuantity,
  parseReferenceCsv,
  parseUnit,
  reviewLines,
  splitQuantity,
  toBase,
  type ExtractedLine,
  type IngredientRef,
} from './lines';

const ING: IngredientRef[] = [
  { id: 'chicken', name: 'Chicken', name_bn: 'মুরগি', base: 'g' },
  { id: 'beef', name: 'Beef', name_bn: null, base: 'g' },
  { id: 'rice', name: 'Chinigura rice', name_bn: null, base: 'g' },
  { id: 'oil', name: 'Soybean oil', name_bn: null, base: 'ml' },
  { id: 'egg', name: 'Egg', name_bn: 'ডিম', base: 'pcs' },
  { id: 'spice', name: 'Spice mix', name_bn: null, base: 'g' },
];

const line = (over: Partial<ExtractedLine>): ExtractedLine => ({
  name: 'Beef',
  qty: 1,
  unit: 'kg',
  total_taka: 720,
  confidence: { name: 0.95, qty: 0.95, total: 0.95 },
  ...over,
});

describe('units', () => {
  it('converts to base units and refuses a unit that does not fit', () => {
    expect(toBase(2.5, 'kg', 'g')).toBe(2500);
    expect(toBase(1.25, 'l', 'ml')).toBe(1250);
    expect(toBase(2, 'dozen', 'pcs')).toBe(24);
    expect(toBase(1, 'l', 'pcs')).toBeNull();
    expect(toBase(0, 'kg', 'g')).toBeNull();
    expect(toBase(2, 'tbsp', 'ml')).toBe(30);
    expect(toBase(1, 'slice', 'pcs')).toBe(1);
    expect(toBase(1, 'tbsp', 'g')).toBeNull();
    // Other needs a size above zero, in the item's base unit.
    expect(toBase(3, 'other', 'g', 250)).toBe(750);
    expect(toBase(3, 'other', 'g')).toBeNull();
    expect(toBase(3, 'other', 'g', 0)).toBeNull();
  });

  it('reads the units people write on a chit', () => {
    expect(parseUnit('কেজি')).toBe('kg');
    expect(parseUnit('Kg')).toBe('kg');
    expect(parseUnit('লিটার')).toBe('l');
    expect(parseUnit('টি')).toBe('pcs');
    expect(parseUnit('gm')).toBe('g');
    expect(parseUnit('bag')).toBeNull();
  });
});

describe('matching ingredients', () => {
  it('by exact name in either language, then by bazar words, then by a unique partial name', () => {
    expect(matchIngredient('beef', ING)?.id).toBe('beef');
    expect(matchIngredient('মুরগি', ING)?.id).toBe('chicken');
    expect(matchIngredient('murgi', ING)?.id).toBe('chicken');
    expect(matchIngredient('গরুর মাংস', ING)?.id).toBe('beef');
    expect(matchIngredient('chal', ING)?.id).toBe('rice');
    expect(matchIngredient('tel', ING)?.id).toBe('oil');
    expect(matchIngredient('moshla', ING)?.id).toBe('spice');
    expect(matchIngredient('rice', ING)?.id).toBe('rice');
  });

  it('never guesses between two candidates or from nothing', () => {
    const two = [...ING, { id: 'rice2', name: 'Basmati rice', name_bn: null, base: 'g' as const }];
    expect(matchIngredient('rice', two)).toBeNull();
    expect(matchIngredient('saffron', ING)).toBeNull();
    expect(matchIngredient('  ', ING)).toBeNull();
  });
});

describe('a draft for review', () => {
  it('converts a clean line with nothing to check', () => {
    const [r] = reviewLines(
      [line({ name: 'গরুর মাংস', qty: 5, unit: 'কেজি', total_taka: 3600 })],
      ING,
    );
    expect(r).toEqual({
      name: 'গরুর মাংস',
      ingredient_id: 'beef',
      qty: 5,
      unit: 'kg',
      qty_base: 5000,
      line_total_poisha: 360000,
      flags: [],
    });
  });

  it('counts a hali of eggs as four', () => {
    const [r] = reviewLines([line({ name: 'ডিম', qty: 3, unit: 'হালি', total_taka: 156 })], ING);
    expect(r!.qty_base).toBe(12);
  });

  it('flags what a person must check: no match, a unit that does not fit, low confidence, no price', () => {
    const rows = reviewLines(
      [
        line({ name: 'saffron' }),
        line({ name: 'Egg', unit: 'kg' }),
        line({ confidence: { name: 0.9, qty: 0.4, total: 0.5 } }),
        line({ total_taka: 0 }),
      ],
      ING,
    );
    expect(rows.map((r) => r.flags)).toEqual([
      ['no_match'],
      ['unit_mismatch'],
      ['low_confidence_qty', 'low_confidence_total'],
      ['no_total'],
    ]);
  });
});

describe('typed quantities', () => {
  it('accepts Bangla digits and thousands separators, rejects anything else', () => {
    expect(parseQuantity('২.৫')).toBe(2.5);
    expect(parseQuantity('1,250')).toBe(1250);
    expect(parseQuantity('0')).toBe(0);
    expect(parseQuantity('-1')).toBeNull();
    expect(parseQuantity('2kg')).toBeNull();
  });

  it('shows kg and litres from 1,000 base units', () => {
    expect(splitQuantity(2500, 'g')).toEqual({ value: 2.5, unit: 'kg' });
    expect(splitQuantity(750, 'ml')).toEqual({ value: 750, unit: 'ml' });
    expect(splitQuantity(-1200, 'g')).toEqual({ value: -1.2, unit: 'kg' });
    expect(splitQuantity(36, 'pcs')).toEqual({ value: 36, unit: 'pcs' });
  });
});

describe('reference prices pasted as CSV', () => {
  it('reads rows, skips the header, reports bad lines', () => {
    const { rows, bad } = parseReferenceCsv(
      'ingredient,taka,per,date,source\nBeef, 720, kg, 2026-09-20, TCB\nEgg\t156\tdozen\t2026-09-20\tKaptan\nMilk,90,litre,20-09-2026,x\n\n',
    );
    expect(rows).toEqual([
      {
        ingredient: 'Beef',
        price_poisha: 72000,
        per_base_qty: 1000,
        observed_on: '2026-09-20',
        source: 'TCB',
      },
      {
        ingredient: 'Egg',
        price_poisha: 15600,
        per_base_qty: 12,
        observed_on: '2026-09-20',
        source: 'Kaptan',
      },
    ]);
    expect(bad).toEqual([4]);
  });
});
