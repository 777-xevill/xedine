'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';
import { MAX_NAME, NAME_KEYS, parseGameNames } from '@/modules/games/catalog';
import { MAX_TABLES, missingTableNumbers, parseGoogleReviewUrl } from './table-qr';

/**
 * Table QR (ADR 0045), owner or branch manager. Tables are written through RLS (branch-scoped owner/manager
 * writes, as on Branch setup); a new link and the Google link go through SQL functions that check the role.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG), branchId: z.uuid() });
const entries = (formData: FormData) => Object.fromEntries(formData);
const done = (slug: string): FormState => {
  revalidatePath(`/${slug}/table-qr`);
  return { ok: true };
};

/** "How many tables?" → tables 1…N, adding only the numbers the branch does not have yet. */
export async function makeTablesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ count: z.coerce.number().int().min(1).max(MAX_TABLES) })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const { orgId, branchId, count } = parsed.data;
  const supabase = await createClient();
  const { data: rows, error: readError } = await supabase
    .from('dining_tables')
    .select('id, name, is_active')
    .eq('org_id', orgId)
    .eq('branch_id', branchId);
  if (readError) return { error: mapDbError(readError) };
  const existing = rows ?? [];
  // A removed table with the same number comes back rather than clashing with its name.
  const back = existing
    .filter((r) => !r.is_active && /^\d+$/.test(r.name) && Number(r.name) <= count)
    .map((r) => r.id);
  if (back.length > 0) {
    const { error } = await supabase
      .from('dining_tables')
      .update({ is_active: true })
      .eq('org_id', orgId)
      .in('id', back);
    if (error) return { error: mapDbError(error) };
  }
  const add = missingTableNumbers(
    existing.map((r) => r.name),
    count,
  );
  if (add.length > 0) {
    const { error } = await supabase
      .from('dining_tables')
      .insert(add.map((name) => ({ org_id: orgId, branch_id: branchId, name })));
    if (error) return { error: error.code === '23505' ? 'nameTaken' : mapDbError(error) };
  }
  return done(parsed.data.orgSlug);
}

/** A new link for one table: its old printed QR stops working. */
export async function resetTableLinkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.extend({ tableId: z.uuid() }).safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('reset_table_link', {
    p_org: parsed.data.orgId,
    p_table: parsed.data.tableId,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

/** The branch's Google review link; empty clears it. */
export async function saveGoogleReviewAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.extend({ url: z.string().max(500) }).safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const typed = parsed.data.url.trim();
  const url = typed ? parseGoogleReviewUrl(typed) : null;
  if (typed && !url) return { error: 'googleLinkInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_google_review_url', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId,
    p_url: url ?? '',
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

/** A new complaint box link for the branch (ADR 0043), for a link someone is misusing. */
export async function resetComplaintBoxAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('reset_complaint_link', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId,
  });
  if (error) return { error: mapDbError(error) };
  return done(parsed.data.orgSlug);
}

/**
 * Games on the table page (ADR 0046), owner only through org_settings' RLS: on or off, and the owner's own
 * name for each game and for the host character. An empty name keeps the default.
 */
export async function saveGamesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({
      orgId: z.uuid(),
      orgSlug: z.string().regex(SLUG),
      on: z.enum(['on']).optional(),
      ...Object.fromEntries(
        NAME_KEYS.map((k) => [`name_${k}`, z.string().max(MAX_NAME).optional()]),
      ),
    })
    .safeParse(entries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const data = parsed.data as Record<string, string | undefined>;
  const names = parseGameNames(
    Object.fromEntries(NAME_KEYS.map((k) => [k, data[`name_${k}`] ?? ''])),
  );
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from('org_settings')
    .update({ games_on: parsed.data.on === 'on', game_names: names })
    .eq('org_id', parsed.data.orgId)
    .select('org_id');
  if (error) return { error: mapDbError(error) };
  if (!updated?.length) return { error: 'notAllowed' };
  revalidatePath(`/${parsed.data.orgSlug}/table-qr`);
  return { ok: true };
}
