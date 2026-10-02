'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { now } from '@/lib/time/clock';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Hiding an item the restaurant no longer buys (ADR 0028). The rule lives in SQL
 * (set_ingredient_hidden): owner only, never while the records say some is in stock or on the way,
 * and "none left" must be said out loud when it was never counted. Audited; buying it again brings it
 * back.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export async function hideItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({
      orgId: z.uuid(),
      orgSlug: z.string().regex(SLUG),
      ingredientId: z.uuid(),
      noneLeft: z.enum(['0', '1']).default('0'),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_ingredient_hidden', {
    p_org: parsed.data.orgId,
    p_ingredient: parsed.data.ingredientId,
    p_hidden: true,
    p_now: now().toISOString(),
    p_none_left: parsed.data.noneLeft === '1',
  });
  if (error) {
    if (error.message?.includes('still in stock')) return { error: 'itemStillInStock' };
    if (error.message?.includes('stock unknown')) return { error: 'itemStockUnknown' };
    return { error: mapDbError(error) };
  }
  revalidatePath(`/${parsed.data.orgSlug}/stock`);
  return { ok: true };
}
