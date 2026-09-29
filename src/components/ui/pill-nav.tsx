import Link from 'next/link';
import * as React from 'react';
import { cn } from '@/lib/utils';

/** Link tabs as a glass pill bar (UI_UX_design/ tab bar). Works with no client JavaScript. */
export function PillNav({
  items,
  label,
  className,
}: {
  items: { href: string; label: string; active?: boolean; icon?: React.ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        'inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface-elevated p-1',
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold whitespace-nowrap transition',
            item.active
              ? 'bg-surface text-foreground shadow-soft'
              : 'text-secondary hover:text-foreground',
          )}
        >
          {item.icon ? (
            <span aria-hidden className="inline-flex [&>svg]:size-4">
              {item.icon}
            </span>
          ) : null}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
