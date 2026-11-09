import type { MenuCategory } from './client';

/** One dish (or variant) that cannot be sold right now, and the ingredient behind it (ADR 0043). */
export interface BlockedItem {
  menu_item_id: string;
  variant_id: string | null;
  ingredient_name: string;
  ingredient_name_bn: string | null;
  reason: string;
}

/**
 * Takes blocked dishes off the till's menu, through the same `is_available` an 86'd item uses. Pure, so the
 * cached offline menu keeps working and a refresh only has to swap the list. A dish whose every variant is
 * blocked is blocked too, since nothing on it can be picked.
 */
export function applyFoodBlocks(menu: MenuCategory[], blocked: BlockedItem[]): MenuCategory[] {
  if (blocked.length === 0) return menu;
  const items = new Set(blocked.filter((b) => !b.variant_id).map((b) => b.menu_item_id));
  const variants = new Set(blocked.flatMap((b) => (b.variant_id ? [b.variant_id] : [])));
  return menu.map((category) => ({
    ...category,
    items: category.items.map((item) => {
      const itemVariants = item.variants.map((v) =>
        variants.has(v.id) ? { ...v, is_available: false } : v,
      );
      const noVariantLeft = itemVariants.length > 0 && itemVariants.every((v) => !v.is_available);
      const stopped = itemVariants.length > 0 ? noVariantLeft : items.has(item.id);
      return {
        ...item,
        variants: itemVariants,
        is_available: item.is_available && !stopped,
      };
    }),
  }));
}

/** The distinct ingredients behind the blocks, for the cashier's notice. */
export function blockedIngredients(blocked: BlockedItem[], locale: 'bn' | 'en'): string[] {
  return [
    ...new Set(
      blocked.map((b) =>
        locale === 'bn' && b.ingredient_name_bn ? b.ingredient_name_bn : b.ingredient_name,
      ),
    ),
  ];
}

export function isFoodSafetyRefusal(error: unknown): boolean {
  const text =
    typeof error === 'string' ? error : String((error as { message?: unknown })?.message ?? '');
  return text.includes('food_safety_blocked');
}
