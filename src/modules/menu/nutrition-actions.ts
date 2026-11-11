'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { aiErrorKey } from '@/lib/llm-gateway';
import { mapDbError } from '@/modules/tenancy/form-state';
import { ALLERGENS } from './food-facts';
import { GUESS_BATCH, guessNutrition, type GuessInput } from './nutrition';

/**
 * Food facts (ADR 0049). The owner or a manager asks the AI for a first guess, checks it, and approves.
 * Every write is an RPC that checks the role again in SQL and audits the approval.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
type Supabase = Awaited<ReturnType<typeof createClient>>;

const refresh = (slug: string) => revalidatePath(`/${slug}/nutrition`);

/** Dishes per "Fill with AI" tap: two AI calls, so one tap stays well inside a request's time. */
const PER_TAP = GUESS_BATCH * 2;

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

/** "Chicken 150 g, Rice 200 g" for each dish that has its ingredients written (ADR 0037). */
async function ingredientsByDish(
  supabase: Supabase,
  orgId: string,
  itemIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data: recipes } = await supabase
    .from('recipes')
    .select('id, menu_item_id, yield_portions')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .is('variant_id', null)
    .in('menu_item_id', itemIds);
  if (!recipes?.length) return out;
  const { data: lines } = await supabase
    .from('recipe_lines')
    .select('recipe_id, qty_base, ingredients(name, base)')
    .eq('org_id', orgId)
    .in(
      'recipe_id',
      recipes.map((r) => r.id as string),
    );
  for (const r of recipes) {
    const portions = Number(r.yield_portions) || 1;
    const parts = (lines ?? [])
      .filter((l) => l.recipe_id === r.id)
      .map((l) => {
        const ing = (Array.isArray(l.ingredients) ? l.ingredients[0] : l.ingredients) as
          { name?: string; base?: string } | null | undefined;
        if (!ing?.name) return null;
        const qty = Math.round((Number(l.qty_base) / portions) * 10) / 10;
        return `${ing.name} ${qty} ${ing.base ?? ''}`.trim();
      })
      .filter((x): x is string => x !== null)
      .slice(0, 15);
    if (parts.length) out.set(r.menu_item_id as string, parts.join(', '));
  }
  return out;
}

export type FillResult = { ok: true; count: number; left: number } | { ok?: false; error: string };

const FillInput = base.extend({ itemIds: z.array(z.uuid()).max(PER_TAP).optional() });

/**
 * "Fill with AI": guesses for dishes with no facts yet (or the dishes named, for "Ask AI again").
 * Guesses wait for a person's approval; an approved dish is never overwritten by a guess.
 */
export async function fillNutritionAction(input: z.input<typeof FillInput>): Promise<FillResult> {
  const parsed = FillInput.safeParse(input);
  if (!parsed.success) return { error: 'invalidInput' };
  const { orgId, orgSlug, itemIds } = parsed.data;
  const supabase = await createClient();
  if (!(await canWrite(supabase, orgId))) return { error: 'notAllowed' };

  const [{ data: items, error }, { data: facts }] = await Promise.all([
    supabase
      .from('menu_items')
      .select('id, name, name_bn, menu_categories(name)')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sort_order')
      .order('name')
      .limit(500),
    supabase.from('dish_nutrition').select('menu_item_id, status').eq('org_id', orgId),
  ]);
  if (error) return { error: mapDbError(error) };
  const status = new Map((facts ?? []).map((f) => [f.menu_item_id as string, f.status as string]));
  const wanted = itemIds
    ? (items ?? []).filter(
        (i) => itemIds.includes(i.id as string) && status.get(i.id as string) !== 'approved',
      )
    : (items ?? []).filter((i) => !status.has(i.id as string));
  const todo = wanted.slice(0, PER_TAP);
  if (todo.length === 0) return { ok: true, count: 0, left: 0 };

  const ingredients = await ingredientsByDish(
    supabase,
    orgId,
    todo.map((i) => i.id as string),
  ).catch(() => new Map<string, string>());
  const inputs: GuessInput[] = todo.map((i) => {
    const cat = (Array.isArray(i.menu_categories) ? i.menu_categories[0] : i.menu_categories) as
      { name?: string } | null | undefined;
    return {
      id: i.id as string,
      name: i.name as string,
      name_bn: (i.name_bn as string | null) ?? null,
      category: cat?.name ?? null,
      ingredients: ingredients.get(i.id as string) ?? null,
    };
  });

  let count = 0;
  for (let i = 0; i < inputs.length; i += GUESS_BATCH) {
    let out;
    try {
      out = await guessNutrition(orgId, inputs.slice(i, i + GUESS_BATCH));
    } catch (e) {
      if (count > 0) break; // keep what the first batch saved
      return { error: aiErrorKey(e) };
    }
    if (out.guesses.length === 0) continue;
    const { data: saved, error: saveError } = await supabase.rpc('put_nutrition_guesses', {
      p_org: orgId,
      p_rows: out.guesses,
      p_model: out.model,
      p_prompt_version: out.promptVersion,
    });
    if (saveError) return { error: mapDbError(saveError) };
    count += Number(saved ?? 0);
  }
  if (count === 0) return { error: 'aiFailed' };
  refresh(orgSlug);
  return { ok: true, count, left: Math.max(0, wanted.length - todo.length) };
}

