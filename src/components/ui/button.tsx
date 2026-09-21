import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

/** min-h-11 = 44px: the smallest comfortable touch target for a cheap Android tablet. */
export const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-input px-4 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Dark text on the blue→cyan gradient passes AA; white on the pink/purple end does not (BRAND.md).
        primary: 'bg-action text-on-action hover:brightness-110',
        secondary:
          'border border-line-strong bg-transparent text-foreground hover:bg-surface-elevated',
        ghost: 'text-secondary hover:bg-surface-elevated hover:text-foreground',
        danger: 'border border-danger text-danger hover:bg-surface-elevated',
      },
      size: { default: '', sm: 'min-h-9 px-3' },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
