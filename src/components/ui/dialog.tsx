'use client';

import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Modal glass sheet on the native <dialog> element: focus is trapped and Escape closes it without
 * any extra library. Rendered only while open, so state inside resets every time it opens.
 */
export function Dialog({
  title,
  onClose,
  closeLabel,
  children,
  footer,
  size = 'sm',
  testId,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  testId?: string;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cn(
        'glass-strong m-auto max-h-[92dvh] w-[calc(100%-2rem)] overflow-hidden rounded-sheet p-0 text-foreground backdrop:bg-background/70 backdrop:backdrop-blur-sm',
        size === 'sm' && 'max-w-sm',
        size === 'md' && 'max-w-lg',
        size === 'lg' && 'max-w-2xl',
      )}
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 id={titleId} className="text-lg font-bold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="glass-tile inline-flex size-9 items-center justify-center rounded-full text-secondary hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-edge px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
