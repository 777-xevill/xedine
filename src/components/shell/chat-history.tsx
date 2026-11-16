'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ViewTransition } from 'react';
import { cn } from '@/lib/utils';

export interface ChatSummary {
  id: string;
  title: string;
}

/**
 * The signed-in person's recent assistant conversations (ai_conversations is private per user by
 * RLS). Every conversation started anywhere in the app appears here.
 */
export function ChatHistory({
  chats,
  assistantHref,
  label,
  empty,
}: {
  chats: ChatSummary[];
  assistantHref: string;
  label: string;
  empty: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = pathname === assistantHref ? params.get('c') : null;
  return (
    <nav aria-label={label}>
      <p className="px-2.5 pt-5 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
        {label}
      </p>
      {chats.length === 0 ? (
        <p className="px-2.5 py-1 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-0.5" data-testid="chat-history">
          {chats.map((c) => (
            <li key={c.id}>
              <Link
                href={`${assistantHref}?c=${c.id}`}
                aria-current={c.id === current ? 'page' : undefined}
                title={c.title}
                className={cn(
                  'relative isolate block truncate rounded-[0.625rem] px-2.5 py-1.5 text-sm transition duration-300',
                  c.id === current
                    ? 'font-medium text-foreground'
                    : 'text-secondary hover:bg-surface hover:text-foreground',
                )}
              >
                {c.id === current ? (
                  <ViewTransition name="chat-pill" share="pill-glide" default="none">
                    <span aria-hidden className="nav-pill" />
                  </ViewTransition>
                ) : null}
                {c.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
