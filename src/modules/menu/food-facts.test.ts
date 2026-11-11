import { describe, expect, it } from 'vitest';
import { validateNumbers } from '@/modules/assistant/validator';
import { factsLine, isSafe, matchDishes, quickPick, type FactsDish } from './food-facts';

const dish = (name: string, price: number, facts?: Partial<FactsDish>): FactsDish => ({
  name,
  name_bn: null,
  price_poisha: price * 100,
  kcal: null,
  protein_g: null,
  carbs_g: null,
  fat_g: null,
  allergens: null,
  ...facts,
});

const menu = [
  dish('Kacchi Biryani', 420, {
    kcal: 850,
    protein_g: 32,
    carbs_g: 95,
    fat_g: 38,
    allergens: ['milk'],
  }),
  dish('Chicken Tikka', 320, {
    kcal: 380,
    protein_g: 41.5,
    carbs_g: 6,
    fat_g: 20,
    allergens: ['milk'],
  }),
  dish('Garden Salad', 180, { kcal: 150, protein_g: 4, carbs_g: 18, fat_g: 7, allergens: [] }),
  dish('Beef Bhuna', 380, {
    kcal: 520,
    protein_g: 38,
    carbs_g: 10,
    fat_g: 35,
    allergens: ['beef'],
  }),
  dish('Naan', 40, {
    kcal: 260,
    protein_g: 8,
    carbs_g: 45,
    fat_g: 5,
    allergens: ['gluten', 'milk'],
  }),
  dish('Borhani', 90),
];

describe('food facts on the table menu (ADR 0049)', () => {
  it('high protein: the three richest approved dishes, never one without facts', () => {
    expect(quickPick(menu, 'protein').map((d) => d.name)).toEqual([
      'Chicken Tikka',
      'Beef Bhuna',
      'Kacchi Biryani',
    ]);
  });

  it('light: only dishes up to 500 kcal, most protein first', () => {
    expect(quickPick(menu, 'light').map((d) => d.name)).toEqual([
      'Chicken Tikka',
      'Naan',
      'Garden Salad',
    ]);
  });

  it('budget: up to ৳300, including dishes nobody has checked', () => {
    expect(quickPick(menu, 'budget').map((d) => d.name)).toEqual([
      'Naan',
      'Garden Salad',
      'Borhani',
    ]);
  });

  it('the allergy filter hides what the customer avoids and every unchecked dish', () => {
    const safe = menu.filter((d) => isSafe(d, ['milk']));
    expect(safe.map((d) => d.name)).toEqual(['Garden Salad', 'Beef Bhuna']);
    expect(menu.filter((d) => isSafe(d, []))).toHaveLength(menu.length);
    expect(quickPick(menu, 'protein', ['milk', 'beef']).map((d) => d.name)).toEqual([
      'Garden Salad',
    ]);
  });

  it('the AI is given only approved facts, and an unchecked dish says so', () => {
    expect(factsLine(menu[0]!)).toBe(
      'Kacchi Biryani | price_taka=420 | kcal=850 | protein_g=32 | carbs_g=95 | fat_g=38 | contains=milk',
    );
    expect(factsLine(menu[5]!)).toBe('Borhani | price_taka=90 | facts=not checked');
  });

  it('a number the AI makes up is caught; one it copies passes', () => {
    const lines = [menu.map(factsLine).join('\n')];
    expect(validateNumbers('Chicken Tikka has 41.5 g protein for ৳320.', lines).ok).toBe(true);
    expect(validateNumbers('Borhani has about 120 kcal.', lines).ok).toBe(false);
  });

  it('dishes the AI names are matched back to the menu, at most three, unknown ones dropped', () => {
    const picked = matchDishes(
      ['naan', 'Pizza', 'Kacchi  Biryani', 'Naan', 'Borhani', 'Garden Salad'],
      menu,
    );
    expect(picked.map((d) => d.name)).toEqual(['Naan', 'Kacchi Biryani', 'Borhani']);
  });
});
