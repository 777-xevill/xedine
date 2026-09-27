import { describe, expect, it } from 'vitest';
import { parseMenuCsv, splitCsvLine } from './import';

describe('menu CSV import', () => {
  it('reads four, three and two columns, skipping a header', () => {
    const { rows, badLines } = parseMenuCsv(
      [
        'category,name,name_bn,price',
        'Biryani,Kacchi (full),কাচ্চি,"৳1,250"',
        'Drinks,Borhani,80',
        'Firni,৬০',
      ].join('\n'),
    );
    expect(badLines).toEqual([]);
    expect(rows).toEqual([
      { category: 'Biryani', name: 'Kacchi (full)', name_bn: 'কাচ্চি', price_poisha: 125000 },
      { category: 'Drinks', name: 'Borhani', name_bn: null, price_poisha: 8000 },
      { category: '', name: 'Firni', name_bn: null, price_poisha: 6000 },
    ]);
  });

  it('reports bad lines by number instead of guessing', () => {
    const { rows, badLines } = parseMenuCsv('Tea,20\nCoffee,free\n,50\n\nLassi,60.5');
    expect(rows.map((r) => r.name)).toEqual(['Tea', 'Lassi']);
    expect(badLines).toEqual([2, 3]);
  });

  it('handles quoted commas and doubled quotes', () => {
    expect(splitCsvLine('"Rice, plain","The ""best""",10')).toEqual([
      'Rice, plain',
      'The "best"',
      '10',
    ]);
  });
});
