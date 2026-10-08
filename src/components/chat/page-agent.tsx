'use client';

import { ExternalLink, ShieldCheck, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/form';
import { askHereAction, type AskReply } from '@/modules/assistant/actions';
import { AssistantAvatar, Thinking } from './chat-view';
import { Composer } from './composer';

type Message = AskReply & { role: 'user' | 'assistant' };

export interface AgentLabels {
  /** The floating button. */
  open: string;
  title: string;
  subtitle: string;
  placeholder: string;
}

/**
 * A chat helper docked on a page (Sales, Stock). Nothing runs until it is opened: the first
 * tap asks the page's summary question, then follow-ups and typed questions continue the same
 * conversation, which also lands in the chat history. Same assistant, tools and number checks as the
 * full chat.
 */
export function PageAgent({
  orgId,
  orgSlug,
  labels,
  summaryQuestion,
  followUps,
  aiOn,
}: {
  orgId: string;
  orgSlug: string;
  labels: AgentLabels;
  /** Asked automatically the first time the panel opens. */
  summaryQuestion: string;
  followUps: string[];
  aiOn: boolean;
}) {
  const t = useTranslations('agent');
  const ta = useTranslations('assistantPage');
  const te = useTranslations('errors');
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [conversationId, setConversationId] = React.useState('');
  const [value, setValue] = React.useState('');
  const [inFlight, setInFlight] = React.useState('');
  const [error, setError] = React.useState('');
  const [pending, startTransition] = React.useTransition();
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pending, open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setError('');
    setInFlight(q);
    setValue('');
    startTransition(async () => {
      const res = await askHereAction({ orgId, orgSlug, conversationId, question: q });
      if ('error' in res) {
        setError(res.error);
        setValue(q);
        return;
      }
      setConversationId(res.conversationId);
      setMessages((m) => [
        ...m,
        {
          id: `${res.reply.id}:q`,
          role: 'user',
          text: q,
          aiWritten: false,
          verified: false,
          sources: [],
        },
        { ...res.reply, role: 'assistant' },
      ]);
    });
  };

  const openPanel = () => {
    setOpen(true);
    if (messages.length === 0 && !pending) send(summaryQuestion);
  };

  const asked = new Set(messages.filter((m) => m.role === 'user').map((m) => m.text));
  const chips = followUps.filter((f) => !asked.has(f) && f !== inFlight);

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        className="glow-action fixed end-4 bottom-4 z-40 inline-flex items-center gap-2 rounded-full bg-action px-5 py-3 text-sm font-semibold text-on-action transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:outline-none sm:end-6 sm:bottom-6"
      >
        <Sparkles className="size-4" aria-hidden />
        {labels.open}
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-label={labels.title}
      className="fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col rounded-t-sheet border border-line bg-surface shadow-lift sm:inset-x-auto sm:end-6 sm:bottom-6 sm:h-[min(40rem,80dvh)] sm:w-[26rem] sm:rounded-card"
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <AssistantAvatar />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{labels.title}</p>
          <p className="truncate text-xs text-secondary">{labels.subtitle}</p>
        </div>
        {conversationId ? (
          <Link
            href={`/${orgSlug}/assistant?c=${conversationId}`}
            className="inline-flex size-9 items-center justify-center rounded-full text-secondary hover:bg-surface-elevated hover:text-foreground"
            aria-label={t('openChat')}
            title={t('openChat')}
          >
            <ExternalLink className="size-4" aria-hidden />
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex size-9 items-center justify-center rounded-full text-secondary hover:bg-surface-elevated hover:text-foreground"
          aria-label={t('close')}
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ol className="space-y-5 px-4 py-4">
          {messages.map((m) =>
            m.role === 'user' ? (
              <li key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-surface-elevated px-4 py-2.5 text-sm whitespace-pre-line">
                  {m.text}
                </p>
              </li>
            ) : (
              <li key={m.id} className="flex gap-3">
                <AssistantAvatar />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-6 whitespace-pre-line">{m.text}</p>
                  {m.aiWritten || m.verified ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {m.aiWritten ? (
                        <Badge tone="accent" icon={<Sparkles />}>
                          {ta('aiWritten')}
                        </Badge>
                      ) : null}
                      {m.verified ? (
                        <Badge tone="success" icon={<ShieldCheck />}>
                          {ta('verified')}
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            ),
          )}
          {pending ? (
            <>
              <li className="flex justify-end">
                <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-surface-elevated px-4 py-2.5 text-sm whitespace-pre-line">
                  {inFlight}
                </p>
              </li>
              <li>
                <Thinking label={ta('thinking')} />
              </li>
            </>
          ) : null}
        </ol>
        {!pending && chips.length > 0 ? (
          <ul className="flex flex-wrap gap-2 px-4 pb-4" aria-label={ta('suggestionsLabel')}>
            {chips.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  onClick={() => send(c)}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-start text-sm text-secondary shadow-soft transition hover:border-purple/40 hover:text-foreground"
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line px-3 pt-3 pb-3">
        {error ? (
          <Alert tone="danger" className="mb-2">
            {te(error)}
          </Alert>
        ) : null}
        <form
          aria-busy={pending}
          onSubmit={(e) => {
            e.preventDefault();
            send(value);
          }}
        >
          <Composer
            value={value}
            onChange={setValue}
            pending={pending}
            label={ta('askLabel')}
            placeholder={labels.placeholder}
            sendLabel={ta('ask')}
          />
        </form>
        <p className="mt-2 text-center text-[11px] text-muted">
          {aiOn ? ta('footnote') : ta('routerMode')}
        </p>
      </div>
    </section>
  );
}
