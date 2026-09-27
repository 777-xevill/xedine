'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { now } from '@/lib/time/clock';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/** The owner's side of "Where am I losing money?": decide on a finding, or scan now. SQL checks the role. */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const STATUSES = ['acknowledged', 'snoozed', 'resolved', 'dismissed', 'new'] as const;

const statusSchema = z
  .object({
    findingId: z.uuid(),
    orgSlug: z.string().regex(SLUG),
    status: z.enum(STATUSES),
    reason: z.string().trim().max(500).optional(),
    snoozeUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal('')),
  })
  .refine((v) => v.status !== 'dismissed' || (v.reason ?? '').length > 0, { path: ['reason'] })
  .refine((v) => v.status !== 'snoozed' || !!v.snoozeUntil, { path: ['snoozeUntil'] });

export async function setFindingStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0];
    return {
      error:
        path === 'reason'
          ? 'reasonRequired'
          : path === 'snoozeUntil'
            ? 'dateRequired'
            : 'invalidInput',
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_finding_status', {
    p_finding: parsed.data.findingId,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason || null,
    p_snooze_until: parsed.data.snoozeUntil || null,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/leaks`);
  revalidatePath(`/${parsed.data.orgSlug}`);
  return { ok: true };
}

export async function scanFindingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('scan_findings', {
    p_org: parsed.data.orgId,
    p_now: now().toISOString(),
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/leaks`);
  revalidatePath(`/${parsed.data.orgSlug}`);
  return { ok: true, data: { count: String(data ?? 0) } };
}
