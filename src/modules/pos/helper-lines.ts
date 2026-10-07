import { z } from 'zod';
import type { MenuCategory } from './client';

/**
 * The cashier's AI helper (ADR 0031) turns what was said or typed — "2 chicken biryani, 1 borhani, no
 * onion" — into cart lines for the cashier to confirm. The model only *chooses* menu ids; it never sees
 * a price. Everything it returns is checked here against the menu before the cashier sees it, and the
 * till prices the lines itself (CLAUDE.md #1, #4).
 */

/** What the model is told about the menu: ids and names only. */
export interface HelperMenuItem {
  id: string;
  name: string;
  nameBn: string | null;
  variants: { id: string; name: string; nameBn: string | null }[];
  groups: {
    min: number;
    max: number;
    modifiers: { id: string; name: string; nameBn: string | null }[];
  }[];
}

export const HELPER_MAX_ITEMS = 600;

/** The sellable dishes of this till, in the shape the model gets. */
export function helperMenu(menu: MenuCategory[]): HelperMenuItem[] {
  return menu.flatMap((c) =>
    c.items
      .filter((i) => i.is_available)
      .map((i) => ({
        id: i.id,
        name: i.name,
        nameBn: i.name_bn,
        variants: i.variants
          .filter((v) => v.is_available)
          .map((v) => ({ id: v.id, name: v.name, nameBn: v.name_bn })),
        groups: i.modifier_groups.map((g) => ({
          min: g.min_select,
          max: g.max_select,
          modifiers: g.modifiers.map((m) => ({ id: m.id, name: m.name, nameBn: m.name_bn })),
        })),
      })),
  );
}

// No numeric bounds (they would not map onto structured outputs); resolveHelperLines checks every value.
export const HelperOutput = z.object({
  lines: z.array(
    z.object({
      item_id: z.string(),
      quantity: z.number(),
      variant_id: z.string(),
      modifier_ids: z.array(z.string()),
      note: z.string(),
    }),
  ),
  unmatched: z.array(z.string()),
});
export type HelperOutput = z.infer<typeof HelperOutput>;

export interface HelperLine {
  menuItemId: string;
  quantity: number;
  variantId: string | null;
  modifierIds: string[];
  note: string;
  /** A size or a required add-on was not said: the cashier must choose before it can go in the cart. */
  needsChoice: boolean;
}

export interface HelperResult {
  lines: HelperLine[];
  /** Phrases the model could not match to a dish on the menu. */
  unmatched: string[];
}

const MAX_QTY = 99;

/** Keep only what the menu allows; merge repeats; flag what still needs a person's choice. */
export function resolveHelperLines(output: HelperOutput, menu: HelperMenuItem[]): HelperResult {
  const byId = new Map(menu.map((i) => [i.id, i]));
  const merged = new Map<string, HelperLine>();

  for (const raw of output.lines) {
    const item = byId.get(raw.item_id);
    if (!item) continue;
    const quantity = Math.min(MAX_QTY, Math.floor(raw.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) continue;

    const variantId = item.variants.some((v) => v.id === raw.variant_id) ? raw.variant_id : null;

    // Add-ons must belong to this dish; a group never takes more than its maximum.
    const taken: string[] = [];
    const perGroup = item.groups.map(() => 0);
    for (const id of new Set(raw.modifier_ids)) {
      const g = item.groups.findIndex((grp) => grp.modifiers.some((m) => m.id === id));
      if (g < 0 || perGroup[g]! >= item.groups[g]!.max) continue;
      perGroup[g]! += 1;
      taken.push(id);
    }

    const note = raw.note.trim().slice(0, 100);
    const needsChoice =
      (item.variants.length > 0 && variantId === null) ||
      item.groups.some((g, idx) => perGroup[idx]! < g.min);

    const key = [item.id, variantId ?? '', [...taken].sort().join(','), note].join('|');
    const seen = merged.get(key);
    if (seen) seen.quantity = Math.min(MAX_QTY, seen.quantity + quantity);
    else
      merged.set(key, {
        menuItemId: item.id,
        quantity,
        variantId,
        modifierIds: taken,
        note,
        needsChoice,
      });
  }

  const unmatched = output.unmatched
    .map((u) => u.trim().slice(0, 80))
    .filter((u) => u !== '')
    .slice(0, 10);
  return { lines: [...merged.values()], unmatched };
}

/** The menu as text for the model: one dish per line, ids first so they are copied exactly. */
export function menuForModel(menu: HelperMenuItem[]): string {
  const names = (x: { name: string; nameBn: string | null }) =>
    x.nameBn ? `${x.name} / ${x.nameBn}` : x.name;
  return menu
    .map((i) => {
      const parts = [`${i.id} | ${names(i)}`];
      if (i.variants.length > 0)
        parts.push(`sizes: ${i.variants.map((v) => `${v.id}=${names(v)}`).join('; ')}`);
      const mods = i.groups.flatMap((g) => g.modifiers);
      if (mods.length > 0)
        parts.push(`add-ons: ${mods.map((m) => `${m.id}=${names(m)}`).join('; ')}`);
      return parts.join(' | ');
    })
    .join('\n');
}
