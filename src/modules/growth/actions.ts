'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { aiErrorKey } from '@/lib/llm-gateway';
import { formatBps } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import { draftGrowthIdea, GROWTH_IDEA_PROMPT } from '@/modules/growth/drafting';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Growth content ideas (ROADMAP Phase 10, optional). Drafts are grounded in metric_growth_inputs and
 * approved by a person (CLAUDE.md #4); nothing here ever posts to a platform.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const refresh = (slug: string) => revalidatePath(`/${slug}/growth`);

export async function draftGrowthIdeaAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      kind: z.enum(['push_item', 'fix_daypart']),
      branchId: z.union([z.uuid(), z.literal('')]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('metric_growth_inputs', {
    p_org: parsed.data.orgId,
    p_branch: parsed.data.branchId || null,
    p_now: now().toISOString(),
  });
  if (error) return { error: mapDbError(error) };
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return { error: 'growthNoData' };
  const fact =
    parsed.data.kind === 'push_item'
      ? row.top_item_name
        ? `The best-selling item is ${String(row.top_item_name)}, ${Number(row.top_item_qty)} sold in the last 28 days.`
        : null
      : row.weak_daypart
        ? `The ${String(row.weak_daypart)} daypart is only ${formatBps(Number(row.weak_daypart_share_bps), 'en')} of sales, against ${formatBps(Number(row.strong_daypart_share_bps), 'en')} at ${String(row.strong_daypart)}, over the last 28 days.`
        : null;
  if (!fact) return { error: 'growthNoData' };
  let drafted;
  try {
    drafted = await draftGrowthIdea({ orgId: parsed.data.orgId, kind: parsed.data.kind, fact });
  } catch (e) {
    return { error: aiErrorKey(e) };
  }
  const { error: insertError } = await supabase.from('growth_content_drafts').insert({
    org_id: parsed.data.orgId,
    branch_id: parsed.data.branchId || null,
    kind: parsed.data.kind,
    title: drafted.title,
    hook: drafted.hook,
    shot_list: drafted.shot_list,
    caption_bn: drafted.caption_bn,
    caption_en: drafted.caption_en,
    based_on: { fact },
    model: drafted.model,
    prompt_version: `${GROWTH_IDEA_PROMPT.key}@${drafted.promptVersion}`,
  });
  if (insertError) return { error: mapDbError(insertError) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function writeGrowthIdeaAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      branchId: z.union([z.uuid(), z.literal('')]),
      title: z.string().trim().min(1).max(120),
      hook: z.string().trim().max(300).optional(),
      shotList: z.string().trim().max(600).optional(),
      captionBn: z.string().trim().max(900).optional(),
      captionEn: z.string().trim().max(900).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success || (!parsed.data.captionBn && !parsed.data.captionEn))
    return { error: 'growthInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.from('growth_content_drafts').insert({
    org_id: parsed.data.orgId,
    branch_id: parsed.data.branchId || null,
    kind: 'custom',
    title: parsed.data.title,
    hook: parsed.data.hook || null,
    shot_list: parsed.data.shotList || null,
    caption_bn: parsed.data.captionBn || null,
    caption_en: parsed.data.captionEn || null,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function approveGrowthDraftAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      draftId: z.uuid(),
      captionBn: z.string().trim().max(900).optional(),
      captionEn: z.string().trim().max(900).optional(),
      targetDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_growth_draft', {
    p_draft: parsed.data.draftId,
    p_caption_bn: parsed.data.captionBn || null,
    p_caption_en: parsed.data.captionEn || null,
    p_target_date: parsed.data.targetDate || null,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function discardGrowthDraftAction(formData: FormData): Promise<void> {
  const parsed = base.extend({ draftId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('growth_content_drafts')
    .update({ status: 'discarded' })
    .eq('id', parsed.data.draftId)
    .eq('org_id', parsed.data.orgId)
    .eq('status', 'draft');
  if (error) console.error('discard growth draft', error.code);
  refresh(parsed.data.orgSlug);
}

export async function markGrowthPostedAction(formData: FormData): Promise<void> {
  const parsed = base.extend({ draftId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_growth_posted', { p_draft: parsed.data.draftId });
  if (error) console.error('mark growth posted', error.code);
  refresh(parsed.data.orgSlug);
}
