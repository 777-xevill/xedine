import Link from 'next/link';
import * as React from 'react';
import { ViewTransition } from 'react';
import { cn } from '@/lib/utils';

/** A short, CSS-safe name for this bar's highlight, the same on every page that has the same bar. */
export function pillName(label: string): string {
  let h = 0;
  for (const ch of label) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) | 0;
  return `tab-pill-${(h >>> 0).toString(36)}`;
}

/**
 * Link tabs as a glass pill bar. Works with no client JavaScript. The highlighted tab is one object
 * (`.tab-pill`): when you move to another tab it glides there (a React <ViewTransition> shared
 * element, ADR 0063).
 */
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
        'glass-tile inline-flex max-w-full gap-1 overflow-x-auto rounded-full p-1',
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'relative isolate inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold whitespace-nowrap transition duration-300',
            item.active
              ? 'text-foreground [&_svg]:text-brand-yellow'
              : 'text-secondary hover:bg-surface-elevated hover:text-foreground',
          )}
        >
          {item.active ? (
            <ViewTransition name={pillName(label)} share="pill-glide" default="none">
              <span aria-hidden className="tab-pill" />
            </ViewTransition>
          ) : null}
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
