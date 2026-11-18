'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { AiError, aiErrorKey } from '@/lib/llm-gateway';
import { draftToCsv, parseMenuCsv } from '@/modules/menu/import';
import { MENU_PHOTO_PROMPT, menuLinesToRows, readMenuPage } from '@/modules/menu/photo';
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

/**
 * One page of the menu (the browser sends the pages one by one, so each request stays short and a busy
 * free AI can be waited for between pages). Returns the page's lines; nothing is saved yet.
 */
export async function readMenuPageAction(formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      page: z.coerce.number().int().min(1).max(8),
      pages: z.coerce.number().int().min(1).max(8),
    })
    .safeParse({
      orgId: formData.get('orgId'),
      orgSlug: formData.get('orgSlug'),
      page: formData.get('page'),
      pages: formData.get('pages'),
    });
  if (!parsed.success) return { error: 'invalidInput' };
  const photo = formData.get('photo');
  if (
    !(photo instanceof File) ||
    photo.size === 0 ||
    photo.size > MAX_IMAGE_BYTES ||
    !(IMAGE_TYPES as readonly string[]).includes(photo.type)
  )
    return { error: 'photoInvalid' };
  // Only an owner may create drafts (RLS insert policy) — checked before spending the org's AI allowance.
  if (!(await isOwner(parsed.data.orgId))) return { error: 'notAllowed' };
  try {
    const read = await readMenuPage({
      orgId: parsed.data.orgId,
      photo: {
        mediaType: photo.type as (typeof IMAGE_TYPES)[number],
        base64: Buffer.from(await photo.arrayBuffer()).toString('base64'),
      },
      page: parsed.data.page,
      pages: parsed.data.pages,
    });
    return {
      ok: true,
      data: { lines: JSON.stringify(read.lines), model: read.model, v: String(read.promptVersion) },
    };
  } catch (e) {
    return {
      error: aiErrorKey(e),
      data: { busy: e instanceof AiError && e.code === 'rate_limited' ? '1' : '' },
    };
  }
}

/** All pages read: merge them into categories → dishes, keep the one draft, and open the review page. */
export async function saveMenuReadingAction(formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      pages: z.string().max(200_000),
      unread: z.coerce.number().int().min(0).max(8),
      model: z.string().max(100),
      v: z.string().max(10),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  let json: unknown;
  try {
    json = JSON.parse(parsed.data.pages || '[]');
  } catch {
    return { error: 'invalidInput' };
  }
  const pages = z
    .array(z.array(z.string().max(400)).max(300))
    .max(8)
    .safeParse(json);
  if (!pages.success) return { error: 'invalidInput' };
  if (!(await isOwner(parsed.data.orgId))) return { error: 'notAllowed' };
  const rows = menuLinesToRows(pages.data);
  if (rows.length === 0) return { error: 'menuPhotoEmpty' };
  const supabase = await createClient();
  // One draft at a time: a new reading replaces the one before.
  await supabase.from('menu_import_drafts').delete().eq('org_id', parsed.data.orgId);
  const { error } = await supabase.from('menu_import_drafts').insert({
    org_id: parsed.data.orgId,
    csv: draftToCsv(rows.slice(0, 500)),
    model: parsed.data.model || null,
    prompt_version: `${MENU_PHOTO_PROMPT.key}@${parsed.data.v || MENU_PHOTO_PROMPT.version}`,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/setup`);
  redirect(
    `/${parsed.data.orgSlug}/setup/menu${parsed.data.unread > 0 ? `?unread=${parsed.data.unread}` : ''}`,
  );
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
