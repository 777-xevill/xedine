import { describe, expect, it } from 'vitest';
import { cleanPrice, menuLinesToRows, parseMenuLine } from './photo-lines';

describe('menu photo lines → review rows', () => {
  it('cleans printed prices without guessing', () => {
    expect(cleanPrice('৳ 1,250/-')).toBe('1,250');
    expect(cleanPrice('Tk. ৪৫০')).toBe('৪৫০');
    expect(cleanPrice('—')).toBe('');
  });

  it('reads a line, and skips what is not a dish', () => {
    expect(parseMenuLine('Biryani | Kacchi (Half) | কাচ্চি | ২৫০ | ?')).toEqual({
      category: 'Biryani',
      name: 'Kacchi (Half)',
      name_bn: 'কাচ্চি',
      price: '২৫০',
      unsure: true,
    });
    expect(parseMenuLine('Thank you for coming')).toBeNull();
    expect(parseMenuLine('Drinks |  |  | 30 |')).toBeNull();
  });

  it('keeps dishes under their category and marks doubt and missing prices', () => {
    const rows = menuLinesToRows([
      [
        'BIRYANI | Kacchi (Half) | কাচ্চি | 250 |',
        'BIRYANI | Kacchi (Full) | কাচ্চি | 450 |',
        'BIRYANI | Tehari | | 180 | ?',
        'Drinks | Borhani | বোরহানি | |',
      ],
    ]);
    expect(rows).toEqual([
      { category: 'BIRYANI', name: 'Kacchi (Half)', name_bn: 'কাচ্চি', price: '250', check: false },
      { category: 'BIRYANI', name: 'Kacchi (Full)', name_bn: 'কাচ্চি', price: '450', check: false },
      { category: 'BIRYANI', name: 'Tehari', name_bn: '', price: '180', check: true },
      { category: 'Drinks', name: 'Borhani', name_bn: 'বোরহানি', price: '', check: true },
    ]);
  });

  it('a section running onto the next page keeps its heading; same heading, one category; repeats kept once', () => {
    const rows = menuLinesToRows([
      ['Chinese | Chowmein | | 220 |'],
      [
        ' | Chowmein | | 220 |',
        ' | Fried rice | | 200 |',
        'CHINESE | Soup | | 280 |',
        'Dessert | Firni | | 60 |',
      ],
    ]);
    expect(rows.map((r) => `${r.category}/${r.name}`)).toEqual([
      'Chinese/Chowmein',
      'Chinese/Fried rice',
      'Chinese/Soup',
      'Dessert/Firni',
    ]);
  });

  it('a menu with no headings stays in one nameless category', () => {
    expect(
      menuLinesToRows([[' | Tea | | 20 |', ' | Coffee | | 60 |']]).map((r) => r.category),
    ).toEqual(['', '']);
  });
});
