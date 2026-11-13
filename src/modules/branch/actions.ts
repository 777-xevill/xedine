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
  const seats = parsed.data.seats === '' ? null : parsed.data.seats;
  const { error } = await supabase.from('dining_tables').insert({
    org_id: parsed.data.orgId,
    branch_id: parsed.data.branchId,
    name: parsed.data.name,
    seats,
  });
  if (error) {
    if (error.code !== '23505') return { error: mapDbError(error) };
    // The name exists. If that table was removed earlier it comes back (same QR code) instead of
    // clashing with a table nobody can see in the list of live tables.
    const { data: old } = await supabase
      .from('dining_tables')
      .select('id, is_active')
      .eq('org_id', parsed.data.orgId)
      .eq('branch_id', parsed.data.branchId)
      .eq('name', parsed.data.name)
      .maybeSingle();
    if (!old || old.is_active) return { error: 'nameTaken' };
    const { error: backError } = await supabase
      .from('dining_tables')
      .update({ is_active: true, seats })
      .eq('org_id', parsed.data.orgId)
      .eq('id', old.id);
    if (backError) return { error: mapDbError(backError) };
  }
  refresh(parsed.data.orgSlug);
  revalidatePath(`/${parsed.data.orgSlug}/table-qr`);
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
  revalidatePath(`/${parsed.data.orgSlug}/table-qr`);
}

/**
 * The owner sets (or clears) where a branch is, for its weather (ADR 0051). Both boxes empty = clear: the
 * weather then follows the branch's area or city. Audited in SQL (set_branch_location).
 */
export async function setBranchLocationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const coord = (min: number, max: number) =>
    z.union([z.literal(''), z.coerce.number().min(min).max(max)]);
  const parsed = scope
    .extend({ latitude: coord(-90, 90), longitude: coord(-180, 180) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  // "Use the area's weather instead" sends clear=1: both boxes empty.
  const cleared = formData.get('clear') === '1';
  const latitude = cleared ? '' : parsed.data.latitude;
  const longitude = cleared ? '' : parsed.data.longitude;
  if ((latitude === '') !== (longitude === '')) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_branch_location', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId,
    p_lat: latitude === '' ? null : latitude,
    p_lon: longitude === '' ? null : longitude,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  revalidatePath(`/${parsed.data.orgSlug}/plan`);
  return { ok: true };
}
