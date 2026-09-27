import { Bot, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardTitle,
  Hint,
  Input,
  Label,
  PageTitle,
  Select,
  Textarea,
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { aiConfigured } from '@/lib/llm-gateway';
import { addContextAction, askAction, removeContextAction } from '@/modules/assistant/actions';
import { getOrgContext } from '@/modules/tenancy/context';
import { cn } from '@/lib/utils';

const UUID = /^[0-9a-f-]{36}$/;

/** M10 AI Owner Assistant: web chat over the metric tools (ROADMAP Phase 4). */
export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  if (!['owner', 'manager', 'accountant'].some((r) => ctx.roles.includes(r as never))) notFound();
  const t = await getTranslations('assistantPage');
  const supabase = await createClient();
  const conversationId = sp.c && UUID.test(sp.c) ? sp.c : '';
  const [{ data: conversations }, { data: messages }, { data: rules }] = await Promise.all([
    supabase
      .from('ai_conversations')
      .select('id, title, created_at')
      .eq('org_id', ctx.org.id)
      .order('created_at', { ascending: false })
      .limit(20),
    conversationId
      ? supabase
          .from('ai_messages')
          .select('id, role, content, numeric_check')
          .eq('conversation_id', conversationId)
          .order('created_at')
      : Promise.resolve({
          data: [] as { id: string; role: string; content: unknown; numeric_check: string }[],
        }),
    supabase
      .from('org_context')
      .select('id, kind, body')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('created_at'),
  ]);
  const { data: cites } = conversationId
    ? await supabase
        .from('ai_tool_calls')
        .select('message_id, tool_name, result_meta')
        .eq('conversation_id', conversationId)
    : { data: [] as { message_id: string; tool_name: string; result_meta: unknown }[] };
  const citesBy = new Map<string, { tool_name: string; result_meta: unknown }[]>();
  for (const c of cites ?? [])
    citesBy.set(c.message_id as string, [...(citesBy.get(c.message_id as string) ?? []), c]);
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Link
            href={`/${ctx.org.slug}/assistant`}
            className="glass-tile flex min-h-10 items-center justify-center rounded-full px-4 text-sm font-semibold hover:border-edge-strong"
          >
            {t('newChat')}
          </Link>
          <nav aria-label={t('history')} className="space-y-1">
            {(conversations ?? []).map((c) => (
              <Link
                key={c.id}
                href={`/${ctx.org.slug}/assistant?c=${c.id}`}
                aria-current={c.id === conversationId ? 'page' : undefined}
                className={cn(
                  'block truncate rounded-input px-3 py-2 text-sm',
                  c.id === conversationId
                    ? 'bg-surface-elevated text-foreground'
                    : 'text-secondary hover:text-foreground',
                )}
              >
                {c.title}
              </Link>
            ))}
          </nav>
          <Card className="p-4">
            <CardTitle className="mb-2 text-base">{t('rulesTitle')}</CardTitle>
            <p className="mb-3 text-xs text-secondary">{t('rulesBody')}</p>
            <ul className="mb-3 space-y-2 text-sm">
              {(rules ?? []).map((r) => (
                <li key={r.id} className="glass-tile rounded-input p-2">
                  <span className="text-xs text-muted">{t(`kinds.${r.kind as string}`)}</span>
                  <p>{r.body}</p>
                  {ctx.isOwner ? (
                    <form action={removeContextAction} className="mt-1">
                      <input type="hidden" name="id" value={r.id as string} />
                      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        className="min-h-7 px-2 text-xs"
                      >
                        {t('remove')}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
            {ctx.isOwner ? (
              <ActionForm action={addContextAction} successKey="common.saved" className="space-y-2">
                {hidden}
                <Label htmlFor="ctx-kind">{t('kind')}</Label>
                <Select id="ctx-kind" name="kind" defaultValue="goal">
                  {(['goal', 'rule', 'constraint'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </Select>
                <Input
                  name="body"
                  required
                  minLength={3}
                  maxLength={500}
                  aria-label={t('ruleText')}
                  placeholder={t('rulePlaceholder')}
                />
                <Button type="submit" size="sm" variant="secondary">
                  {t('addRule')}
                </Button>
              </ActionForm>
            ) : null}
          </Card>
        </aside>

        <section className="glass flex min-h-[60dvh] flex-col rounded-card p-4">
          {!aiConfigured() ? <Hint className="mb-3">{t('routerMode')}</Hint> : null}
          <ol className="flex-1 space-y-4 overflow-y-auto">
            {(messages ?? []).length === 0 ? (
              <li className="py-10 text-center text-secondary">
                <Bot aria-hidden className="mx-auto mb-3 size-8 text-cyan" />
                <p className="font-semibold text-foreground">{t('emptyTitle')}</p>
                <p className="mx-auto mt-1 max-w-md text-sm">{t('emptyBody')}</p>
              </li>
            ) : (
              (messages ?? []).map((m) => {
                const content = m.content as { text?: string; source?: string };
                const mine = m.role === 'user';
                return (
                  <li key={m.id} className={cn('flex gap-3', mine && 'flex-row-reverse')}>
                    <span
                      aria-hidden
                      className="glass-tile inline-flex size-8 shrink-0 items-center justify-center rounded-full"
                    >
                      {mine ? (
                        <UserRound className="size-4" />
                      ) : (
                        <Bot className="size-4 text-cyan" />
                      )}
                    </span>
                    <div
                      className={cn(
                        'max-w-[80%] rounded-card px-4 py-3',
                        mine ? 'bg-surface-elevated' : 'glass-tile',
                      )}
                    >
                      <p className="text-sm whitespace-pre-line">{content.text}</p>
                      {!mine ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {content.source === 'llm' ? (
                            <Badge tone="accent" icon={<Sparkles />}>
                              {t('aiWritten')}
                            </Badge>
                          ) : null}
                          {m.numeric_check === 'ok' ||
                          m.numeric_check === 'retried' ||
                          content.source === 'router' ? (
                            <Badge tone="success" icon={<ShieldCheck />}>
                              {t('verified')}
                            </Badge>
                          ) : null}
                          {(citesBy.get(m.id as string) ?? []).map((c, i) => (
                            <span key={i} className="text-xs text-muted">
                              {String(
                                (c.result_meta as { metric_id?: string })?.metric_id ?? c.tool_name,
                              )}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })
            )}
          </ol>
          <ActionForm action={askAction} className="mt-4 space-y-2 border-t border-line pt-4">
            {hidden}
            <input type="hidden" name="conversationId" value={conversationId} />
            <Label htmlFor="question" className="sr-only">
              {t('askLabel')}
            </Label>
            <Textarea
              id="question"
              name="question"
              rows={2}
              required
              maxLength={1000}
              placeholder={t('askPlaceholder')}
            />
            <div className="flex items-center justify-between gap-2">
              <Hint>{t('examples')}</Hint>
              <Button type="submit">{t('ask')}</Button>
            </div>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
