'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
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
      <p className="px-2.5 pt-4 pb-1.5 text-xs font-medium text-muted">{label}</p>
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
                  'block truncate rounded-[0.625rem] px-2.5 py-1.5 text-sm transition',
                  c.id === current
                    ? 'bg-surface font-medium text-foreground shadow-soft'
                    : 'text-secondary hover:bg-surface/70 hover:text-foreground',
                )}
              >
                {c.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
