import { describe, expect, it } from 'vitest';
import { draftButtons, draftSummary, PICK_CALLBACK, type ChatT } from './chat-format';
import {
  applyPick,
  matchIngredient,
  proposeNewItems,
  reviewLines,
  suggestIngredients,
  type ExtractedLine,
  type IngredientRef,
} from './lines';

// The bot's "which item is this?" step (ADR 0028).
const ING: IngredientRef[] = [
  { id: 'chk', name: 'Chicken', name_bn: 'মুরগি', base: 'g' },
  { id: 'liver', name: 'Chicken liver', name_bn: null, base: 'g' },
  { id: 'egg', name: 'Egg', name_bn: 'ডিম', base: 'pcs' },
  { id: 'cheese', name: 'Mozzarella cheese', name_bn: null, base: 'g', aliases: ['mozza'] },
];
const t: ChatT = (key, values) => (values ? `${key}(${Object.values(values).join(',')})` : key);
const typed = (name: string, unit = 'kg', qty = 2, total = 1200): ExtractedLine => ({
  name,
  qty,
  unit,
  total_taka: total,
  confidence: { name: 1, qty: 1, total: 1 },
});
const review = (e: ExtractedLine[]) => proposeNewItems(reviewLines(e, ING), ING);

describe('suggestions', () => {
  it('a learnt spelling matches by itself', () => {
    expect(matchIngredient('Mozza', ING)?.id).toBe('cheese');
  });

  it('"murgi" with two chicken items asks which one, never guesses', () => {
    const [l] = review([typed('murgi')]);
    expect(l!.flags).toEqual(['pick']);
    expect(l!.candidates).toEqual(['chk', 'liver']);
    expect(l!.ingredient_id).toBeNull();
  });

  it('a close spelling is offered; kg never offers eggs', () => {
    expect(suggestIngredients('chiken', ING, 'g').map((i) => i.id)).toContain('chk');
    expect(suggestIngredients('dim', ING, 'g')).toEqual([]);
    expect(suggestIngredients('dim', ING, 'pcs').map((i) => i.id)).toEqual(['egg']);
  });

  it('nothing close: a 🆕 new item as before', () => {
    const [l] = review([typed('kalojira', 'g', 200, 120)]);
    expect(l!.flags).toEqual([]);
    expect(l!.new_ingredient).toEqual({ name: 'kalojira', base: 'g' });
  });
});

describe('applyPick', () => {
  const [waiting] = review([typed('murgi')]);

  it('a candidate fills the line in its unit and is marked picked', () => {
    expect(applyPick(waiting!, 1, ING)).toMatchObject({
      ingredient_id: 'liver',
      qty_base: 2000,
      flags: [],
      picked: true,
      candidates: undefined,
    });
  });

  it('"new" makes it a new item named as written', () => {
    expect(applyPick(waiting!, 'new', ING)).toMatchObject({
      ingredient_id: null,
      qty_base: 2000,
      flags: [],
      new_ingredient: { name: 'murgi', base: 'g' },
    });
  });

  it('a choice the line did not offer, or a line not waiting, changes nothing', () => {
    expect(applyPick(waiting!, 2, ING)).toBeNull();
    expect(applyPick(applyPick(waiting!, 0, ING)!, 0, ING)).toBeNull();
  });
});

describe('the message and its buttons', () => {
  const draftId = '00000000-0000-4000-8000-000000000001';
  const lines = review([typed('murgi'), typed('Egg', 'pcs', 12, 165)]);
  const ingredients = new Map(ING.map((i) => [i.id, i]));
  const summary = draftSummary({
    lines,
    ingredients,
    locale: 'en',
    t,
    unit: (u) => u,
    branch: 'Dhanmondi',
    date: '2 Oct 2026',
  });

  it('a line waiting for a pick shows as written, and there is no ✅ yet', () => {
    expect(summary.complete).toBe(false);
    expect(summary.text).toContain('1. ❓ murgi — 2 kg — ৳1,200 — flags.pick');
    expect(summary.text).toContain('pickBelow');
  });

  it('one row of items and one 🆕 row per waiting line, then ❌; every callback fits Telegram', () => {
    const rows = draftButtons({
      draftId,
      lines,
      ingredients,
      locale: 'en',
      t,
      complete: false,
    });
    expect(rows.map((r) => r.map((b) => b.text))).toEqual([
      ['1. Chicken', '1. Chicken liver'],
      ['1. btnNewItem(murgi)'],
      ['📅 days.one', '📅 days.many(2)', '📅 days.many(3)', '📅 days.many(7)'],
      ['btnCancel'],
    ]);
    for (const b of rows.flat()) {
      expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
    }
    expect(PICK_CALLBACK.exec(rows[0]![1]!.callback_data)?.slice(1)).toEqual([draftId, '0', '1']);
    expect(PICK_CALLBACK.exec(rows[1]![0]!.callback_data)?.slice(3)).toEqual(['n']);
  });
});
