'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { aiErrorKey } from '@/lib/llm-gateway';
import { parseMenuCsv } from '@/modules/menu/import';
import { MENU_PHOTO_PROMPT, readMenuPhoto } from '@/modules/menu/photo';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/** Onboarding menu import (ROADMAP Phase 10): CSV in, or a photo read into an editable CSV draft. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });

export async function importMenuAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      csv: z.string().min(1).max(60_000),
      draftId: z.union([z.uuid(), z.literal('')]).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'menuImportInvalid' };
  const { rows, badLines } = parseMenuCsv(parsed.data.csv);
  if (badLines.length > 0)
    return { error: 'menuImportBadLines', data: { lines: badLines.slice(0, 20).join(', ') } };
  if (rows.length === 0 || rows.length > 500) return { error: 'menuImportInvalid' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('import_menu', {
    p_org: parsed.data.orgId,
    p_rows: rows,
  });
  if (error) return { error: mapDbError(error) };
  if (parsed.data.draftId)
    await supabase
      .from('menu_import_drafts')
      .delete()
      .eq('id', parsed.data.draftId)
      .eq('org_id', parsed.data.orgId);
  revalidatePath(`/${parsed.data.orgSlug}/setup`);
  revalidatePath(`/${parsed.data.orgSlug}/menu`);
  const r = (data ?? {}) as Record<string, number>;
  return { ok: true, data: { created: String(r.created ?? 0), skipped: String(r.skipped ?? 0) } };
}

export async function readMenuPhotoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.safeParse({ orgId: formData.get('orgId'), orgSlug: formData.get('orgSlug') });
  if (!parsed.success) return { error: 'invalidInput' };
  const photo = formData.get('photo');
  if (
    !(photo instanceof File) ||
    photo.size === 0 ||
    photo.size > MAX_IMAGE_BYTES ||
    !(IMAGE_TYPES as readonly string[]).includes(photo.type)
  )
    return { error: 'photoInvalid' };
  const supabase = await createClient();
  // Only an owner may create drafts (RLS insert policy) — checked here too, before spending the org's AI
  // allowance: reading `organizations` only proves membership (any active role), not ownership.
  const { data: auth } = await supabase.auth.getUser();
  const { data: owner } = auth.user
    ? await supabase
        .from('memberships')
        .select('role')
        .eq('org_id', parsed.data.orgId)
        .eq('user_id', auth.user.id)
        .eq('status', 'active')
        .eq('role', 'owner')
        .maybeSingle()
    : { data: null };
  if (!owner) return { error: 'notAllowed' };
  let read;
  try {
    read = await readMenuPhoto({
      orgId: parsed.data.orgId,
      image: {
        mediaType: photo.type as (typeof IMAGE_TYPES)[number],
        base64: Buffer.from(await photo.arrayBuffer()).toString('base64'),
      },
    });
  } catch (e) {
    return { error: aiErrorKey(e) };
  }
  const { error } = await supabase.from('menu_import_drafts').insert({
    org_id: parsed.data.orgId,
    csv: read.csv,
    model: read.model,
    prompt_version: `${MENU_PHOTO_PROMPT.key}@${read.promptVersion}`,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/setup`);
  return { ok: true };
}
