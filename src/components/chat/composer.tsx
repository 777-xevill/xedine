'use client';

import { ArrowUp, LoaderCircle } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The assistant's input (the founder's reference video): a white card with a soft brand-gradient
 * halo that grows from a pill into a card as the question gets longer. Enter sends, Shift+Enter adds
 * a line. Lives inside the caller's <form>; the textarea is named `question`.
 */
export function Composer({
  value,
  onChange,
  placeholder,
  label,
  sendLabel,
  pending,
  autoFocus,
  size = 'default',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  sendLabel: string;
  pending: boolean;
  autoFocus?: boolean;
  size?: 'default' | 'hero';
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const empty = value.trim() === '';
  return (
    <div className="composer-halo rounded-[1.625rem] shadow-lift">
      <div
        className={cn(
          'flex items-end gap-2 rounded-[1.5625rem] bg-surface',
          size === 'hero' ? 'p-2.5 ps-5' : 'p-2 ps-4',
        )}
      >
        <textarea
          ref={ref}
          name="question"
          rows={1}
          required
          maxLength={1000}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!empty && !pending) e.currentTarget.form?.requestSubmit();
            }
          }}
          aria-label={label}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={cn(
            'max-h-56 min-h-10 flex-1 resize-none bg-transparent py-2 leading-6 text-foreground placeholder:text-muted focus:outline-none focus-visible:outline-none',
            size === 'hero' ? 'text-base' : 'text-[0.9375rem]',
          )}
        />
        <button
          type="submit"
          disabled={empty || pending}
          aria-label={sendLabel}
          title={sendLabel}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-action text-on-action glow-action transition hover:brightness-110 disabled:bg-none disabled:bg-surface-elevated disabled:text-muted disabled:shadow-none"
        >
          {pending ? (
            <LoaderCircle aria-hidden className="size-5 animate-spin" />
          ) : (
            <ArrowUp aria-hidden className="size-5" />
          )}
        </button>
      </div>
    </div>
  );
}
