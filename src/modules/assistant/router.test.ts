import { describe, expect, it } from 'vitest';
import { detectWindow, routeQuestion, type MenuRef } from './router';

const menu: MenuRef[] = [
  { id: 'km', name: 'Kacchi Biryani (Mutton)', name_bn: 'কাচ্চি বিরিয়ানি (মটন)' },
  { id: 'kh', name: 'Kacchi Biryani (Half)', name_bn: 'কাচ্চি বিরিয়ানি (হাফ)' },
  { id: 'th', name: 'Beef Tehari', name_bn: 'বিফ তেহারি' },
  { id: 'ck', name: 'Chicken Kabab', name_bn: 'চিকেন কাবাব' },
];

describe('question router', () => {
  it.each([
    ['How many mutton kacchi did we sell in the last 2 hours?', 'km', 'last_2h'],
    ['how many Kacchi Biryani (Mutton) sold today', 'km', 'today'],
    ['ajke koto ta tehari bikri hoyeche', 'th', 'today'],
    ['gotokal koita chicken kabab bikri hoise?', 'ck', 'yesterday'],
    ['গত সপ্তাহে কয়টা বিফ তেহারি বিক্রি হয়েছে?', 'th', 'last_7d'],
    ['এই মাসে কতগুলো কাচ্চি বিরিয়ানি (মটন) বিক্রি হয়েছে?', 'km', 'month_to_date'],
    ['How many kebabs... chicken kabab this week?', 'ck', 'week_to_date'],
  ])('%s', (q, item, window) => {
    const intent = routeQuestion(q, menu);
    expect(intent).toMatchObject({ kind: 'item_qty', item: { id: item }, window });
  });

  it('asks which one when a name fits two items', () => {
    expect(routeQuestion('how many kacchi today?', menu)).toMatchObject({
      kind: 'ambiguous_item',
      candidates: [{ id: 'km' }, { id: 'kh' }],
    });
  });

  it('sales and top items without an item', () => {
    expect(routeQuestion('What are sales so far today?', menu)).toEqual({
      kind: 'sales',
      window: 'today',
    });
    expect(routeQuestion('ei mashe top items ki?', menu)).toEqual({
      kind: 'top_items',
      window: 'month_to_date',
    });
  });

  it('leaves everything else to the model (or a help reply)', () => {
    expect(routeQuestion('Why is Mirpur slower on Fridays?', menu)).toBeNull();
  });

  it('explaining a leak: by id, by rank, or the biggest; and what is running low', () => {
    const id = '0b7d3c1e-5f5a-4a4e-9c7e-2d1f0a9b8c7d';
    expect(routeQuestion(`Explain finding ${id}`, menu)).toMatchObject({
      kind: 'finding',
      findingId: id,
    });
    expect(routeQuestion('Explain leak #2', menu)).toMatchObject({
      kind: 'finding',
      findingId: null,
      rank: 2,
    });
    expect(routeQuestion("What's my biggest leak?", menu)).toMatchObject({
      kind: 'finding',
      rank: 1,
    });
    expect(routeQuestion('সবচেয়ে বড় ক্ষতি কোথায়?', menu)).toMatchObject({ kind: 'finding' });
    expect(routeQuestion('What is running low?', menu)).toMatchObject({ kind: 'stock_low' });
    expect(routeQuestion('কী কী ফুরিয়ে আসছে?', menu)).toMatchObject({ kind: 'stock_low' });
  });

  it('tomorrow’s forecast, without mistaking yesterday for tomorrow', () => {
    expect(
      routeQuestion('How many Kacchi Biryani (Mutton) should we cook tomorrow?', menu),
    ).toMatchObject({
      kind: 'forecast_item',
      item: { id: 'km' },
    });
    expect(routeQuestion('আগামীকাল কয়টা রান্না করব?', menu)).toMatchObject({
      kind: 'forecast_item',
      item: null,
    });
    expect(routeQuestion('গতকাল কয়টা কাচ্চি বিরিয়ানি (মটন) বিক্রি হয়েছে?', menu)?.kind).not.toBe(
      'forecast_item',
    );
  });

  it('reads "last week" as the last 7 days and "this week" as week to date', () => {
    expect(detectWindow('last week')).toBe('last_7d');
    expect(detectWindow('this week')).toBe('week_to_date');
    expect(detectWindow('last 30 days')).toBe('last_30d');
  });
});
