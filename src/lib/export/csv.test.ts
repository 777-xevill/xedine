import { describe, expect, it } from 'vitest';
import { poishaToTakaText } from '@/lib/money';
import { csvCell, toCsv } from './csv';

describe('csv export', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('Kacchi, full')).toBe('"Kacchi, full"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
  });
  it('defuses spreadsheet formulas but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(csvCell('-12.50')).toBe('-12.50');
  });
  it('builds CRLF rows', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('a,b\r\n1,x\r\n');
  });
  it('writes poisha as exact taka', () => {
    expect(poishaToTakaText(123456)).toBe('1234.56');
    expect(poishaToTakaText(-5)).toBe('-0.05');
    expect(poishaToTakaText(0)).toBe('0.00');
  });
});
