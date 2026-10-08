'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { now } from '@/lib/time/clock';
import { businessDate } from '@/lib/time/business-date';
import { mapDbError, type FormState } from '@/modules/tenancy/form-state';
import { ASSISTANT_PROMPT, askAssistant } from './agent';
import type { Translate } from './answers';

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
});

/** One answer as a chat bubble shows it (same shape the chat page builds from stored rows). */
export interface AskReply {
  id: string;
  text: string;
  aiWritten: boolean;
  verified: boolean;
  sources: string[];
}

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

async function ask({ orgId, question, ...rest }: z.output<typeof askSchema>): Promise<AskResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'notAllowed' };
  // Only a member may ask (and spend the org's AI allowance); RLS hides other organizations.
  const { data: member } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', orgId)
    .maybeSingle();
  if (!member) return { error: 'notAllowed' };

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
  const { data: settings } = await supabase
    .from('org_settings')
    .select('default_cutoff_minutes')
    .eq('org_id', orgId)
    .maybeSingle();
  const answer = await askAssistant({
    sb: supabase,
    orgId,
    question,
    nowIso: at.toISOString(),
    businessDate: businessDate(at, settings?.default_cutoff_minutes ?? 240),
    ownerRules: (rules ?? []).map((r) => r.body as string),
    history,
    translate: async (locale) =>
      (await getTranslations({ locale, namespace: 'assistant' })) as unknown as Translate,
  });

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
      content: { text: answer.text, source: answer.source, language: answer.language },
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
  const sources: string[] = [];
  for (const c of answer.toolCalls) {
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
      sources,
    },
  };
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
