import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Pill buttons (ADR 0063). min-h-11 = 44px, the smallest comfortable touch target on a tablet. They
 * glide on hover and sink on a spring when pressed. Primary is the founder's yellow with grey words
 * (9:1) and a sheet of light that sweeps across it on hover (`.btn-shine`); danger is yellow too but
 * outlined, with words that say what it does.
 */
export const buttonVariants = cva(
  'relative inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale,translate,filter] duration-300 ease-smooth active:scale-[0.96] active:duration-100 disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary:
          'btn-shine overflow-hidden bg-action text-on-action glow-action hover:-translate-y-px hover:brightness-[1.06]',
        secondary:
          'border border-edge bg-surface-elevated text-foreground shadow-soft hover:-translate-y-px hover:border-edge-strong hover:bg-surface-hover',
        ghost: 'text-secondary hover:bg-surface-elevated hover:text-foreground',
        danger:
          'border border-danger/45 bg-danger/8 text-danger hover:border-danger/80 hover:bg-danger/15',
        subtle: 'bg-surface-elevated text-foreground hover:bg-surface-hover',
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
