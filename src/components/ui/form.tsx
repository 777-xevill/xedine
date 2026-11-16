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

/** Fields are a step lighter than their card; focus lights the edge yellow with a soft glow. */
const field =
  'w-full min-h-11 rounded-input border border-edge bg-surface-elevated px-3.5 text-foreground placeholder:text-muted hover:border-edge-strong focus:border-brand-yellow/70 focus:bg-surface-hover focus:outline-none focus:glow-focus disabled:opacity-50';

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

/** Danger carries a solid yellow edge; warning a yellow tint; success and info stay silver. */
const TONE_CLASS: Record<Tone, string> = {
  danger: 'border-danger/70 bg-danger/12 text-danger shadow-[inset_3px_0_0_var(--danger)]',
  success: 'border-success/25 bg-success/6 text-success',
  info: 'border-edge bg-surface-elevated text-info',
  warning: 'border-warning/40 bg-warning/8 text-warning',
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
        'animate-rise-in flex items-start gap-2.5 rounded-input border px-3.5 py-3 text-sm',
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

/** A card: smoked glass with a hairline silver rim; rises in as it scrolls into view. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-reveal=""
      className={cn(
        'rounded-card border border-edge bg-surface bg-[image:var(--glass-sheen)] p-6 shadow-soft',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'mb-4 text-[0.9375rem] font-semibold tracking-tight text-foreground',
        className,
      )}
      {...props}
    />
  );
}

/** A big, quiet page title (Apple's large title): bold, tight, with the explanation below in grey. */
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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-9">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.03em] sm:text-[2.125rem]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-secondary">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A labelled figure. Figures always use the primary text token, never the gradient (ADR 0009), and
 * arrive out of a soft blur.
 */
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
    <div
      className={cn('rounded-input border border-edge bg-surface-elevated px-4 py-3.5', className)}
    >
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p
        className="animate-figure mt-1 text-[1.375rem] leading-tight font-semibold tracking-tight text-foreground tabular-nums"
        data-testid={testId}
      >
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
    <div
      className={cn(
        'animate-rise-in rounded-card border border-dashed border-edge-strong bg-surface/60 px-6 py-12 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className="mx-auto mb-3 block size-2 rounded-full bg-brand-yellow shadow-[0_0_18px_var(--brand-yellow)]"
      />
      <p className="font-semibold">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-md text-sm text-secondary">{body}</p> : null}
    </div>
  );
}
