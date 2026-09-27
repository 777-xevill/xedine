import { describe, expect, it } from 'vitest';
import { detectLanguage } from './language';
import { extractNumbers, validateNumbers } from './validator';

describe('numeric-consistency validator', () => {
  const tool = {
    metric_id: 'items.qty_sold',
    filters: { window: 'last_2h', from: '2026-09-21', to: '2026-09-21' },
    data: { item_name: 'Kacchi Biryani (Mutton)', qty: 7, net_poisha: 266667 },
  };

  it('reads Latin and Bangla digits with lakh commas', () => {
    expect(extractNumbers('৳১,২৩,৪৫৬ and 7 kacchi, 2.5%')).toEqual([123456, 7, 2.5]);
  });

  it('accepts numbers from tool results, in poisha or taka, rounded or exact', () => {
    expect(
      validateNumbers('7 Kacchi sold in the last 2 hours, ৳2,666.67.', [tool], 'last 2 hours?').ok,
    ).toBe(true);
    expect(validateNumbers('৭টি কাচ্চি বিক্রি হয়েছে, মোট ৳২,৬৬৭।', [tool]).ok).toBe(true);
  });

  it('rejects any number the tools did not return', () => {
    const r = validateNumbers('About 8 were sold, roughly 20% more than usual.', [tool]);
    expect(r.ok).toBe(false);
    expect(r.unsupported).toEqual([8, 20]);
  });

  it('allows numbers quoted from the question', () => {
    expect(
      validateNumbers('In the last 2 hours: 7.', [tool], 'how many in the last 2 hours').ok,
    ).toBe(true);
  });
});

describe('language detection', () => {
  it.each([
    ['আজ কয়টা কাচ্চি বিক্রি হয়েছে?', 'bn'],
    ['ajke koto ta kacchi bikri hoyeche', 'banglish'],
    ['koto bikri?', 'banglish'],
    ['How many kacchi did we sell today?', 'en'],
  ])('%s → %s', (q, lang) => {
    expect(detectLanguage(q)).toBe(lang);
  });
});
