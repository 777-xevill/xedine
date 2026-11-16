import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The chef logo and the name (ADR 0056, everywhere since ADR 0063). The logo is its own white app-icon
 * tile, so it sits on the grey as it is, with a hairline rim; it tips its hat when you point at it.
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
  const px = size === 'lg' ? 44 : size === 'sm' ? 28 : 34;
  return (
    <span className={cn('group/brand inline-flex items-center gap-2.5', className)}>
      <Image
        src="/brand/logo-chef-192.png"
        alt=""
        width={px}
        height={px}
        priority
        className="rounded-[24%] shadow-soft ring-1 ring-edge transition-[rotate,scale] duration-500 ease-spring group-hover/brand:-rotate-6 group-hover/brand:scale-105"
      />
      <span
        className={cn(
          'font-bold tracking-[-0.03em] text-foreground',
          size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-[1.0625rem]' : 'text-lg',
        )}
      >
        {name}
      </span>
    </span>
  );
}
