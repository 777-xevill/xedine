import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const TONES: Record<BadgeTone, string> = {
  neutral: 'glass-tile text-secondary',
  success: 'border border-success/40 bg-success/10 text-success',
  warning: 'border border-warning/40 bg-warning/10 text-warning',
  danger: 'border border-danger/45 bg-danger/10 text-danger',
  info: 'border border-info/40 bg-info/10 text-info',
  accent: 'border border-purple/60 bg-purple/15 text-foreground',
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
