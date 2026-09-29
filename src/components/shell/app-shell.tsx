'use client';

import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The signed-in layout (ADR 0024): a fixed sidebar and one main workspace, like a chat app. On
 * phones and tablets the sidebar is a drawer behind a menu button; it closes on navigation and on
 * Escape, and is hidden from keyboard and screen readers while closed.
 */
export function AppShell({
  sidebar,
  mobileBar,
  children,
  openLabel,
  closeLabel,
}: {
  sidebar: React.ReactNode;
  /** Brand and quick actions for the phone/tablet top bar. */
  mobileBar: React.ReactNode;
  children: React.ReactNode;
  openLabel: string;
  closeLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const [seenPath, setSeenPath] = React.useState(pathname);
  if (seenPath !== pathname) {
    // Navigated: close the drawer (state adjusted during render, not in an effect).
    setSeenPath(pathname);
    setOpen(false);
  }

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-dvh lg:ps-[var(--sidebar-width)]">
      <aside
        id="app-sidebar"
        className={cn(
          'fixed inset-y-0 start-0 z-40 flex w-[min(var(--sidebar-width),86vw)] flex-col border-e border-line bg-background-secondary transition-[transform,visibility] duration-200 ease-out lg:w-[var(--sidebar-width)] lg:translate-x-0',
          open
            ? 'translate-x-0 shadow-lift'
            : 'max-lg:invisible max-lg:-translate-x-full rtl:max-lg:translate-x-full',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={closeLabel}
          className="absolute end-2 top-3 inline-flex size-9 items-center justify-center rounded-full text-secondary hover:bg-surface lg:hidden"
        >
          <X aria-hidden className="size-4" />
        </button>
        {sidebar}
      </aside>

      {open ? (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-foreground/20 backdrop-blur-[1px] lg:hidden"
        />
      ) : null}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-background/85 px-2 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={openLabel}
          aria-expanded={open}
          aria-controls="app-sidebar"
          className="inline-flex size-10 items-center justify-center rounded-full text-foreground hover:bg-surface-elevated"
        >
          <Menu aria-hidden className="size-5" />
        </button>
        {mobileBar}
      </header>

      {children}
    </div>
  );
}
