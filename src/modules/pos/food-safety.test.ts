import { describe, expect, it } from 'vitest';
import type { MenuCategory, MenuItem } from './client';
import {
  applyFoodBlocks,
  blockedIngredients,
  isFoodSafetyRefusal,
  type BlockedItem,
} from './food-safety';

const item = (id: string, variants: string[] = [], available = true): MenuItem => ({
  id,
  category_id: 'c',
  name: id,
  name_bn: null,
  base_price_poisha: 100,
  branch_price_poisha: null,
  is_available: available,
  is_combo: false,
  photo_path: null,
  variants: variants.map((v) => ({
    id: v,
    name: v,
    name_bn: null,
    price_delta_poisha: 0,
    branch_price_poisha: null,
    is_available: true,
  })),
  modifier_groups: [],
});
const menu = (...items: MenuItem[]): MenuCategory[] => [
  { id: 'c', name: 'c', name_bn: null, items },
];
const block = (menuItem: string, variant: string | null = null): BlockedItem => ({
  menu_item_id: menuItem,
  variant_id: variant,
  ingredient_name: 'Chicken',
  ingredient_name_bn: 'মুরগি',
  reason: 'expired',
});

describe('applyFoodBlocks', () => {
  it('leaves the menu untouched when nothing is blocked', () => {
    const m = menu(item('burger'));
    expect(applyFoodBlocks(m, [])).toBe(m);
  });

  it('takes a blocked dish off and leaves the others', () => {
    const [cat] = applyFoodBlocks(menu(item('burger'), item('rice')), [block('burger')]);
    expect(cat!.items.map((i) => [i.id, i.is_available])).toEqual([
      ['burger', false],
      ['rice', true],
    ]);
  });

  it('blocks one variant and keeps the dish while another can be picked', () => {
    const [cat] = applyFoodBlocks(menu(item('pizza', ['beef', 'veg'])), [block('pizza', 'beef')]);
    const pizza = cat!.items[0]!;
    expect(pizza.is_available).toBe(true);
    expect(pizza.variants.map((v) => v.is_available)).toEqual([false, true]);
  });

  it('blocks the dish when every variant is blocked', () => {
    const [cat] = applyFoodBlocks(menu(item('pizza', ['beef', 'veg'])), [
      block('pizza', 'beef'),
      block('pizza', 'veg'),
    ]);
    expect(cat!.items[0]!.is_available).toBe(false);
  });

  it('never makes an 86’d dish available', () => {
    const [cat] = applyFoodBlocks(menu(item('old', [], false)), [block('other')]);
    expect(cat!.items[0]!.is_available).toBe(false);
  });
});

it('names each ingredient once, in the cashier’s language', () => {
  expect(blockedIngredients([block('a'), block('b')], 'bn')).toEqual(['মুরগি']);
  expect(blockedIngredients([block('a')], 'en')).toEqual(['Chicken']);
});

it('recognises the server’s food-safety refusal, as an error or as the outbox’s text', () => {
  expect(isFoodSafetyRefusal({ message: 'food_safety_blocked' })).toBe(true);
  expect(isFoodSafetyRefusal('22023: food_safety_blocked')).toBe(true);
  expect(isFoodSafetyRefusal({ message: 'closed' })).toBe(false);
});
