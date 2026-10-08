'use client';

import { ShieldCheck, Sparkles } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { flushSync } from 'react-dom';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { askAction } from '@/modules/assistant/actions';
import { initialState } from '@/modules/tenancy/form-state';
import { Composer } from './composer';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** The model wrote it (badge) or the deterministic router did. */
  aiWritten: boolean;
  /** Every number passed the numeric validator, or came straight from a metric. */
  verified: boolean;
  /** The metric ids the answer cites. */
  sources: string[];
}

/**
 * One ask form: the question, the org and the conversation (empty = start a new one, which the
 * server action redirects to). Remembers the question while it is in flight so it can be shown at
 * once and restored if the ask fails.
 */
function useAsk(formRef: React.RefObject<HTMLFormElement | null>, initialQuestion = '') {
  const [state, formAction, pending] = React.useActionState(askAction, initialState);
  const [value, setValue] = React.useState(initialQuestion);
  const [inFlight, setInFlight] = React.useState('');
  const [prevPending, setPrevPending] = React.useState(pending);
  if (prevPending !== pending) {
    setPrevPending(pending);
    if (pending) setValue('');
    else if (state.error) setValue(inFlight);
  }
  const askNow = (question: string) => {
    flushSync(() => setValue(question));
    formRef.current?.requestSubmit();
  };
  return { state, formAction, pending, value, setValue, inFlight, setInFlight, askNow };
}

function Hidden({
  orgId,
  orgSlug,
  conversationId,
}: {
  orgId: string;
  orgSlug: string;
  conversationId: string;
}) {
  return (
    <>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="conversationId" value={conversationId} />
    </>
  );
}

export function AssistantAvatar() {
  return (
    <Image
      src="/brand/logo-64.png"
      alt=""
      width={28}
      height={28}
      className="mt-0.5 size-7 shrink-0 rounded-lg shadow-soft"
    />
  );
}

export function Thinking({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" role="status">
      <AssistantAvatar />
      <span className="inline-flex items-center gap-1 py-2" aria-label={label}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className="animate-pulse-dot size-1.5 rounded-full bg-purple"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </span>
    </div>
  );
}

/**
 * The new-chat intro (the founder's reference video): a swirl of brand light behind the greeting
 * that slowly settles into the light page over ~4.5 s, then unmounts. Decoration only: it sits
 * behind the greeting and ignores the pointer, so people can type and send while it plays.
 */
function ChatIntro() {
  const [done, setDone] = React.useState(false);
  if (done) return null;
  return (
    <div
      aria-hidden
      className="chat-intro"
      onAnimationEnd={(e) => e.animationName === 'chat-intro-fade' && setDone(true)}
    >
      <span />
    </div>
  );
}

