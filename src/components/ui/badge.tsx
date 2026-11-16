import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

/**
 * Three colours only (ADR 0063): silver is calm (fine, done, information), yellow is attention. A
 * warning is a faint yellow tint; danger is a stronger tint with a yellow rim and a soft glow.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: 'border border-edge bg-surface-elevated text-secondary',
  success: 'border border-success/25 bg-success/10 text-success',
  warning: 'border border-warning/25 bg-warning/8 text-warning',
  danger: 'border border-danger/55 bg-danger/15 text-danger shadow-[0_0_14px_-4px_var(--danger)]',
  info: 'border border-edge bg-surface-elevated text-info',
  accent: 'border border-purple/35 bg-purple/12 text-purple',
};

/** Pill badge. Status badges pass an icon so colour is never the only signal (BRAND.md). */
export function Badge({
  tone = 'neutral',
  icon,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; icon?: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden className="inline-flex [&>svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

const STATUS_ICON = {
  success: <CheckCircle2 />,
  warning: <AlertTriangle />,
  danger: <XCircle />,
  info: <Info />,
  neutral: <CircleDashed />,
} as const;

/** A status badge: icon + label + colour, always all three (BRAND.md fixed semantic rules). */
export function StatusBadge({
  tone,
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone: keyof typeof STATUS_ICON }) {
  return (
    <Badge tone={tone} icon={STATUS_ICON[tone]} className={className} {...props}>
      {children}
    </Badge>
  );
}
