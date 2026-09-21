import * as React from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1.5 block text-sm font-medium text-foreground', className)}
      {...props}
    />
  );
}

const field =
  'w-full min-h-11 rounded-input border border-line bg-background-secondary px-3 text-foreground placeholder:text-muted focus:border-cyan focus:outline-none disabled:opacity-50';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, className)} {...props} />;
}

export function Hint({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1.5 text-xs text-secondary', className)} {...props} />;
}

/** Status text is never colour alone (BRAND.md): every alert carries an icon character and a label. */
export function Alert({
  tone,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone: 'danger' | 'success' | 'info' | 'warning' }) {
  const toneClass = {
    danger: 'border-danger text-danger',
    success: 'border-success text-success',
    info: 'border-info text-info',
    warning: 'border-warning text-warning',
  }[tone];
  const icon = { danger: '⚠', success: '✓', info: 'ℹ', warning: '⚠' }[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex gap-2 rounded-input border bg-surface px-3 py-2.5 text-sm',
        toneClass,
        className,
      )}
      {...props}
    >
      <span aria-hidden>{icon}</span>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-card border border-line bg-surface p-6', className)} {...props} />
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-secondary">{subtitle}</p> : null}
    </header>
  );
}
