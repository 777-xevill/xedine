import { describe, expect, it } from 'vitest';
import { menuForModel, resolveHelperLines, type HelperMenuItem } from './helper-lines';

const menu: HelperMenuItem[] = [
  { id: 'biryani', name: 'Chicken Biryani', nameBn: 'চিকেন বিরিয়ানি', variants: [], groups: [] },
  { id: 'borhani', name: 'Borhani', nameBn: null, variants: [], groups: [] },
  {
    id: 'tea',
    name: 'Tea',
    nameBn: null,
    variants: [
      { id: 'tea-s', name: 'Small', nameBn: null },
      { id: 'tea-l', name: 'Large', nameBn: null },
    ],
    groups: [{ min: 0, max: 1, modifiers: [{ id: 'sugar', name: 'Extra sugar', nameBn: null }] }],
  },
  {
    id: 'burger',
    name: 'Burger',
    nameBn: null,
    variants: [],
    groups: [
      {
        min: 1,
        max: 1,
        modifiers: [
          { id: 'beef', name: 'Beef', nameBn: null },
          { id: 'chicken', name: 'Chicken', nameBn: null },
        ],
      },
    ],
  },
];
const line = (
  over: Partial<{
    item_id: string;
    quantity: number;
    variant_id: string;
    modifier_ids: string[];
    note: string;
  }>,
) => ({
  item_id: 'biryani',
  quantity: 1,
  variant_id: '',
  modifier_ids: [],
  note: '',
  ...over,
});

describe('resolveHelperLines', () => {
  it('keeps a plain dish with its quantity and note', () => {
    const r = resolveHelperLines(
      { lines: [line({ quantity: 2, note: ' no onion ' })], unmatched: [] },
      menu,
    );
    expect(r.lines).toEqual([
      {
        menuItemId: 'biryani',
        quantity: 2,
        variantId: null,
        modifierIds: [],
        note: 'no onion',
        needsChoice: false,
      },
    ]);
  });

  it('drops ids that are not on the menu, so the model cannot invent a dish', () => {
    const r = resolveHelperLines({ lines: [line({ item_id: 'made-up' })], unmatched: [] }, menu);
    expect(r.lines).toEqual([]);
  });

  it('rounds quantities down, caps them, and drops zero or negative ones', () => {
    const r = resolveHelperLines(
      {
        lines: [
          line({ item_id: 'biryani', quantity: 2.9 }),
          line({ item_id: 'borhani', quantity: 5000 }),
          line({ item_id: 'tea', quantity: 0, variant_id: 'tea-s' }),
          line({ item_id: 'tea', quantity: -3, variant_id: 'tea-l' }),
        ],
        unmatched: [],
      },
      menu,
    );
    expect(r.lines.map((l) => [l.menuItemId, l.quantity])).toEqual([
      ['biryani', 2],
      ['borhani', 99],
    ]);
  });

  it('merges the same dish said twice', () => {
    const r = resolveHelperLines(
      { lines: [line({ quantity: 1 }), line({ quantity: 2 })], unmatched: [] },
      menu,
    );
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.quantity).toBe(3);
  });

  it('flags a dish with sizes when no size was said, and accepts a real size', () => {
    const none = resolveHelperLines({ lines: [line({ item_id: 'tea' })], unmatched: [] }, menu);
    expect(none.lines[0]).toMatchObject({ variantId: null, needsChoice: true });
    const bad = resolveHelperLines(
      { lines: [line({ item_id: 'tea', variant_id: 'tea-xl' })], unmatched: [] },
      menu,
    );
    expect(bad.lines[0]).toMatchObject({ variantId: null, needsChoice: true });
    const ok = resolveHelperLines(
      { lines: [line({ item_id: 'tea', variant_id: 'tea-l' })], unmatched: [] },
      menu,
    );
    expect(ok.lines[0]).toMatchObject({ variantId: 'tea-l', needsChoice: false });
  });

  it('keeps only add-ons that belong to the dish and respects the group maximum', () => {
    const r = resolveHelperLines(
      {
        lines: [
          line({ item_id: 'tea', variant_id: 'tea-s', modifier_ids: ['sugar', 'beef', 'sugar'] }),
          line({ item_id: 'burger', modifier_ids: ['beef', 'chicken'] }),
        ],
        unmatched: [],
      },
      menu,
    );
    expect(r.lines[0]!.modifierIds).toEqual(['sugar']);
    expect(r.lines[1]!.modifierIds).toEqual(['beef']);
    expect(r.lines[1]!.needsChoice).toBe(false);
  });

  it('flags a required add-on group that was not answered', () => {
    const r = resolveHelperLines({ lines: [line({ item_id: 'burger' })], unmatched: [] }, menu);
    expect(r.lines[0]!.needsChoice).toBe(true);
  });

  it('cleans the unmatched phrases', () => {
    const r = resolveHelperLines({ lines: [], unmatched: [' pizza ', '', 'x'.repeat(200)] }, menu);
    expect(r.unmatched).toHaveLength(2);
    expect(r.unmatched[0]).toBe('pizza');
    expect(r.unmatched[1]).toHaveLength(80);
  });
});

describe('menuForModel', () => {
  it('lists ids with names and never a price', () => {
    const text = menuForModel(menu);
    expect(text).toContain('biryani | Chicken Biryani / চিকেন বিরিয়ানি');
    expect(text).toContain('sizes: tea-s=Small; tea-l=Large');
    expect(text).toContain('add-ons: sugar=Extra sugar');
    expect(text).not.toMatch(/৳|poisha|price/i);
  });
});
