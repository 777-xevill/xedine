'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export interface NavItem {
  href: string;
  label: string;
  /** Match only the exact path (the overview), not its children. */
  exact?: boolean;
}

/** The dashboard's pill nav. Client-only for the active-page highlight; links work without JS. */
export function AppNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex max-w-full gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold whitespace-nowrap transition',
              active
                ? 'bg-surface-elevated text-foreground shadow-[inset_0_1px_0_0_var(--glass-edge-strong)]'
                : 'text-secondary hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
