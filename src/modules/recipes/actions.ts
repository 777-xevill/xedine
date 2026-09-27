'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { AiError } from '@/lib/llm-gateway';
import { parseTakaToPoisha } from '@/lib/money';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';
import { draftRecipes, RECIPE_DRAFT_PROMPT } from './drafting';

/**
 * Recipes and ingredients (ROADMAP Phase 3). Saving and approving are owner RPCs in SQL; the chef
 * (kitchen) drafts and edits drafts; prices are owner-only rows (ADR 0007). RLS decides every write.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const refresh = (slug: string) => {
  revalidatePath(`/${slug}/recipes`);
  revalidatePath(`/${slug}/menu-profit`);
};
const BASES = ['g', 'ml', 'pcs'] as const;

/** Price per kg / litre / piece, as the owner thinks of it; stored per 1,000 g or ml, or per piece. */
export async function addIngredientAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      name: z.string().trim().min(1).max(120),
      base: z.enum(BASES),
      price: z.string().trim(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const price = parsed.data.price === '' ? null : parseTakaToPoisha(parsed.data.price);
  if (price !== null && price < 0) return { error: 'invalidPrice' };
  if (parsed.data.price !== '' && price === null) return { error: 'invalidPrice' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ingredients')
    .insert({ org_id: parsed.data.orgId, name: parsed.data.name, base: parsed.data.base })
    .select('id')
    .single();
  if (error) return { error: error.code === '23505' ? 'nameTaken' : mapDbError(error) };
  if (price !== null) {
    const { error: costError } = await supabase.from('ingredient_costs').insert({
      ingredient_id: data.id,
      org_id: parsed.data.orgId,
      manual_cost_poisha: price,
      per_base_qty: parsed.data.base === 'pcs' ? 1 : 1000,
    });
    if (costError) return { error: mapDbError(costError) };
  }
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function setIngredientPriceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({ ingredientId: z.uuid(), base: z.enum(BASES), price: z.string().trim().min(1) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const price = parseTakaToPoisha(parsed.data.price);
  if (price === null || price < 0) return { error: 'invalidPrice' };
  const supabase = await createClient();
  // The trigger on ingredient_costs writes today's row of price history.
  const { error } = await supabase.from('ingredient_costs').upsert({
    ingredient_id: parsed.data.ingredientId,
    org_id: parsed.data.orgId,
    manual_cost_poisha: price,
    per_base_qty: parsed.data.base === 'pcs' ? 1 : 1000,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

const LineSchema = z.object({
  ingredient_id: z.uuid(),
  qty_base: z.number().positive(),
  yield_pct: z.number().gt(0).max(100),
});

/** Rows named line-<i>-ingredient / -qty / -yield; blank rows are skipped. */
function readLines(formData: FormData) {
  const lines: z.infer<typeof LineSchema>[] = [];
  for (let i = 0; i < 30; i++) {
    const ingredient = String(formData.get(`line-${i}-ingredient`) ?? '');
    const qty = String(formData.get(`line-${i}-qty`) ?? '').trim();
    if (!ingredient || !qty) continue;
    const yieldPct = String(formData.get(`line-${i}-yield`) ?? '').trim();
    const parsed = LineSchema.safeParse({
      ingredient_id: ingredient,
      qty_base: Number(qty),
      yield_pct: yieldPct === '' ? 100 : Number(yieldPct),
    });
    if (!parsed.success) return null;
    lines.push(parsed.data);
  }
  return lines;
}

export async function saveRecipeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ itemId: z.uuid(), yieldPortions: z.coerce.number().positive().max(1000) })
    .safeParse(Object.fromEntries(formData));
  const lines = readLines(formData);
  if (!parsed.success || !lines || lines.length === 0) return { error: 'recipeInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_recipe', {
    p_org: parsed.data.orgId,
    p_item: parsed.data.itemId,
    p_variant: null,
    p_name: null,
    p_yield: parsed.data.yieldPortions,
    p_lines: lines,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// AI drafts
// ---------------------------------------------------------------------------------------------
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function draftRecipesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base.extend({ menuText: z.string().max(8000).optional() }).safeParse({
    orgId: formData.get('orgId'),
    orgSlug: formData.get('orgSlug'),
    menuText: formData.get('menuText') ?? undefined,
  });
  if (!parsed.success) return { error: 'invalidInput' };
  const photo = formData.get('photo');
  let image: { mediaType: (typeof IMAGE_TYPES)[number]; base64: string } | undefined;
  if (photo instanceof File && photo.size > 0) {
    if (!(IMAGE_TYPES as readonly string[]).includes(photo.type) || photo.size > MAX_IMAGE_BYTES)
      return { error: 'photoInvalid' };
    image = {
      mediaType: photo.type as (typeof IMAGE_TYPES)[number],
      base64: Buffer.from(await photo.arrayBuffer()).toString('base64'),
    };
  }
  if (!image && !parsed.data.menuText?.trim()) return { error: 'menuRequired' };

  const supabase = await createClient();
  const { data: menu } = await supabase
    .from('menu_items')
    .select('id, name')
    .eq('org_id', parsed.data.orgId);
  let drafted;
  try {
    drafted = await draftRecipes({
      orgId: parsed.data.orgId,
      menuText: parsed.data.menuText,
      image,
    });
  } catch (e) {
    if (e instanceof AiError)
      return {
        error:
          e.code === 'not_configured'
            ? 'aiNotConfigured'
            : e.code === 'cap_exceeded'
              ? 'aiCapExceeded'
              : 'aiFailed',
      };
    return { error: 'aiFailed' };
  }
  const byName = new Map((menu ?? []).map((m) => [m.name.trim().toLowerCase(), m.id as string]));
  const rows = drafted.recipes.map((r) => ({
    org_id: parsed.data.orgId,
    menu_item_id: byName.get(r.item_name.trim().toLowerCase()) ?? null,
    item_name: r.item_name.trim(),
    payload: { yield_portions: r.yield_portions, notes: r.notes, lines: r.lines },
    model: drafted.model,
    prompt_key: RECIPE_DRAFT_PROMPT.key,
    prompt_version: drafted.promptVersion,
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from('recipe_drafts').insert(rows);
    if (error) return { error: mapDbError(error) };
  }
  refresh(parsed.data.orgSlug);
  return { ok: true, data: { count: String(rows.length) } };
}

/** The chef's edit of a draft: lines as ingredient names (new ones are created on approval). */
export async function updateDraftAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      draftId: z.uuid(),
      menuItemId: z.union([z.uuid(), z.literal('')]),
      yieldPortions: z.coerce.number().positive().max(1000),
      notes: z.string().max(1000).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'recipeInvalid' };
  const lines: { ingredient: string; base: string; qty_base: number; yield_pct: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const name = String(formData.get(`line-${i}-name`) ?? '').trim();
    const qty = Number(String(formData.get(`line-${i}-qty`) ?? '').trim());
    if (!name) continue;
    const baseUnit = String(formData.get(`line-${i}-base`) ?? 'g');
    const yieldPct = Number(String(formData.get(`line-${i}-yield`) ?? '100').trim() || 100);
    if (
      !(qty > 0) ||
      !(yieldPct > 0 && yieldPct <= 100) ||
      !(BASES as readonly string[]).includes(baseUnit)
    )
      return { error: 'recipeInvalid' };
    lines.push({
      ingredient: name.slice(0, 120),
      base: baseUnit,
      qty_base: qty,
      yield_pct: yieldPct,
    });
  }
  if (lines.length === 0) return { error: 'recipeInvalid' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('recipe_drafts')
    .update({
      menu_item_id: parsed.data.menuItemId || null,
      payload: { yield_portions: parsed.data.yieldPortions, notes: parsed.data.notes ?? '', lines },
    })
    .eq('id', parsed.data.draftId)
    .eq('org_id', parsed.data.orgId)
    .eq('status', 'pending_review');
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function approveDraftAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base.extend({ draftId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_recipe_draft', { p_draft: parsed.data.draftId });
  if (error)
    return { error: error.message.includes('menu item') ? 'draftNeedsItem' : mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function discardDraftAction(formData: FormData): Promise<void> {
  const parsed = base.extend({ draftId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('recipe_drafts')
    .update({ status: 'discarded' })
    .eq('id', parsed.data.draftId)
    .eq('org_id', parsed.data.orgId)
    .eq('status', 'pending_review');
  if (error) console.error('draft discard', error.code);
  refresh(parsed.data.orgSlug);
}
