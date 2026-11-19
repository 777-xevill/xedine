'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { x7Configured } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import { businessDate } from '@/lib/time/business-date';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';
import { orgToday, type Role } from '@/modules/tenancy/context';
import { getEnabledFeatures } from '@/modules/tenancy/shell';
import { ACTION_PAGES, isActionKind, mayDo, type ActionKind } from './action-kinds';
import { ASSISTANT_PROMPT, askAssistant, type AssistantModel } from './agent';
import { runAction } from './ai-actions';
import type { Translate } from './answers';
import type { PageLink } from './links';
import type { WebSource } from './web';

/**
 * Web chat (ROADMAP Phase 4). A conversation, its messages and the tool calls behind each answer are
 * stored per user (RLS: only that user reads them). The assistant runs with the asker's session.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const askSchema = z.object({
  orgId: z.uuid(),
  orgSlug: z.string().regex(SLUG),
  conversationId: z.union([z.uuid(), z.literal('')]),
  question: z.string().trim().min(1).max(1000),
  /** The page the question was asked from (a nav key) and what it shows, e.g. "last 7 days". */
  page: z
    .string()
    .regex(/^[A-Za-z]{2,24}$/)
    .optional(),
  pageNote: z.string().trim().max(200).optional(),
  /** The model the person picked in the composer (ADR 0067). */
  model: z.enum(['xedine', 'x7']).optional(),
});

/** A change the assistant prepared, as the list under an answer shows it (ADR 0067). */
export interface ActionItem {
  id: string;
  kind: ActionKind;
  view: Record<string, unknown>;
  status: 'proposed' | 'running' | 'done' | 'failed' | 'dismissed';
  /** errors.* key when it failed. */
  error: string | null;
}

/** One answer as a chat bubble shows it (same shape the chat page builds from stored rows). */
export interface AskReply {
  id: string;
  text: string;
  aiWritten: boolean;
  verified: boolean;
  /** Its money and percentages are checked; other figures are general knowledge. */
  general: boolean;
  sources: string[];
  /** Pages the answer is about, as "Open Stock" buttons. */
  links: PageLink[];
  /** X7 answered; or why it did not although it was picked. */
  model: AssistantModel;
  x7Note: 'busy' | 'used_up' | null;
  webSources: WebSource[];
  actions: ActionItem[];
}

/** Tool names that are not metrics, so they are not listed as an answer's sources. */
const NOT_A_SOURCE = /^(propose_|web_search$|read_web_page$)/;

type AskResult = { error: string } | { conversationId: string; reply: AskReply };

export async function askAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = askSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const result = await ask(parsed.data);
  if ('error' in result) return { error: result.error };
  // The sidebar's chat history lives in the org layout.
  revalidatePath(`/${parsed.data.orgSlug}`, 'layout');
  if (!parsed.data.conversationId)
    redirect(`/${parsed.data.orgSlug}/assistant?c=${result.conversationId}`);
  return { ok: true };
}

/**
 * The same assistant, answered in place (the Sales page's helper): no redirect, the reply comes
 * back to the panel, and the conversation is kept so it also appears in the chat history.
 */
export async function askHereAction(input: z.input<typeof askSchema>): Promise<AskResult> {
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalidInput' };
  return ask(parsed.data);
}

