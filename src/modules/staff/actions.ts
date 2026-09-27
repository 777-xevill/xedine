'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * PIN staff for shared tills (ADR 0003/0013). The database decides who may create what: a branch
 * manager can add cashiers and kitchen staff; only the owner can create manager-level staff or reset
 * their PINs (ADR 0014). Every change is audited by triggers and the PIN RPC.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const STAFF_ROLES = ['manager', 'cashier', 'kitchen', 'owner'] as const;
const PIN = z.string().regex(/^\d{4,6}$/);

const staffSchema = z.object({
  orgId: z.uuid(),
  orgSlug: z.string().regex(SLUG),
  branchId: z.uuid(),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(STAFF_ROLES),
  pin: z.union([z.literal(''), PIN]),
});

export async function createStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = staffSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues.some((i) => i.path[0] === 'pin') ? 'pinInvalid' : 'invalidInput',
    };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('staff')
    .insert({
      org_id: parsed.data.orgId,
      branch_id: parsed.data.branchId,
      display_name: parsed.data.displayName,
      role: parsed.data.role,
    })
    .select('id')
    .single();
  if (error) return { error: mapDbError(error) };
  if (parsed.data.pin) {
    const { error: pinError } = await supabase.rpc('set_staff_pin', {
      p_staff: data.id,
      p_pin: parsed.data.pin,
    });
    if (pinError) return { error: mapDbError(pinError) };
  }
  revalidatePath(`/${parsed.data.orgSlug}/staff`);
  return { ok: true };
}

const pinSchema = z.object({
  staffId: z.uuid(),
  orgSlug: z.string().regex(SLUG),
  pin: PIN,
});

export async function setStaffPinAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = pinSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'pinInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_staff_pin', {
    p_staff: parsed.data.staffId,
    p_pin: parsed.data.pin,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/staff`);
  return { ok: true };
}

export async function toggleStaffActiveAction(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get('staffId'));
  const orgSlug = z.string().regex(SLUG).safeParse(formData.get('orgSlug'));
  if (!id.success || !orgSlug.success) return;
  const active = formData.get('active') === 'true';
  const supabase = await createClient();
  const { error } = await supabase.from('staff').update({ is_active: !active }).eq('id', id.data);
  if (error) console.error('staff toggle', error.code);
  revalidatePath(`/${orgSlug.data}/staff`);
}

export async function revokeDeviceAction(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get('deviceId'));
  const orgSlug = z.string().regex(SLUG).safeParse(formData.get('orgSlug'));
  if (!id.success || !orgSlug.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('revoke_device', { p_device: id.data });
  if (error) console.error('device revoke', error.code);
  revalidatePath(`/${orgSlug.data}/staff`);
}