/** The chat workspace: the conversation (or the welcome screen) with the composer docked below. */
export function ChatView({
  orgId,
  orgSlug,
  conversationId,
  messages,
  suggestions,
  aiOn,
  initialQuestion,
  firstName,
}: {
  orgId: string;
  orgSlug: string;
  conversationId: string;
  messages: ChatMessage[];
  suggestions: string[];
  aiOn: boolean;
  initialQuestion?: string;
  firstName: string;
}) {
  const t = useTranslations('assistantPage');
  const te = useTranslations('errors');
  const formRef = React.useRef<HTMLFormElement>(null);
  const ask = useAsk(formRef, initialQuestion);
  const endRef = React.useRef<HTMLDivElement>(null);
  const isNew = messages.length === 0;
  // Played once per new chat. It stays mounted (same place in both layouts below) when the first
  // question is sent, so the glow keeps fading slowly instead of vanishing.
  const [intro] = React.useState(isNew);
  const introLayer = intro ? <ChatIntro /> : null;

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, ask.pending]);

  const error = ask.state.error ? (
    <Alert tone="danger" className="mb-3">
      {te(ask.state.error)}
    </Alert>
  ) : null;

  const form = (size: 'default' | 'hero') => (
    <form
      ref={formRef}
      action={ask.formAction}
      aria-busy={ask.pending}
      onSubmit={() => ask.setInFlight(ask.value.trim())}
    >
      <Hidden orgId={orgId} orgSlug={orgSlug} conversationId={conversationId} />
      <Composer
        size={size}
        value={ask.value}
        onChange={ask.setValue}
        pending={ask.pending}
        autoFocus
        label={t('askLabel')}
        placeholder={t('askPlaceholder')}
        sendLabel={t('ask')}
      />
    </form>
  );

  const footnote = (
    <p className="mt-2.5 text-center text-xs text-muted">
      {aiOn ? t('footnote') : t('routerMode')}
    </p>
  );

  if (isNew && !ask.pending) {
    return (
      <>
        {introLayer}
        <div className="relative z-[1] flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center px-4 py-10 lg:min-h-dvh">
          <div className="w-full max-w-2xl animate-rise-in">
            <p className="text-center text-sm font-medium text-purple">
              {t('hello', { name: firstName })}
            </p>
            <h1 className="mt-2 text-center text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl">
              {t('greeting')}
            </h1>
            <div className="mt-8">
              {error}
              {form('hero')}
              {footnote}
            </div>
            {suggestions.length > 0 ? (
              <ul
                className="mt-6 flex flex-wrap justify-center gap-2"
                aria-label={t('suggestionsLabel')}
              >
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => ask.askNow(s)}
                      className="rounded-full border border-line bg-surface px-3.5 py-2 text-sm text-secondary shadow-soft transition hover:border-purple/40 hover:text-foreground"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {introLayer}
      <div className="relative z-[1] flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh">
        <h1 className="sr-only">{t('title')}</h1>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ol className="mx-auto w-full max-w-3xl space-y-6 px-4 pt-8 pb-6 sm:px-6">
            {messages.map((m) =>
              m.role === 'user' ? (
                <li key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-surface-elevated px-4 py-2.5 whitespace-pre-line">
                    {m.text}
                  </p>
                </li>
              ) : (
                <li key={m.id} className="flex gap-3">
                  <AssistantAvatar />
                  <div className="min-w-0 flex-1">
                    <p className="leading-7 whitespace-pre-line">{m.text}</p>
                    {m.aiWritten || m.verified || m.sources.length > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {m.aiWritten ? (
                          <Badge tone="accent" icon={<Sparkles />}>
                            {t('aiWritten')}
                          </Badge>
                        ) : null}
                        {m.verified ? (
                          <Badge tone="success" icon={<ShieldCheck />}>
                            {t('verified')}
                          </Badge>
                        ) : null}
                        {m.sources.length > 0 ? (
                          <span className="text-xs text-muted">
                            {t('sources', { list: m.sources.join(', ') })}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              ),
            )}
            {ask.pending ? (
              <>
                <li className="flex justify-end">
                  <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-surface-elevated px-4 py-2.5 whitespace-pre-line">
                    {ask.inFlight}
                  </p>
                </li>
                <li>
                  <Thinking label={t('thinking')} />
                </li>
              </>
            ) : null}
          </ol>
          <div ref={endRef} />
        </div>
        <div className="bg-gradient-to-t from-background from-60% to-transparent px-4 pt-2 pb-4 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            {error}
            {form('default')}
            {footnote}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The home screen's "ask anything" box: starts a new conversation and opens it (ADR 0024).
 */
export function AskBox({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const t = useTranslations('assistantPage');
  const te = useTranslations('errors');
  const formRef = React.useRef<HTMLFormElement>(null);
  const ask = useAsk(formRef);
  return (
    <form
      ref={formRef}
      action={ask.formAction}
      aria-busy={ask.pending}
      onSubmit={() => ask.setInFlight(ask.value.trim())}
      className={cn('w-full')}
    >
      {ask.state.error ? (
        <Alert tone="danger" className="mb-3">
          {te(ask.state.error)}
        </Alert>
      ) : null}
      <Hidden orgId={orgId} orgSlug={orgSlug} conversationId="" />
      <Composer
        value={ask.value}
        onChange={ask.setValue}
        pending={ask.pending}
        label={t('askLabel')}
        placeholder={t('homePlaceholder')}
        sendLabel={t('ask')}
      />
    </form>
  );
}
