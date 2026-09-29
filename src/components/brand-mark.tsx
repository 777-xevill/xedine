import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Logo + wordmark. logo.png is a dark-background raster (BRAND.md), so on the light UI it always
 * sits in its own rounded app-icon tile rather than directly on a light surface.
 */
export function BrandMark({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const px = size === 'lg' ? 40 : size === 'sm' ? 26 : 30;
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <Image
        src="/brand/logo-64.png"
        alt=""
        width={px}
        height={px}
        priority
        className={cn('shadow-soft', size === 'lg' ? 'rounded-xl' : 'rounded-lg')}
      />
      <span
        className={cn(
          'font-bold tracking-tight text-foreground',
          size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-base' : 'text-lg',
        )}
      >
        {name}
      </span>
    </span>
  );
}
