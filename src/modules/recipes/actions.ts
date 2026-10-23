'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { aiErrorKey } from '@/lib/llm-gateway';
import { mapDbError } from '@/modules/tenancy/form-state';
import {
  dishLines,
  DISH_UNITS,
  editorAmount,
  findIngredient,
  MAX_DISH_ROWS,
  unitsForRow,
  type DishRow,
  type KnownIngredient,
} from './dish';
import { DISH_SUGGEST_PROMPT, suggestDish } from './drafting';
import { allIngredients } from './queries';

/**
 * Dish ingredients (ADR 0037). The owner or the manager writes what goes into one plate of each dish
 * (save_recipe, an audited RPC); "Ask AI" only suggests a list for them to check.
 * RLS and the RPCs decide every write.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const refresh = (slug: string) => {
  revalidatePath(`/${slug}/recipes`);
  revalidatePath(`/${slug}/menu-profit`);
  revalidatePath(`/${slug}/stock`);
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Only the owner and the manager write a dish's ingredients (save_recipe checks it again in SQL). */
async function canWrite(supabase: Supabase, orgId: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { data } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', auth.user.id)
    .eq('status', 'active')
    .in('role', ['owner', 'manager']);
  return (data ?? []).length > 0;
}

export type DishResult =
  { ok: true } | { ok?: false; error: string; data?: Record<string, string> };

const DishInput = base.extend({
  itemId: z.uuid(),
  rows: z
    .array(
      z.object({
        name: z.string().max(200),
        qty: z.string().max(20),
        unit: z.enum(DISH_UNITS),
        size: z.string().max(20).optional(),
      }),
    )
    .max(MAX_DISH_ROWS),
  /** The AI suggestion the list started from, if any: saving it is the person's approval. */
  draftId: z.uuid().nullable(),
});

export async function saveDishAction(input: z.input<typeof DishInput>): Promise<DishResult> {
  const parsed = DishInput.safeParse(input);
  if (!parsed.success) return { error: 'invalidInput' };
  const { orgId, orgSlug, itemId, rows, draftId } = parsed.data;
  const supabase = await createClient();
  let known: KnownIngredient[];
  try {
    known = await allIngredients(supabase, orgId);
  } catch (e) {
    return { error: mapDbError(e as { code?: string }) };
  }
  const lines = dishLines(rows, known);
  if ('error' in lines)
    return { error: lines.error, ...('name' in lines ? { data: { name: lines.name } } : {}) };
  const { error } = await supabase.rpc('save_recipe', {
    p_org: orgId,
    p_item: itemId,
    p_variant: null,
    p_name: null,
    p_yield: 1, // every list is one plate
    p_lines: lines.lines,
    p_notes: null,
    p_draft: draftId,
  });
  if (error) {
    const unit = /ingredient "(.+)" is kept in another unit/.exec(error.message ?? '');
    if (unit) return { error: 'dishUnit', data: { name: unit[1]! } };
    if (error.message?.includes('AI suggestion')) return { error: 'suggestionUsed' };
    return { error: mapDbError(error) };
  }
  refresh(orgSlug);
  return { ok: true };
}

export type SuggestResult =
  { ok: true; draftId: string; note: string; rows: DishRow[] } | { ok?: false; error: string };

const SuggestInput = base.extend({ itemId: z.uuid() });

/**
 * "Ask AI" for one dish: a suggested list, saved as a draft (who asked, which model and prompt) and
 * handed to the editor. Nothing changes in stock or cost until the person checks it and saves.
 */
export async function suggestDishAction(
  input: z.input<typeof SuggestInput>,
): Promise<SuggestResult> {
  const parsed = SuggestInput.safeParse(input);
  if (!parsed.success) return { error: 'invalidInput' };
  const { orgId, orgSlug, itemId } = parsed.data;
  const supabase = await createClient();
  // Checked before spending the org's AI allowance: the draft insert would refuse anyone else anyway.
  if (!(await canWrite(supabase, orgId))) return { error: 'notAllowed' };
  const { data: item } = await supabase
    .from('menu_items')
    .select('id, name, name_bn')
    .eq('org_id', orgId)
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return { error: 'invalidInput' };
  let known: KnownIngredient[];
  try {
    known = await allIngredients(supabase, orgId);
  } catch (e) {
    return { error: mapDbError(e as { code?: string }) };
  }
  let suggested;
  try {
    suggested = await suggestDish({
      orgId,
      dish: item.name as string,
      dishBn: (item.name_bn as string | null) ?? null,
      known: known.map((k) => ({ name: k.name, base: k.base })),
    });
  } catch (e) {
    return { error: aiErrorKey(e) };
  }
  if (suggested.lines.length === 0) return { error: 'aiFailed' };
  // One suggestion waits per dish: an older one nobody saved is set aside.
  await supabase
    .from('recipe_drafts')
    .update({ status: 'discarded' })
    .eq('org_id', orgId)
    .eq('menu_item_id', itemId)
    .eq('status', 'pending_review');
  const { data: draft, error } = await supabase
    .from('recipe_drafts')
    .insert({
      org_id: orgId,
      menu_item_id: itemId,
      item_name: item.name as string,
      payload: {
        yield_portions: 1,
        notes: suggested.note,
        lines: suggested.lines.map((l) => ({ ...l, yield_pct: 100 })),
      },
      model: suggested.model,
      prompt_key: DISH_SUGGEST_PROMPT.key,
      prompt_version: suggested.promptVersion,
    })
    .select('id')
    .single();
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${orgSlug}/recipes`);
  return {
    ok: true,
    draftId: draft.id as string,
    note: suggested.note,
    rows: suggested.lines.map((l) => {
      const match = findIngredient(l.ingredient, known);
      // A name the kitchen keeps in another unit (eggs in pieces, not grams): the person fills the amount.
      if (match && match.base !== l.base)
        return { name: match.name, qty: '', unit: unitsForRow(match)[0]! };
      return { name: match?.name ?? l.ingredient, ...editorAmount(l.qty_base, l.base) };
    }),
  };
}
