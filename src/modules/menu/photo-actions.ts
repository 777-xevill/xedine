'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';

/**
 * Dish photos for the till (ADR 0031). The browser resizes the picture to a small WebP and uploads it
 * straight to the `menu-photos` bucket (storage policy: owner, own org's folder only); this action then
 * points the dish at it. The path must sit in the org's own folder — the database check agrees.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export async function setItemPhotoAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z
    .object({
      orgId: z.uuid(),
      orgSlug: z.string().regex(SLUG),
      itemId: z.uuid(),
      path: z.string().max(200).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalidInput' };
  const { orgId, orgSlug, itemId, path } = parsed.data;
  if (path !== null && !new RegExp(`^${orgId}/[A-Za-z0-9-]{8,80}\\.(webp|jpg)$`).test(path)) {
    return { ok: false, error: 'invalidInput' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('menu_items')
    .update({ photo_path: path })
    .eq('org_id', orgId)
    .eq('id', itemId)
    .select('id');
  // RLS turns "not the owner" into zero rows rather than an error.
  if (error || !data || data.length === 0) return { ok: false, error: 'notAllowed' };
  revalidatePath(`/${orgSlug}/menu`);
  return { ok: true };
}
