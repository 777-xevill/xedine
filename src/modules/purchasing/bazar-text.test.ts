import { describe, expect, it } from 'vitest';
import { parseBazarText } from './bazar-text';
import { proposeNewItems, reviewLines, type IngredientRef } from './lines';

const line = (name: string, qty: number, unit: string, total: number) => ({
  name,
  qty,
  unit,
  total_taka: total,
  confidence: { name: 1, qty: 1, total: 1 },
});

describe('parseBazarText', () => {
  it('reads Banglish, one item per line, units attached or apart', () => {
    expect(parseBazarText('murgi 10 kg 1800\npiyaj 5kg 300\ndim 2 dozen 330 tk')).toEqual({
      lines: [
        line('murgi', 10, 'kg', 1800),
        line('piyaj', 5, 'kg', 300),
        line('dim', 2, 'dozen', 330),
      ],
      unread: [],
    });
  });

  it('reads Bangla with Bangla digits, commas between items and টাকা after the price', () => {
    expect(parseBazarText('মুরগি ১০ কেজি ১৮০০ টাকা, পেঁয়াজ ৫ কেজি ৩০০')).toEqual({
      lines: [line('মুরগি', 10, 'কেজি', 1800), line('পেঁয়াজ', 5, 'কেজি', 300)],
      unread: [],
    });
  });

  it('keeps a thousands separator inside the price and accepts ৳, =, - and /-', () => {
    expect(parseBazarText('gorur mangsho 5 kg = ৳3,600\nchal - 25 kg - 2,125/-').lines).toEqual([
      line('gorur mangsho', 5, 'kg', 3600),
      line('chal', 25, 'kg', 2125),
    ]);
  });

  it('takes a missing unit as pieces and keeps decimals', () => {
    expect(parseBazarText('lebu 20 200; tel 2.5 l 450.50').lines).toEqual([
      line('lebu', 20, 'pcs', 200),
      line('tel', 2.5, 'l', 450.5),
    ]);
  });

  it('never multiplies: a rate per kg, a lone sum or words are unread', () => {
    expect(parseBazarText('murgi 10 kg 180/kg\nmot 2100\nmurgi dosh kg')).toEqual({
      lines: [],
      unread: ['murgi 10 kg 180/kg', 'mot 2100', 'murgi dosh kg'],
    });
  });

  it('feeds the same review as the web: হালি is four, and synonyms match ingredients', () => {
    const ingredients: IngredientRef[] = [
      { id: 'egg', name: 'Egg', name_bn: 'ডিম', base: 'pcs' },
      { id: 'chk', name: 'Chicken (broiler)', name_bn: null, base: 'g' },
    ];
    const review = reviewLines(parseBazarText('ডিম ৫ হালি ২০০\nmurgi 3 kg 540').lines, ingredients);
    expect(review.map((r) => [r.ingredient_id, r.qty_base, r.line_total_poisha, r.flags])).toEqual([
      ['egg', 20, 20000, []],
      ['chk', 3000, 54000, []],
    ]);
  });

  it('an item not in the list becomes a proposed new item in the unit it was bought in', () => {
    const ingredients: IngredientRef[] = [{ id: 'chk', name: 'Chicken', name_bn: null, base: 'g' }];
    const typed = parseBazarText('murgi 3 kg 540\nkacha morich 2 kg 400');
    const lines = proposeNewItems(reviewLines(typed.lines, ingredients));
    expect(lines[0]!.new_ingredient).toBeUndefined();
    expect(lines[1]).toMatchObject({
      ingredient_id: null,
      qty_base: 2000,
      line_total_poisha: 40000,
      flags: [],
      new_ingredient: { name: 'kacha morich', base: 'g' },
    });
  });
});
