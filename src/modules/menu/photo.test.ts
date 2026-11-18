import { describe, expect, it } from 'vitest';
import { cleanPrice, readingsToRows, type MenuPhotoReading } from './photo';

const item = (
  name: string,
  price: string,
  extra: Partial<MenuPhotoReading['categories'][number]['items'][number]> = {},
) => ({
  name,
  name_bn: '',
  price,
  sizes: [],
  unsure: false,
  ...extra,
});

describe('menu photo reading → review rows', () => {
  it('cleans printed prices without guessing', () => {
    expect(cleanPrice('৳ 1,250/-')).toBe('1,250');
    expect(cleanPrice('Tk. ৪৫০')).toBe('৪৫০');
    expect(cleanPrice('—')).toBe('');
  });

  it('keeps dishes under their category, splits sizes, marks doubt and missing prices', () => {
    const rows = readingsToRows([
      {
        categories: [
          {
            name: 'Biryani',
            name_bn: '',
            items: [
              item('Kacchi', '', {
                name_bn: 'কাচ্চি',
                sizes: [
                  { label: 'Half', price: '250' },
                  { label: 'Full', price: '450' },
                ],
              }),
              item('Tehari', '180', { unsure: true }),
            ],
          },
          { name: 'Drinks', name_bn: '', items: [item('Borhani', ''), item('  ', '10')] },
        ],
      },
    ]);
    expect(rows).toEqual([
      { category: 'Biryani', name: 'Kacchi (Half)', name_bn: 'কাচ্চি', price: '250', check: false },
      { category: 'Biryani', name: 'Kacchi (Full)', name_bn: 'কাচ্চি', price: '450', check: false },
      { category: 'Biryani', name: 'Tehari', name_bn: '', price: '180', check: true },
      { category: 'Drinks', name: 'Borhani', name_bn: '', price: '', check: true },
    ]);
  });

  it('a section running onto the next page keeps its heading, and a repeated dish is kept once', () => {
    const rows = readingsToRows([
      { categories: [{ name: 'Chinese', name_bn: '', items: [item('Chowmein', '220')] }] },
      {
        categories: [
          { name: '', name_bn: '', items: [item('Chowmein', '220'), item('Fried rice', '200')] },
          { name: 'Dessert', name_bn: '', items: [item('Firni', '60')] },
        ],
      },
    ]);
    expect(rows.map((r) => `${r.category}/${r.name}`)).toEqual([
      'Chinese/Chowmein',
      'Chinese/Fried rice',
      'Dessert/Firni',
    ]);
  });
});
