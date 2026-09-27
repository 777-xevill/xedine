'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { parseTakaToPoisha } from '@/lib/money';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/** Owner-only catalogue edits (RLS: menu tables are written by the owner). Price edits are audited by triggers. */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const optionalText = z
  .string()
  .trim()
  .max(120)
  .transform((v) => (v === '' ? null : v));
const optionalUuid = z.union([z.uuid(), z.literal('')]).transform((v) => (v === '' ? null : v));

const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });

function poisha(input: unknown, allowNegative = false): number | null {
  if (typeof input !== 'string' || input.trim() === '') return null;
  const value = parseTakaToPoisha(input);
  if (value === null || (!allowNegative && value < 0)) return null;
  return value;
}

const done = (orgSlug: string): FormState => {
  revalidatePath(`/${orgSlug}/menu`);
  return { ok: true };
};

// ------------------------------------------------------------------------------------------
// Categories
// ------------------------------------------------------------------------------------------
const categorySchema = base.extend({
  name: z.string().trim().min(1).max(120),
  nameBn: optionalText.optional(),
});

export async function createCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { count } = await supabase
    .from('menu_categories')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', parsed.data.orgId);
  const { error } = await supabase.from('menu_categories').insert({
    org_id: parsed.data.orgId,
    name: parsed.data.name,
    name_bn: parsed.data.nameBn ?? null,
    sort_order: count ?? 0,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

export async function updateCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = categorySchema
    .extend({ categoryId: z.uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('menu_categories')
    .update({ name: parsed.data.name, name_bn: parsed.data.nameBn ?? null })
    .eq('org_id', parsed.data.orgId)
    .eq('id', parsed.data.categoryId);
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

// ------------------------------------------------------------------------------------------
// Items
// ------------------------------------------------------------------------------------------
const itemSchema = base.extend({
  name: z.string().trim().min(1).max(200),
  nameBn: optionalText.optional(),
  categoryId: optionalUuid,
  stationId: optionalUuid.optional(),
  price: z.string().min(1),
});

export async function createItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const price = poisha(parsed.data.price);
  if (price === null) return { error: 'invalidPrice' };

  const supabase = await createClient();
  const { error } = await supabase.from('menu_items').insert({
    org_id: parsed.data.orgId,
    category_id: parsed.data.categoryId,
    name: parsed.data.name,
    name_bn: parsed.data.nameBn ?? null,
    station_default_id: parsed.data.stationId ?? null,
    base_price_poisha: price,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

export async function updateItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = itemSchema.extend({ itemId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const price = poisha(parsed.data.price);
  if (price === null) return { error: 'invalidPrice' };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from('menu_items')
    .update({
      category_id: parsed.data.categoryId,
      name: parsed.data.name,
      name_bn: parsed.data.nameBn ?? null,
      station_default_id: parsed.data.stationId ?? null,
      base_price_poisha: price,
    })
    .eq('org_id', parsed.data.orgId)
    .eq('id', parsed.data.itemId)
    .select('id');
  if (error) return { error: mapDbError(error) };
  if (!data || data.length === 0) return { error: 'notAllowed' };
  return done(parsed.data.orgSlug);
}

const toggleSchema = z.object({
  orgSlug: z.string().regex(SLUG),
  id: z.uuid(),
  active: z.enum(['true', 'false']),
});

async function toggle(
  table: 'menu_items' | 'menu_categories' | 'item_variants' | 'modifiers' | 'modifier_groups',
  formData: FormData,
): Promise<void> {
  const parsed = toggleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from(table)
    .update({ is_active: parsed.data.active !== 'true' })
    .eq('id', parsed.data.id);
  if (error) console.error(`toggle ${table}`, error.code);
  revalidatePath(`/${parsed.data.orgSlug}/menu`);
}

export async function toggleItemActiveAction(formData: FormData): Promise<void> {
  await toggle('menu_items', formData);
}
export async function toggleCategoryActiveAction(formData: FormData): Promise<void> {
  await toggle('menu_categories', formData);
}
export async function toggleVariantActiveAction(formData: FormData): Promise<void> {
  await toggle('item_variants', formData);
}
export async function toggleModifierActiveAction(formData: FormData): Promise<void> {
  await toggle('modifiers', formData);
}
export async function toggleModifierGroupActiveAction(formData: FormData): Promise<void> {
  await toggle('modifier_groups', formData);
}

// ------------------------------------------------------------------------------------------
// Variants (size/portion) — a price delta on top of the item's base price
// ------------------------------------------------------------------------------------------
const variantSchema = base.extend({
  itemId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  nameBn: optionalText.optional(),
  delta: z.string(),
});

export async function createVariantAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = variantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const delta = parsed.data.delta.trim() === '' ? 0 : poisha(parsed.data.delta, true);
  if (delta === null) return { error: 'invalidPrice' };
  const supabase = await createClient();
  const { error } = await supabase.from('item_variants').insert({
    org_id: parsed.data.orgId,
    menu_item_id: parsed.data.itemId,
    name: parsed.data.name,
    name_bn: parsed.data.nameBn ?? null,
    price_delta_poisha: delta,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

// ------------------------------------------------------------------------------------------
// Add-on groups and add-ons
// ------------------------------------------------------------------------------------------
const groupSchema = base.extend({
  name: z.string().trim().min(1).max(80),
  nameBn: optionalText.optional(),
  minSelect: z.coerce.number().int().min(0).max(20),
  maxSelect: z.coerce.number().int().min(1).max(20),
});

export async function createModifierGroupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = groupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || parsed.data.minSelect > parsed.data.maxSelect) {
    return { error: 'invalidInput' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('modifier_groups').insert({
    org_id: parsed.data.orgId,
    name: parsed.data.name,
    name_bn: parsed.data.nameBn ?? null,
    min_select: parsed.data.minSelect,
    max_select: parsed.data.maxSelect,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

const modifierSchema = base.extend({
  groupId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  nameBn: optionalText.optional(),
  price: z.string(),
});

export async function createModifierAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = modifierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const price = parsed.data.price.trim() === '' ? 0 : poisha(parsed.data.price);
  if (price === null) return { error: 'invalidPrice' };
  const supabase = await createClient();
  const { count } = await supabase
    .from('modifiers')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', parsed.data.groupId);
  const { error } = await supabase.from('modifiers').insert({
    org_id: parsed.data.orgId,
    group_id: parsed.data.groupId,
    name: parsed.data.name,
    name_bn: parsed.data.nameBn ?? null,
    price_poisha: price,
    sort_order: count ?? 0,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

/** Replace the set of add-on groups offered on an item. */
export async function setItemModifierGroupsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.extend({ itemId: z.uuid() }).safeParse({
    orgId: formData.get('orgId'),
    orgSlug: formData.get('orgSlug'),
    itemId: formData.get('itemId'),
  });
  if (!parsed.success) return { error: 'invalidInput' };
  const wanted = new Set(
    formData
      .getAll('groupIds')
      .map(String)
      .filter((id) => z.uuid().safeParse(id).success),
  );
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from('menu_item_modifier_groups')
    .select('modifier_group_id')
    .eq('org_id', parsed.data.orgId)
    .eq('menu_item_id', parsed.data.itemId);
  if (readError) return { error: mapDbError(readError) };
  const have = new Set((current ?? []).map((r) => r.modifier_group_id as string));
  const remove = [...have].filter((id) => !wanted.has(id));
  const add = [...wanted].filter((id) => !have.has(id));
  if (remove.length > 0) {
    const { error } = await supabase
      .from('menu_item_modifier_groups')
      .delete()
      .eq('org_id', parsed.data.orgId)
      .eq('menu_item_id', parsed.data.itemId)
      .in('modifier_group_id', remove);
    if (error) return { error: mapDbError(error) };
  }
  if (add.length > 0) {
    const { error } = await supabase.from('menu_item_modifier_groups').insert(
      add.map((groupId) => ({
        org_id: parsed.data.orgId,
        menu_item_id: parsed.data.itemId,
        modifier_group_id: groupId,
      })),
    );
    if (error) return { error: mapDbError(error) };
  }
  return done(parsed.data.orgSlug);
}
