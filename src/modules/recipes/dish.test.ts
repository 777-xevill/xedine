import { describe, expect, it } from 'vitest';
import { dishLines, editorAmount, findIngredient, unitsForRow, type KnownIngredient } from './dish';

const known: KnownIngredient[] = [
  { id: 'chicken', name: 'Chicken', name_bn: 'মুরগি', base: 'g' },
  { id: 'bun', name: 'Burger bun', name_bn: null, base: 'pcs' },
  { id: 'wings', name: 'Chicken wings', name_bn: null, base: 'g' },
  { id: 'oil', name: 'Soybean oil', name_bn: 'সয়াবিন তেল', base: 'ml' },
];

describe('dish ingredients (ADR 0037)', () => {
  it('finds an ingredient by its English or Bangla name, never by a part of it', () => {
    expect(findIngredient('  chicken ', known)?.id).toBe('chicken');
    expect(findIngredient('মুরগি', known)?.id).toBe('chicken');
    expect(findIngredient('Chicken  wings', known)?.id).toBe('wings');
    expect(findIngredient('chick', known)).toBeNull();
    expect(findIngredient('', known)).toBeNull();
  });

  it('offers only the units that fit an item the kitchen already keeps', () => {
    expect(unitsForRow(known[1]!)).toEqual(['pcs', 'slice', 'packet', 'bunch', 'dozen']);
    expect(unitsForRow(known[0]!)).toEqual(['g', 'kg']);
    expect(unitsForRow(known[3]!)).toEqual(['ml', 'l', 'tsp', 'tbsp', 'cup']);
    // A new item may use any of them.
    expect(unitsForRow(null)).toHaveLength(12);
  });

  it('reads kitchen words: slice, dozen, spoons and cups', () => {
    expect(
      dishLines(
        [
          { name: 'Burger bun', qty: '2', unit: 'dozen' },
          { name: 'Cheese', qty: '1', unit: 'slice' },
          { name: 'Soybean oil', qty: '2', unit: 'tbsp' },
          { name: 'Lemon juice', qty: '1', unit: 'tsp' },
          { name: 'Milk', qty: '0.5', unit: 'cup' },
        ],
        known,
      ),
    ).toEqual({
      lines: [
        { ingredient_id: 'bun', qty_base: 24 },
        { ingredient: 'Cheese', base: 'pcs', qty_base: 1 },
        { ingredient_id: 'oil', qty_base: 30 },
        { ingredient: 'Lemon juice', base: 'ml', qty_base: 5 },
        { ingredient: 'Milk', base: 'ml', qty_base: 120 },
      ],
    });
    // A spoon of chicken: the chicken is kept in grams.
    expect(dishLines([{ name: 'Chicken', qty: '1', unit: 'tbsp' }], known)).toEqual({
      error: 'dishUnit',
      name: 'Chicken',
    });
  });

  it('turns the burger into lines in base units, new items by name, blank rows skipped', () => {
    const result = dishLines(
      [
        { name: 'Burger bun', qty: '1', unit: 'pcs' },
        { name: 'মুরগি', qty: '১৫০', unit: 'g' },
        { name: 'Cheese', qty: '1', unit: 'pcs' },
        { name: 'Mayonnaise', qty: '0.02', unit: 'kg' },
        { name: 'Soybean oil', qty: '0.015', unit: 'l' },
        { name: '', qty: '', unit: 'g' },
      ],
      known,
    );
    expect(result).toEqual({
      lines: [
        { ingredient_id: 'bun', qty_base: 1 },
        { ingredient_id: 'chicken', qty_base: 150 },
        { ingredient: 'Cheese', base: 'pcs', qty_base: 1 },
        { ingredient: 'Mayonnaise', base: 'g', qty_base: 20 },
        { ingredient_id: 'oil', qty_base: 15 },
      ],
    });
  });

  it('says what is wrong, naming the line', () => {
    expect(dishLines([{ name: '', qty: '', unit: 'g' }], known)).toEqual({ error: 'dishEmpty' });
    expect(dishLines([{ name: '', qty: '5', unit: 'g' }], known)).toEqual({ error: 'dishName' });
    expect(dishLines([{ name: 'Chicken', qty: 'a lot', unit: 'g' }], known)).toEqual({
      error: 'dishAmount',
      name: 'Chicken',
    });
    expect(dishLines([{ name: 'Chicken', qty: '0', unit: 'g' }], known)).toEqual({
      error: 'dishAmount',
      name: 'Chicken',
    });
    // Grams of buns: the bun is kept in pieces.
    expect(dishLines([{ name: 'burger bun', qty: '80', unit: 'g' }], known)).toEqual({
      error: 'dishUnit',
      name: 'burger bun',
    });
  });

  it('shows a stored amount in the unit a person would write', () => {
    expect(editorAmount(150, 'g')).toEqual({ qty: '150', unit: 'g' });
    expect(editorAmount(1500, 'g')).toEqual({ qty: '1.5', unit: 'kg' });
    expect(editorAmount(2000, 'ml')).toEqual({ qty: '2', unit: 'l' });
    expect(editorAmount(1, 'pcs')).toEqual({ qty: '1', unit: 'pcs' });
    // A yield-adjusted amount (81 g at 90%) arrives as 90.000…; it reads as 90.
    expect(editorAmount(90.0000001, 'g')).toEqual({ qty: '90', unit: 'g' });
  });
});
