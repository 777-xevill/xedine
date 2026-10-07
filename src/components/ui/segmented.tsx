'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  testId?: string;
}

/** Segmented pill control (UI_UX_design/ "Option 1 | Option 2 | Option 3"). A radio group underneath. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'default',
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface-elevated p-1',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={o.testId}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition',
              size === 'sm' ? 'min-h-7 px-2.5 text-xs' : 'px-4 text-sm',
              size === 'lg' ? 'min-h-12' : size === 'sm' ? '' : 'min-h-9',
              active
                ? 'bg-surface text-foreground shadow-soft'
                : 'text-secondary hover:text-foreground',
            )}
          >
            {o.icon ? (
              <span
                aria-hidden
                className={
                  size === 'sm' ? 'inline-flex [&>svg]:size-3.5' : 'inline-flex [&>svg]:size-4'
                }
              >
                {o.icon}
              </span>
            ) : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** On/off switch (UI_UX_design/ toggle). */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition disabled:opacity-45',
        checked ? 'border-transparent bg-action' : 'border-line-strong bg-surface-elevated',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-5 rounded-full bg-surface shadow-soft transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}
