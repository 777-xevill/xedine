'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Licences and the VAT due day (ROADMAP Phase 10, ADR 0023). Owner-only writes by RLS; every licence
 * change is audited by trigger. Licence kinds are free text — never a hardcoded legal list (CLAUDE.md).
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });

export async function addLicenceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      kind: z.string().trim().min(1).max(120),
      branchId: z.union([z.uuid(), z.literal('')]),
      number: z.string().trim().max(80).optional(),
      expiresOn: z.string().regex(DATE),
      issuedOn: z.union([z.string().regex(DATE), z.literal('')]).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'licenceInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.from('licences').insert({
    org_id: parsed.data.orgId,
    branch_id: parsed.data.branchId || null,
    kind: parsed.data.kind,
    number: parsed.data.number || null,
    issued_on: parsed.data.issuedOn || null,
    expires_on: parsed.data.expiresOn,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/compliance`);
  return { ok: true };
}

export async function renewLicenceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ licenceId: z.uuid(), expiresOn: z.string().regex(DATE) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'licenceInvalid' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('licences')
    .update({ expires_on: parsed.data.expiresOn })
    .eq('id', parsed.data.licenceId)
    .eq('org_id', parsed.data.orgId)
    .select('id');
  if (error) return { error: mapDbError(error) };
  if (!data || data.length === 0) return { error: 'notAllowed' };
  revalidatePath(`/${parsed.data.orgSlug}/compliance`);
  return { ok: true };
}

export async function deleteLicenceAction(formData: FormData): Promise<void> {
  const parsed = base.extend({ licenceId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('licences')
    .delete()
    .eq('id', parsed.data.licenceId)
    .eq('org_id', parsed.data.orgId);
  if (error) console.error('licence delete', error.code);
  revalidatePath(`/${parsed.data.orgSlug}/compliance`);
}

export async function setVatDueDayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ day: z.coerce.number().int().min(1).max(28) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_settings')
    .update({ vat_return_due_day: parsed.data.day })
    .eq('org_id', parsed.data.orgId)
    .select('org_id');
  if (error) return { error: mapDbError(error) };
  if (!data || data.length === 0) return { error: 'notAllowed' };
  revalidatePath(`/${parsed.data.orgSlug}/compliance`);
  return { ok: true };
}