async function ask({
  orgId,
  question,
  page,
  pageNote,
  model,
  ...rest
}: z.output<typeof askSchema>): Promise<AskResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'notAllowed' };
  // Only a member may ask (and spend the org's AI allowance); RLS hides other organizations.
  const { data: member } = await supabase
    .from('organizations')
    .select('id, slug')
    .eq('id', orgId)
    .maybeSingle();
  if (!member) return { error: 'notAllowed' };
  // Who is asking decides which pages the assistant may send them to (the same rules as the sidebar).
  const [{ data: roleRows }, enabled] = await Promise.all([
    supabase
      .from('memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .eq('status', 'active'),
    getEnabledFeatures(orgId),
  ]);
  const access = {
    slug: member.slug as string,
    roles: (roleRows ?? []).map((r) => r.role as Role),
    enabled,
  };

  let conversationId = rest.conversationId;
  if (!conversationId) {
    const { data, error } = await supabase
      .from('ai_conversations')
      .insert({ org_id: orgId, user_id: user.id, title: question.slice(0, 80) })
      .select('id')
      .single();
    if (error) return { error: mapDbError(error) };
    conversationId = data.id as string;
  } else {
    // Continuing a chat moves it to the top of the sidebar's history (ADR 0024).
    await supabase
      .from('ai_conversations')
      .update({ updated_at: now().toISOString() })
      .eq('id', conversationId);
  }

  // The last few turns give the model context; older ones are left out to keep prompts small.
  const { data: previous } = await supabase
    .from('ai_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(6);
  const history = (previous ?? [])
    .reverse()
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: String((m.content as { text?: string }).text ?? ''),
    }));
  const { data: rules } = await supabase
    .from('org_context')
    .select('body')
    .eq('org_id', orgId)
    .eq('is_active', true);

  const at = now();
  // X7 (ADR 0067): only when it is set up and this week's allowance has one left; otherwise the everyday
  // model answers and the reply says why.
  let wantX7 = model === 'x7' && x7Configured();
  let x7Note: AskReply['x7Note'] = null;
  if (wantX7) {
    const { data: allowance } = await supabase.rpc('x7_allowance', {
      p_org: orgId,
      p_now: at.toISOString(),
    });
    const left = Number((allowance as { left_count?: number }[] | null)?.[0]?.left_count ?? 0);
    if (left <= 0) {
      wantX7 = false;
      x7Note = 'used_up';
    }
  }
  const { data: settings } = await supabase
    .from('org_settings')
    .select('default_cutoff_minutes, timezone')
    .eq('org_id', orgId)
    .maybeSingle();
  const answer = await askAssistant({
    sb: supabase,
    orgId,
    question,
    nowIso: at.toISOString(),
    businessDate: businessDate(
      at,
      settings?.default_cutoff_minutes ?? 240,
      (settings?.timezone as string | undefined) ?? 'Asia/Dhaka',
    ),
    ownerRules: (rules ?? []).map((r) => r.body as string),
    history,
    access,
    ...(page ? { page: { key: page, ...(pageNote ? { note: pageNote } : {}) } } : {}),
    translate: async (locale) =>
      (await getTranslations({ locale, namespace: 'assistant' })) as unknown as Translate,
    model: wantX7 ? 'x7' : 'xedine',
    allowActions: true,
  });
  if (answer.x7Busy) x7Note = 'busy';
  // One X7 question counted for the week, only when X7 itself answered.
  if (answer.model === 'x7') {
    const { error: useError } = await supabase.rpc('use_x7', {
      p_org: orgId,
      p_now: at.toISOString(),
    });
    if (useError) console.error('use_x7', useError.code);
  }

  const { error: userError } = await supabase.from('ai_messages').insert({
    org_id: orgId,
    user_id: user.id,
    conversation_id: conversationId,
    role: 'user',
    content: { text: question },
  });
  if (userError) return { error: mapDbError(userError) };
  const { data: reply, error: replyError } = await supabase
    .from('ai_messages')
    .insert({
      org_id: orgId,
      user_id: user.id,
      conversation_id: conversationId,
      role: 'assistant',
      content: {
        text: answer.text,
        source: answer.source,
        language: answer.language,
        model: answer.model,
        ...(answer.modelId ? { model_id: answer.modelId } : {}),
        ...(x7Note ? { x7_note: x7Note } : {}),
        ...(answer.webSources.length > 0 ? { web: answer.webSources } : {}),
      },
      numeric_check: answer.numericCheck,
      prompt_version:
        answer.source === 'llm' ? `${ASSISTANT_PROMPT.key}@${ASSISTANT_PROMPT.version}` : null,
    })
    .select('id')
    .single();
  if (replyError) return { error: mapDbError(replyError) };
  if (answer.toolCalls.length > 0) {
    await supabase.from('ai_tool_calls').insert(
      answer.toolCalls.map((c) => ({
        org_id: orgId,
        user_id: user.id,
        conversation_id: conversationId,
        message_id: reply.id,
        tool_name: c.name,
        args: c.input,
        result_meta: c.resultMeta,
        duration_ms: c.durationMs,
      })),
    );
  }
  // The changes it prepared, saved for the person to approve (RLS: their own rows, as proposed).
  let actions: ActionItem[] = [];
  if (answer.proposals.length > 0) {
    const { data: saved, error: actionError } = await supabase
      .from('ai_actions')
      .insert(
        answer.proposals.map((p, seq) => ({
          org_id: orgId,
          user_id: user.id,
          conversation_id: conversationId,
          message_id: reply.id,
          seq,
          kind: p.kind,
          params: p.params,
          view: p.view,
          model: answer.modelId,
        })),
      )
      .select('id, kind, view, status, error, seq');
    if (actionError) console.error('ai_actions', actionError.code);
    actions = ((saved ?? []) as (ActionItem & { seq: number })[])
      .sort((a, b) => a.seq - b.seq)
      .map((a) => ({ id: a.id, kind: a.kind, view: a.view, status: a.status, error: a.error }));
  }
  const sources: string[] = [];
  for (const c of answer.toolCalls) {
    if (NOT_A_SOURCE.test(c.name)) continue;
    const id = String(c.resultMeta.metric_id ?? c.name);
    if (!sources.includes(id)) sources.push(id);
  }
  return {
    conversationId,
    reply: {
      id: reply.id as string,
      text: answer.text,
      aiWritten: answer.source === 'llm',
      verified:
        answer.numericCheck === 'ok' ||
        answer.numericCheck === 'retried' ||
        answer.source === 'router',
      general: answer.numericCheck === 'general',
      sources,
      links: answer.links,
      model: answer.model,
      x7Note,
      webSources: answer.webSources,
      actions,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Changes the assistant prepared (ADR 0067)
// ---------------------------------------------------------------------------------------------
const decideSchema = z.object({
  orgId: z.uuid(),
  orgSlug: z.string().regex(SLUG),
  ids: z.array(z.uuid()).min(1).max(50),
});

export type ActionRunResult =
  | { error: string }
  | { results: { id: string; status: ActionItem['status']; error: string | null }[] };

const PAGE_PATHS: Record<string, string[]> = {
  menu: ['/menu', '/menu-profit'],
  plan: ['/plan'],
  purchases: ['/purchases', '/stock'],
  stock: ['/stock'],
  costs: ['/costs', ''],
  settings: ['/settings/assistant'],
};

/**
 * "Do these changes": makes each prepared change in order (a new category before the dish in it), with the
 * person's own session. A change is claimed first (proposed → running), so a double tap cannot make it twice,
 * and is good for 24 hours. Each one stands alone: one refused does not stop the rest.
 */
export async function runAiActionsAction(
  input: z.input<typeof decideSchema>,
): Promise<ActionRunResult> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalidInput' };
  const { orgId, orgSlug, ids } = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'notAllowed' };
  const [{ data: rows, error }, { data: roleRows }] = await Promise.all([
    supabase
      .from('ai_actions')
      .select('id, kind, params, status, seq')
      .eq('org_id', orgId)
      .in('id', ids)
      .order('seq'),
    supabase
      .from('memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .eq('status', 'active'),
  ]);
  if (error) return { error: mapDbError(error) };
  const roles = (roleRows ?? []).map((r) => r.role as Role);
  const today = await orgToday(orgId);
  const results: { id: string; status: ActionItem['status']; error: string | null }[] = [];
  const pages = new Set<string>();
  for (const row of rows ?? []) {
    const id = row.id as string;
    const kind = String(row.kind);
    if (row.status !== 'proposed' || !isActionKind(kind)) {
      results.push({ id, status: row.status as ActionItem['status'], error: null });
      continue;
    }
    const nowIso = now().toISOString();
    const claim = await supabase.rpc('decide_ai_action', {
      p_id: id,
      p_status: 'running',
      p_error: null,
      p_now: nowIso,
    });
    if (claim.error) {
      results.push({ id, status: 'proposed', error: mapDbError(claim.error) });
      continue;
    }
    const ran = mayDo(kind, roles)
      ? await runAction(kind, row.params as Record<string, unknown>, {
          sb: supabase,
          orgId,
          userId: user.id,
          today,
          nowIso,
        })
      : { error: 'notAllowed' };
    const failed = 'error' in ran ? ran.error : null;
    const { error: decideError } = await supabase.rpc('decide_ai_action', {
      p_id: id,
      p_status: failed ? 'failed' : 'done',
      p_error: failed,
      p_now: now().toISOString(),
    });
    if (decideError) console.error('decide_ai_action', decideError.code);
    results.push({ id, status: failed ? 'failed' : 'done', error: failed });
    if (!failed) pages.add(ACTION_PAGES[kind]);
  }
  for (const page of pages)
    for (const path of PAGE_PATHS[page] ?? []) revalidatePath(`/${orgSlug}${path}`);
  revalidatePath(`/${orgSlug}/assistant`);
  return { results };
}

/** "Not now": the prepared changes are set aside and never made. */
export async function dismissAiActionsAction(
  input: z.input<typeof decideSchema>,
): Promise<ActionRunResult> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const results: { id: string; status: ActionItem['status']; error: string | null }[] = [];
  for (const id of parsed.data.ids) {
    const { error } = await supabase.rpc('decide_ai_action', {
      p_id: id,
      p_status: 'dismissed',
      p_error: null,
      p_now: now().toISOString(),
    });
    results.push({
      id,
      status: error ? 'proposed' : 'dismissed',
      error: error ? mapDbError(error) : null,
    });
  }
  revalidatePath(`/${parsed.data.orgSlug}/assistant`);
  return { results };
}

const contextSchema = z.object({
  orgId: z.uuid(),
  orgSlug: z.string().regex(SLUG),
  kind: z.enum(['goal', 'rule', 'constraint']),
  body: z.string().trim().min(3).max(500),
});

/** What the owner wants the assistant to know and respect (org_context; owner-only by RLS). */
export async function addContextAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = contextSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('org_context').insert({
    org_id: parsed.data.orgId,
    kind: parsed.data.kind,
    body: parsed.data.body,
    created_by: user?.id ?? null,
  });
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/${parsed.data.orgSlug}/settings/assistant`);
  return { ok: true };
}

export async function removeContextAction(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get('id'));
  const slug = z.string().regex(SLUG).safeParse(formData.get('orgSlug'));
  if (!id.success || !slug.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('org_context')
    .update({ is_active: false })
    .eq('id', id.data);
  if (error) console.error('org_context remove', error.code);
  revalidatePath(`/${slug.data}/settings/assistant`);
}
