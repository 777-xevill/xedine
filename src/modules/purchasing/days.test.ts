import { describe, expect, it } from 'vitest';
import { parseBazarText } from './bazar-text';
import { reviewLines, setListDays, withDays, type IngredientRef } from './lines';

const ING: IngredientRef[] = [
  { id: 'chk', name: 'Chicken', name_bn: 'মুরগি', base: 'g' },
  { id: 'rice', name: 'Rice', name_bn: 'চাল', base: 'g' },
  { id: 'egg', name: 'Egg', name_bn: 'ডিম', base: 'pcs' },
];

describe('days in a typed bazar list (ADR 0029)', () => {
  it('reads days written on a line, in Banglish, English and Bangla', () => {
    const p = parseBazarText(
      'murgi 10 kg 3200 3 din\nchal 25 kg 2500 - 7 days\nডিম ২ ডজন ৩৩০ ২ দিনের জন্য',
    );
    expect(p.unread).toEqual([]);
    expect(p.lines.map((l) => [l.name, l.total_taka, l.for_days])).toEqual([
      ['murgi', 3200, 3],
      ['chal', 2500, 7],
      ['ডিম', 330, 2],
    ]);
    expect(p.days).toBeUndefined();
  });

  it('a line of its own gives the days for the whole list', () => {
    for (const header of ['3 din er bazar', '৩ দিনের বাজার', 'for 3 days', '3 days']) {
      const p = parseBazarText(`${header}\nmurgi 10 kg 3200`);
      expect(p.days, header).toBe(3);
      expect(p.unread, header).toEqual([]);
      expect(p.lines[0]!.for_days, header).toBeUndefined();
    }
  });

  it('a line without days is read as before, and impossible days are not guessed', () => {
    expect(parseBazarText('murgi 10 kg 3200').lines[0]).not.toHaveProperty('for_days');
    expect(parseBazarText('murgi 10 kg 3200 45 din').unread).toEqual(['murgi 10 kg 3200 45 din']);
    expect(parseBazarText('0 din').lines).toEqual([]);
  });
});

describe('withDays and setListDays', () => {
  const lines = reviewLines(
    parseBazarText('murgi 10 kg 3200 3 din\nchal 25 kg 2500\ndim 30 pcs 450').lines,
    ING,
  );
  const usual = new Map([['rice', 7]]);

  it('written on the line, else the item’s usual days, else none yet', () => {
    expect(withDays(lines, undefined, usual).map((l) => l.for_days)).toEqual([3, 7, null]);
  });

  it('days for the whole list win over the usual days, never over a line’s own', () => {
    expect(withDays(lines, 2, usual).map((l) => l.for_days)).toEqual([3, 2, 2]);
  });

  it('a tap sets every line except those with their own days; nonsense is refused', () => {
    const filled = withDays(lines, undefined, usual);
    expect(setListDays(filled, 1)?.map((l) => l.for_days)).toEqual([3, 1, 1]);
    expect(setListDays(filled, 0)).toBeNull();
    expect(setListDays(filled, 31)).toBeNull();
  });
});
