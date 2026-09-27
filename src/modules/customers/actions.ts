'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { aiErrorKey } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import { draftReviewReply, REVIEW_REPLY_PROMPT } from '@/modules/reviews/replies';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';

/**
 * Campaigns and reviews (ROADMAP Phase 8). Sends go through run_campaign (consent, caps, holdout, the
 * outbox); review replies are drafts until an owner or manager approves them. RLS decides every write.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const base = z.object({ orgId: z.uuid(), orgSlug: z.string().regex(SLUG) });
const refresh = (slug: string) => {
  revalidatePath(`/${slug}/campaigns`);
  revalidatePath(`/${slug}/reviews`);
  revalidatePath(`/${slug}/customers`);
};

// ---------------------------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------------------------
export async function createCampaignAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base
    .extend({
      name: z.string().trim().min(1).max(120),
      kind: z.enum(['thank_you', 'second_visit', 'win_back', 'custom']),
      segment: z.enum(['all', 'new', 'returning', 'regular', 'at_risk', 'lost']).optional(),
      branchId: z.union([z.uuid(), z.literal('')]).optional(),
      holdoutPct: z.coerce.number().int().min(0).max(50),
      bodyBn: z.string().trim().max(900).optional(),
      bodyEn: z.string().trim().max(900).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success || (!parsed.data.bodyBn && !parsed.data.bodyEn))
    return { error: 'campaignInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.from('campaigns').insert({
    org_id: parsed.data.orgId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    holdout_pct: parsed.data.holdoutPct,
    audience: { segment: parsed.data.segment ?? 'all', branch_id: parsed.data.branchId || null },
    body_bn: parsed.data.bodyBn || null,
    body_en: parsed.data.bodyEn || null,
    template_key: 'campaign',
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function approveCampaignAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = base.extend({ campaignId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_campaign', { p_campaign: parsed.data.campaignId });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function runCampaignAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base.extend({ campaignId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('run_campaign', {
    p_campaign: parsed.data.campaignId,
    p_now: now().toISOString(),
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  const r = (data ?? {}) as Record<string, number>;
  return {
    ok: true,
    data: {
      queued: String(r.queued ?? 0),
      holdout: String(r.holdout ?? 0),
      noConsent: String(r.no_consent ?? 0),
      capped: String(r.capped ?? 0),
    },
  };
}

export async function setAutoRunAction(formData: FormData): Promise<void> {
  const parsed = base
    .extend({ campaignId: z.uuid(), autoRun: z.enum(['true', 'false']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('campaigns')
    .update({ auto_run: parsed.data.autoRun === 'true' })
    .eq('id', parsed.data.campaignId)
    .eq('org_id', parsed.data.orgId);
  if (error) console.error('campaign auto-run', error.code);
  refresh(parsed.data.orgSlug);
}

// ---------------------------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------------------------
/** A review pasted from Facebook, foodpanda or Google (until the Business Profile API is approved). */
export async function addReviewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({
      branchId: z.union([z.uuid(), z.literal('')]),
      source: z.enum(['google', 'facebook', 'foodpanda', 'other']),
      stars: z.coerce.number().min(1).max(5),
      author: z.string().trim().max(120).optional(),
      reviewedOn: z.string().regex(DATE),
      body: z.string().trim().min(1).max(4000),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'reviewInvalid' };
  const supabase = await createClient();
  const { error } = await supabase.from('reviews').insert({
    org_id: parsed.data.orgId,
    branch_id: parsed.data.branchId || null,
    source: parsed.data.source,
    // Stars (1–5) are stored on the same 0–10 scale as post-meal feedback.
    rating: parsed.data.stars * 2,
    author: parsed.data.author || null,
    reviewed_at: `${parsed.data.reviewedOn}T12:00:00+06:00`,
    body: parsed.data.body,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function draftReplyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base.extend({ reviewId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const [{ data: review }, { data: org }] = await Promise.all([
    supabase
      .from('reviews')
      .select('id, body, rating')
      .eq('id', parsed.data.reviewId)
      .eq('org_id', parsed.data.orgId)
      .maybeSingle(),
    supabase.from('organizations').select('name').eq('id', parsed.data.orgId).maybeSingle(),
  ]);
  if (!review || !org) return { error: 'notAllowed' };
  let drafted;
  try {
    drafted = await draftReviewReply({
      orgId: parsed.data.orgId,
      restaurant: org.name as string,
      review: String(review.body ?? ''),
      rating: review.rating === null ? null : Number(review.rating),
    });
  } catch (e) {
    return { error: aiErrorKey(e) };
  }
  const { error } = await supabase.from('review_replies').insert({
    org_id: parsed.data.orgId,
    review_id: review.id,
    draft_body: drafted.reply,
    model: drafted.model,
    prompt_version: `${REVIEW_REPLY_PROMPT.key}@${drafted.promptVersion}`,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

/** A reply written by hand is a draft too, and goes through the same approval. */
export async function writeReplyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ reviewId: z.uuid(), body: z.string().trim().min(1).max(2000) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.from('review_replies').insert({
    org_id: parsed.data.orgId,
    review_id: parsed.data.reviewId,
    draft_body: parsed.data.body,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}

export async function approveReplyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = base
    .extend({ replyId: z.uuid(), body: z.string().trim().max(2000).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_review_reply', {
    p_reply: parsed.data.replyId,
    p_body: parsed.data.body || null,
  });
  if (error) return { error: mapDbError(error) };
  refresh(parsed.data.orgSlug);
  return { ok: true };
}
