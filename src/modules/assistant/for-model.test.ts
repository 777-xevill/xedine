import { describe, expect, it } from 'vitest';
import { forModel, plain, qtyText } from './for-model';

describe('forModel', () => {
  it('turns poisha into taka and basis points into percent, deep inside the result', () => {
    expect(
      forModel({
        metric_id: 'x',
        data: [{ unexplained_usage_poisha: 865_750, over_bps: 132, name: 'Beef', qty: 330 }],
        total_poisha: -859_677,
      }),
    ).toEqual({
      metric_id: 'x',
      data: [{ unexplained_usage_taka: 8657.5, over_pct: 1.32, name: 'Beef', qty: 330 }],
      total_taka: -8596.77,
    });
  });

  it('keeps null money (not permitted) null under the taka name, and the rest as it is', () => {
    expect(forModel({ loss_poisha: null, error: 'not_permitted', list: [1, 'a'] })).toEqual({
      loss_taka: null,
      error: 'not_permitted',
      list: [1, 'a'],
    });
  });
});

describe('qtyText', () => {
  it('writes base quantities the way people read them', () => {
    expect(qtyText(9554, 'g')).toBe('9.55 kg');
    expect(qtyText(300, 'g')).toBe('300 g');
    expect(qtyText(1500, 'ml')).toBe('1.5 litre');
    expect(qtyText(12, 'pcs')).toBe('12 pcs');
  });
});

describe('plain', () => {
  it('takes Markdown bold and headings out of a chat answer', () => {
    expect(plain('## লস\n- **চিনিগুড়া চাল** – ৳9237.9\n- __Beef__')).toBe(
      'লস\n- চিনিগুড়া চাল – ৳9237.9\n- Beef',
    );
  });
});
