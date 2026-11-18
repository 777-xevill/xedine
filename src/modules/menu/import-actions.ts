'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { aiErrorKey } from '@/lib/llm-gateway';
import { parseMenuCsv } from '@/modules/menu/import';
import { MENU_PHOTO_PROMPT, readMenuPhotos } from '@/modules/menu/photo';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Onboarding menu import (ROADMAP Phase 10): CSV in, or photos of the menu read into a draft the owner
 * reviews, category by category, on Setup → Menu before anything is created.
 */
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
  revalidatePath(`/${parsed.data.orgSlug}/setup/menu`);
  const r = (data ?? {}) as Record<string, number>;
  // From the review page: its draft is gone now, so the page shows what was added.
  if (formData.get('from') === 'review')
    redirect(
      `/${parsed.data.orgSlug}/setup/menu?created=${r.created ?? 0}&skipped=${r.skipped ?? 0}`,
    );
  return {
    ok: true,
    data: {
      created: String(r.created ?? 0),
      skipped: String(r.skipped ?? 0),
      categories: String(r.categories ?? 0),
    },
  };
}

/** Several pages of one menu, each shrunk in the browser first (the whole upload stays under 6 MB). */
const MAX_PHOTOS = 8;

async function isOwner(orgId: string) {
  const supabase = await createClient();
  // Reading `organizations` only proves membership (any active role), not ownership: ask memberships.
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { data } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', auth.user.id)
    .eq('status', 'active')
    .eq('role', 'owner')
    .maybeSingle();
  return Boolean(data);
}

export async function readMenuPhotoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.safeParse({ orgId: formData.get('orgId'), orgSlug: formData.get('orgSlug') });
  if (!parsed.success) return { error: 'invalidInput' };
  const photos = formData.getAll('photo');
  if (
    photos.length === 0 ||
    photos.length > MAX_PHOTOS ||
    photos.some(
      (p) =>
        !(p instanceof File) ||
        p.size === 0 ||
        p.size > MAX_IMAGE_BYTES ||
        !(IMAGE_TYPES as readonly string[]).includes(p.type),
    )
  )
    return { error: 'photoInvalid' };
  // Only an owner may create drafts (RLS insert policy) — checked before spending the org's AI allowance.
  if (!(await isOwner(parsed.data.orgId))) return { error: 'notAllowed' };
  let read;
  try {
    read = await readMenuPhotos({
      orgId: parsed.data.orgId,
      photos: await Promise.all(
        (photos as File[]).map(async (p) => ({
          mediaType: p.type as (typeof IMAGE_TYPES)[number],
          base64: Buffer.from(await p.arrayBuffer()).toString('base64'),
        })),
      ),
    });
  } catch (e) {
    return { error: aiErrorKey(e) };
  }
  if (read.rows === 0) return { error: 'menuPhotoEmpty' };
  const supabase = await createClient();
  // One draft at a time: a new reading replaces the one before.
  await supabase.from('menu_import_drafts').delete().eq('org_id', parsed.data.orgId);
  const { error } = await supabase.from('menu_import_drafts').insert({
    org_id: parsed.data.orgId,
    csv: read.csv,
    model: read.model,
    prompt_version: `${MENU_PHOTO_PROMPT.key}@${read.promptVersion}`,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/setup`);
  redirect(`/${parsed.data.orgSlug}/setup/menu${read.unread > 0 ? `?unread=${read.unread}` : ''}`);
}

/** Throw the reading away (the owner starts again or types the menu instead). */
export async function discardMenuDraftAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.extend({ draftId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('menu_import_drafts')
    .delete()
    .eq('id', parsed.data.draftId)
    .eq('org_id', parsed.data.orgId);
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/setup`);
  redirect(`/${parsed.data.orgSlug}/setup`);
}
