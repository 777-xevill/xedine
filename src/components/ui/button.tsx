import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

/** Pill buttons. min-h-11 = 44px, the smallest comfortable touch target on a tablet. */
export const buttonVariants = cva(
  'inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold whitespace-nowrap transition duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        // White on purple → deep blue passes AA at body size (ADR 0024, BRAND.md).
        primary: 'bg-action text-on-action glow-action hover:brightness-110',
        secondary:
          'border border-line bg-surface text-foreground shadow-soft hover:border-line-strong hover:bg-surface-elevated',
        ghost: 'text-secondary hover:bg-surface-elevated hover:text-foreground',
        danger:
          'border border-danger/30 bg-surface text-danger hover:border-danger/60 hover:bg-danger/5',
        subtle: 'bg-surface-elevated text-foreground hover:bg-line',
      },
      size: {
        default: '',
        sm: 'min-h-9 px-3.5 text-[0.8125rem]',
        lg: 'min-h-14 px-7 text-base',
        icon: 'size-11 px-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
