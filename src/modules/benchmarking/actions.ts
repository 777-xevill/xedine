'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Benchmark opt-in (ROADMAP Phase 9, ADR 0022 §5). Owner only (RLS on org_settings); the change is audited
 * by the org_settings trigger. Opting in pools this restaurant's monthly figures, anonymously and only in
 * cells of at least five, and in return shows its peers' ranges.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export async function setBenchmarkOptInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG), optIn: z.enum(['true', 'false']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_settings')
    .update({ benchmark_opt_in: parsed.data.optIn === 'true' })
    .eq('org_id', parsed.data.orgId)
    .select('org_id');
  if (error) return { error: mapDbError(error) };
  if (!data || data.length === 0) return { error: 'notAllowed' };
  revalidatePath(`/${parsed.data.orgSlug}/benchmarks`);
  return { ok: true };
}
