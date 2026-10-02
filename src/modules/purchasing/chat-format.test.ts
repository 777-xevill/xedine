import { describe, expect, it } from 'vitest';
import { DAYS_CALLBACK, draftButtons, draftSummary, lineComplete, type ChatT } from './chat-format';
import type { IngredientRef, ReviewLine } from './lines';

// A translator that shows the key and its values, so the test pins structure, not wording.
const t: ChatT = (key, values) =>
  values
    ? `${key}(${Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key;
const unit = (u: string) => u;

const ingredients = new Map<string, IngredientRef>([
  ['chk', { id: 'chk', name: 'Chicken', name_bn: 'মুরগি', base: 'g' }],
  ['egg', { id: 'egg', name: 'Egg', name_bn: null, base: 'pcs' }],
]);

const ok = (id: string, qtyBase: number, poisha: number, days: number | null = 3): ReviewLine => ({
  name: id,
  ingredient_id: id,
  qty: 0,
  unit: null,
  qty_base: qtyBase,
  line_total_poisha: poisha,
  flags: [],
  for_days: days,
});

describe('draftSummary', () => {
  it('lists every line from the draft with its days, and totals the lines', () => {
    const s = draftSummary({
      lines: [ok('chk', 10_000, 180_000), ok('egg', 24, 33_000, 1)],
      ingredients,
      locale: 'en',
      t,
      unit,
      branch: 'Dhanmondi',
      date: '1 Oct 2026',
    });
    expect(s.complete).toBe(true);
    expect(s.text.split('\n')).toEqual([
      'heading(branch=Dhanmondi,date=1 Oct 2026)',
      '1. Chicken — 10 kg — ৳1,800 — 📅 days.many(n=3)',
      '2. Egg — 24 pcs — ৳330 — 📅 days.one',
      '',
      'total(amount=৳2,130)',
      'daysNote',
      'askConfirm',
    ]);
  });

  it('uses Bangla names and digits in Bangla', () => {
    const s = draftSummary({
      lines: [ok('chk', 2_500, 45_000)],
      ingredients,
      locale: 'bn',
      t,
      unit,
      branch: 'ধানমন্ডি',
      date: '১ অক্টো, ২০২৬',
    });
    expect(s.text).toContain('১. মুরগি — ২.৫ kg — ৳৪৫০ — 📅 days.many(n=৩)');
  });

  it('a line with no days yet asks for them and holds back ✅', () => {
    const s = draftSummary({
      lines: [ok('chk', 1_000, 18_000), ok('egg', 12, 16_500, null)],
      ingredients,
      locale: 'en',
      t,
      unit,
      branch: 'B',
      date: 'D',
    });
    expect(s.complete).toBe(false);
    expect(s.text).toContain('2. Egg — 12 pcs — ৳165 — 📅 ?');
    expect(s.text).toContain('askDays');
    expect(s.text).not.toContain('askConfirm');
  });

  it('a flagged line says why and blocks confirming', () => {
    const flagged: ReviewLine = {
      ...ok('chk', 0, 0),
      name: 'piyaj',
      ingredient_id: null,
      qty_base: null,
      flags: ['low_confidence_qty', 'no_match'],
    };
    expect(lineComplete(flagged)).toBe(false);
    const s = draftSummary({
      lines: [ok('chk', 1_000, 18_000), flagged],
      ingredients,
      locale: 'en',
      t,
      unit,
      branch: 'B',
      date: 'D',
    });
    expect(s.complete).toBe(false);
    expect(s.text).toContain('2. ⚠️ piyaj — flags.no_match');
    expect(s.text).toContain('needsFix');
    expect(s.text).not.toContain('askConfirm');
  });

  it('a new item is shown as 🆕, can be confirmed, and says it will be added to the list', () => {
    const fresh: ReviewLine = {
      ...ok('x', 2_000, 40_000),
      name: 'kacha morich',
      ingredient_id: null,
      new_ingredient: { name: 'kacha morich', base: 'g' },
    };
    const s = draftSummary({
      lines: [ok('chk', 1_000, 18_000), fresh],
      ingredients,
      locale: 'en',
      t,
      unit,
      branch: 'B',
      date: 'D',
    });
    expect(s.complete).toBe(true);
    expect(s.text).toContain('2. 🆕 kacha morich — 2 kg — ৳400 — 📅 days.many(n=3)');
    expect(s.text).toContain('newItemsNote');
    expect(s.text).toContain('total(amount=৳580)');
  });

  it('an empty draft is never complete', () => {
    expect(
      draftSummary({ lines: [], ingredients, locale: 'en', t, unit, branch: 'B', date: 'D' })
        .complete,
    ).toBe(false);
  });
});

describe('draftButtons', () => {
  const draftId = '00000000-0000-4000-8000-000000000001';
  it('offers the day buttons above ✅ and ❌, each a callback Telegram accepts', () => {
    const rows = draftButtons({
      draftId,
      lines: [ok('chk', 1_000, 18_000)],
      ingredients,
      locale: 'en',
      t,
      complete: true,
    });
    expect(rows.map((r) => r.map((b) => b.text))).toEqual([
      ['📅 days.one', '📅 days.many(n=2)', '📅 days.many(n=3)', '📅 days.many(n=7)'],
      ['btnAdd', 'btnCancel'],
    ]);
    expect(DAYS_CALLBACK.exec(rows[0]![3]!.callback_data)?.slice(1)).toEqual([draftId, '7']);
    for (const b of rows.flat()) {
      expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
    }
  });
});
