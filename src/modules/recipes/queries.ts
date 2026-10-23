import 'server-only';
import { createClient } from '@/lib/db/supabase-server';
import type { BaseUnit } from '@/modules/purchasing/lines';
import type { KnownIngredient } from './dish';

/**
 * Reads behind the Dish ingredients page (ADR 0037). Access is decided in SQL: recipe readers for
 * the lines (RLS), owner and accountant for prices (require_money).
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;
const PAGE = 1000;

/** Every ingredient of the org, paged past the API's row cap so a typed name always finds its match. */
export async function allIngredients(
  supabase: Supabase,
  orgId: string,
): Promise<KnownIngredient[]> {
  const rows: KnownIngredient[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('ingredients')
      .select('id, name, name_bn, base')
      .eq('org_id', orgId)
      .order('name')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as KnownIngredient[]));
    if ((data?.length ?? 0) < PAGE) return rows;
  }
}

export interface DishLineRow {
  menu_item_id: string;
  recipe_id: string;
  version: number;
  source: 'manual' | 'ai_draft';
  /** How many plates the list makes (1, or a whole deg / pot). */
  plates: number;
  ingredient_id: string;
  name: string;
  name_bn: string | null;
  base: BaseUnit;
  /** What the line takes from stock for the whole list, in the ingredient's base unit. */
  qty: number;
}

/** Each active dish's lines as the amount taken from stock, in the order they were written. */
export async function dishRecipeLines(supabase: Supabase, orgId: string): Promise<DishLineRow[]> {
  const rows: DishLineRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .rpc('dish_recipe_lines', { p_org: orgId })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(
      ...page.map((r) => ({
        menu_item_id: r.menu_item_id as string,
        recipe_id: r.recipe_id as string,
        version: Number(r.version),
        source: r.source as DishLineRow['source'],
        plates: Number(r.plates),
        ingredient_id: r.ingredient_id as string,
        name: String(r.name),
        name_bn: (r.name_bn as string | null) ?? null,
        base: r.base as BaseUnit,
        qty: Number(r.qty),
      })),
    );
    if (page.length < PAGE) return rows;
  }
}
