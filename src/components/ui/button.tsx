import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

/** Pill buttons (UI_UX_design/). min-h-11 = 44px, the smallest comfortable touch target on a tablet. */
export const buttonVariants = cva(
  'inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold whitespace-nowrap transition duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        // Dark text on the blue→cyan gradient passes AA; white on the pink/purple end does not (BRAND.md).
        primary: 'bg-action text-on-action glow-action hover:brightness-110',
        secondary: 'glass text-foreground hover:border-edge-strong hover:bg-surface-elevated/70',
        ghost: 'text-secondary hover:bg-surface-elevated/60 hover:text-foreground',
        danger: 'glass border-danger/50 text-danger hover:border-danger hover:bg-danger/10',
        subtle: 'glass-tile text-foreground hover:border-edge-strong',
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
