import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
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
  'w-full min-h-11 rounded-input border border-edge bg-background-secondary/70 px-3.5 text-foreground shadow-[inset_0_1px_0_0_var(--glass-edge)] transition placeholder:text-muted hover:border-edge-strong focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/25 disabled:opacity-50';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, 'pe-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'min-h-20 py-2.5', className)} {...props} />;
}

export function Hint({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1.5 text-xs text-secondary', className)} {...props} />;
}

export type Tone = 'danger' | 'success' | 'info' | 'warning';

const TONE_ICON = {
  danger: XCircle,
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
} as const;

const TONE_CLASS: Record<Tone, string> = {
  danger: 'border-danger/45 text-danger',
  success: 'border-success/45 text-success',
  info: 'border-info/45 text-info',
  warning: 'border-warning/45 text-warning',
};

/** Status text is never colour alone (BRAND.md): every alert carries an icon and a text label. */
export function Alert({
  tone,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone: Tone }) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'glass flex items-start gap-2.5 rounded-input px-3.5 py-3 text-sm',
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="text-foreground">{children}</div>
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('glass rounded-card p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('mb-4 text-lg font-bold tracking-tight', className)} {...props} />;
}

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-2xl text-secondary">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** A labelled figure. Figures always use the primary text token, never the gradient (ADR 0009). */
export function Stat({
  label,
  value,
  className,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn('glass-tile rounded-input px-4 py-3', className)}>
      <p className="text-xs font-medium tracking-wide text-secondary uppercase">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground tabular-nums" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  className,
}: {
  title: string;
  body?: string;
  className?: string;
}) {
  return (
    <div className={cn('glass-tile rounded-card px-6 py-10 text-center', className)}>
      <p className="font-semibold">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-md text-sm text-secondary">{body}</p> : null}
    </div>
  );
}
