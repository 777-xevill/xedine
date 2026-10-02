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

  it('accepts what the model saw: taka (exact or whole), percent, and grams written as kg', () => {
    const seen = {
      data: {
        loss_total_taka: 8657.5,
        items: [{ over_pct: 1.32, used_more_than_recipes: '9.55 kg', usage_actual_qty: 9554 }],
      },
    };
    expect(
      validateNumbers('Loss ৳8,657.50 (about ৳8,658), 1.32% over, 9.55 kg more.', [seen]).ok,
    ).toBe(true);
    expect(validateNumbers('Really used 9.6 kg.', [seen]).ok).toBe(true);
    // The mistake that started this: 865,750 poisha written as ৳865.75.
    expect(validateNumbers('৳৮৬৫.৭৫', [{ unexplained_usage_taka: 8657.5 }]).ok).toBe(false);
  });

  it('list numbering is not a figure; a quoted quantity may be rounded', () => {
    const seen = { data: { items: [{ of_which_not_explained: '57.65 kg' }] } };
    expect(validateNumbers('(১) চাল দেখুন (২) মাংস (৩) গণনা — ৫৭.৬৫ কেজি', [seen]).ok).toBe(true);
    expect(validateNumbers('1. Rice 58 kg\n2. Check 57.7 kg', [seen]).ok).toBe(true);
    // A number inside a sentence is still checked.
    expect(validateNumbers('about 3 times more', [seen]).ok).toBe(false);
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
    ['uttara branch er loss ber koro', 'banglish'],
    ['uttaray branch er kon jinish er jonno loss hocche ??', 'banglish'],
    ['Where is the loss in Uttara branch?', 'en'],
  ])('%s → %s', (q, lang) => {
    expect(detectLanguage(q)).toBe(lang);
  });
});
