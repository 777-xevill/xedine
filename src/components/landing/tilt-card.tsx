'use client';

import { useRef, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A card that leans toward a mouse pointer in 3D, with a soft glare that follows it (globals.css). */
export function TiltCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== 'mouse') return;
    const box = el.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width - 0.5;
    const y = (e.clientY - box.top) / box.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${-y * 12}deg) rotateY(${x * 14}deg) translateZ(8px)`;
    el.style.setProperty('--glare-x', `${(x + 0.5) * 100}%`);
    el.style.setProperty('--glare-y', `${(y + 0.5) * 100}%`);
  };
  const leave = () => {
    if (ref.current) ref.current.style.transform = '';
  };

  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      className={cn('landing-tilt', className)}
    >
      {children}
    </div>
  );
}