const grams = z.coerce.number().min(0).max(500);
const ApproveInput = base.extend({
  itemId: z.uuid(),
  kcal: z.coerce.number().int().min(0).max(5000),
  protein_g: grams,
  carbs_g: z.coerce.number().min(0).max(1000),
  fat_g: grams,
  allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length),
});

export type NutritionResult = { ok: true } | { ok?: false; error: string };

/** Approve one dish's facts, as shown or as the person changed them. Customers see them from now on. */
export async function approveNutritionAction(
  input: z.input<typeof ApproveInput>,
): Promise<NutritionResult> {
  const parsed = ApproveInput.safeParse(input);
  if (!parsed.success) return { error: 'invalidInput' };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_dish_nutrition', {
    p_org: d.orgId,
    p_item: d.itemId,
    p_kcal: d.kcal,
    p_protein: d.protein_g,
    p_carbs: d.carbs_g,
    p_fat: d.fat_g,
    p_allergens: d.allergens,
  });
  if (error) return { error: mapDbError(error) };
  refresh(d.orgSlug);
  return { ok: true };
}

export type ApproveAllResult = { ok: true; count: number } | { ok?: false; error: string };

/** "Approve all AI guesses": the person's one tap approves every guess as it stands. */
export async function approveAllGuessesAction(
  input: z.input<typeof base>,
): Promise<ApproveAllResult> {
  const parsed = base.safeParse(input);
  if (!parsed.success) return { error: 'invalidInput' };
  const { orgId, orgSlug } = parsed.data;
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('dish_nutrition')
    .select('menu_item_id, kcal, protein_g, carbs_g, fat_g, allergens')
    .eq('org_id', orgId)
    .eq('status', 'ai_guess')
    .limit(300);
  if (error) return { error: mapDbError(error) };
  let count = 0;
  for (const r of rows ?? []) {
    const { error: e } = await supabase.rpc('approve_dish_nutrition', {
      p_org: orgId,
      p_item: r.menu_item_id as string,
      p_kcal: Number(r.kcal),
      p_protein: Number(r.protein_g),
      p_carbs: Number(r.carbs_g),
      p_fat: Number(r.fat_g),
      p_allergens: (r.allergens as string[]) ?? [],
    });
    if (e) return { error: mapDbError(e) };
    count += 1;
  }
  refresh(orgSlug);
  return { ok: true, count };
}

const ClearInput = base.extend({ itemId: z.uuid() });

/** Remove a dish's facts: the customer sees none for it until new ones are approved. */
export async function clearNutritionAction(
  input: z.input<typeof ClearInput>,
): Promise<NutritionResult> {
  const parsed = ClearInput.safeParse(input);
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('clear_dish_nutrition', {
    p_org: parsed.data.orgId,
    p_item: parsed.data.itemId,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}
