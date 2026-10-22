'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/** Branch-level setup (tables) for owners and branch managers (RLS: branch-scoped owner/manager writes). */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const scope = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG), branchId: z.uuid() });

const refresh = (orgSlug: string) => revalidatePath(`/${orgSlug}/branch`);

export async function createTableAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = scope
    .extend({
      name: z.string().trim().min(1).max(40),
      seats: z.union([z.literal(''), z.coerce.number().int().min(1).max(99)]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.from('dining_tables').insert({
    org_id: parsed.data.orgId,
    branch_id: parsed.data.branchId,
    name: parsed.data.name,
    seats: parsed.data.seats === '' ? null : parsed.data.seats,
  });
  if (error) return { error: error.code === '23505' ? 'nameTaken' : mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

const toggleSchema = z.object({
  orgSlug: z.string().regex(SLUG),
  id: z.uuid(),
  active: z.enum(['true', 'false']),
});

export async function toggleTableActiveAction(formData: FormData): Promise<void> {
  const parsed = toggleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('dining_tables')
    .update({ is_active: parsed.data.active !== 'true' })
    .eq('id', parsed.data.id);
  if (error) console.error('table toggle', error.code);
  refresh(parsed.data.orgSlug);
}
