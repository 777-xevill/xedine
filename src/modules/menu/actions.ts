'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { parseTakaToPoisha } from '@/lib/money';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const categorySchema = z.object({
  orgId: z.uuid(),
  orgSlug: z.string().regex(SLUG),
  name: z.string().trim().min(1).max(120),
});

export async function createCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('menu_categories')
    .select('id')
    .eq('org_id', parsed.data.orgId);
  const { error } = await supabase.from('menu_categories').insert({
    org_id: parsed.data.orgId,
    name: parsed.data.name,
    sort_order: existing?.length ?? 0,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/menu`);
  return { ok: true };
}

const itemSchema = z.object({
  orgId: z.uuid(),
  orgSlug: z.string().regex(SLUG),
  categoryId: z.union([z.uuid(), z.literal('')]),
  name: z.string().trim().min(1).max(200),
  price: z.string().min(1),
});

export async function createItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const poisha = parseTakaToPoisha(parsed.data.price);
  if (poisha === null || poisha < 0) return { error: 'invalidInput' };

  const supabase = await createClient();
  const { error } = await supabase.from('menu_items').insert({
    org_id: parsed.data.orgId,
    category_id: parsed.data.categoryId || null,
    name: parsed.data.name,
    base_price_poisha: poisha,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/menu`);
  return { ok: true };
}

export async function toggleItemActiveAction(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get('itemId'));
  const active = formData.get('active') === 'true';
  const orgSlug = z.string().regex(SLUG).safeParse(formData.get('orgSlug'));
  if (!id.success || !orgSlug.success) return;
  const supabase = await createClient();
  await supabase.from('menu_items').update({ is_active: !active }).eq('id', id.data);
  revalidatePath(`/${orgSlug.data}/menu`);
}
