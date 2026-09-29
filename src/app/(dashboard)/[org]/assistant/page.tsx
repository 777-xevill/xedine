import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChatView, type ChatMessage } from '@/components/chat/chat-view';
import { createClient } from '@/lib/db/supabase-server';
import { aiConfigured } from '@/lib/llm-gateway';
import { suggestionKeys } from '@/modules/assistant/suggestions';
import { getOrgContext } from '@/modules/tenancy/context';

const UUID = /^[0-9a-f-]{36}$/;

/**
 * M10 AI Owner Assistant (ROADMAP Phase 4, ADR 0024): a full-height chat. Conversations are listed
 * in the sidebar; owner rules for the assistant live in Settings → Assistant.
 */
export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ c?: string; ask?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  if (!['owner', 'manager', 'accountant'].some((r) => ctx.roles.includes(r as never))) notFound();
  const t = await getTranslations('assistantPage');
  const supabase = await createClient();
  const conversationId = sp.c && UUID.test(sp.c) ? sp.c : '';

  const [{ data: rows }, { data: cites }] = conversationId
    ? await Promise.all([
        supabase
          .from('ai_messages')
          .select('id, role, content, numeric_check')
          .eq('conversation_id', conversationId)
          .order('created_at'),
        supabase
          .from('ai_tool_calls')
          .select('message_id, tool_name, result_meta')
          .eq('conversation_id', conversationId),
      ])
    : [{ data: [] }, { data: [] }];
  const sourcesBy = new Map<string, string[]>();
  for (const c of cites ?? []) {
    const id = String((c.result_meta as { metric_id?: string } | null)?.metric_id ?? c.tool_name);
    const list = sourcesBy.get(c.message_id as string) ?? [];
    if (!list.includes(id)) list.push(id);
    sourcesBy.set(c.message_id as string, list);
  }
  const messages: ChatMessage[] = (rows ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const content = (m.content ?? {}) as { text?: string; source?: string };
      return {
        id: m.id as string,
        role: m.role as ChatMessage['role'],
        text: String(content.text ?? ''),
        aiWritten: content.source === 'llm',
        verified:
          m.role === 'assistant' &&
          (m.numeric_check === 'ok' ||
            m.numeric_check === 'retried' ||
            content.source === 'router'),
        sources: sourcesBy.get(m.id as string) ?? [],
      };
    });

  const canSeeMoney = ctx.isOwner || ctx.roles.includes('accountant');
  return (
    <ChatView
      key={conversationId || 'new'}
      orgId={ctx.org.id}
      orgSlug={ctx.org.slug}
      conversationId={conversationId}
      messages={messages}
      suggestions={suggestionKeys(canSeeMoney).map((k) => t(`suggestions.${k}`))}
      aiOn={aiConfigured()}
      initialQuestion={typeof sp.ask === 'string' ? sp.ask.slice(0, 1000) : undefined}
      firstName={ctx.fullName.split(/\s+/)[0] ?? ''}
    />
  );
}
