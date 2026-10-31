'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The landing hero's 3D stage: children placed at different depths (translateZ) inside one perspective
 * box that leans toward the pointer and sways slowly on its own. Pure CSS 3D, no WebGL; it holds still
 * for people who ask for reduced motion.
 */
export function Stage3D({ children, className }: { children: ReactNode; className?: string }) {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      target = {
        x: (e.clientX / window.innerWidth - 0.5) * 2,
        y: (e.clientY / window.innerHeight - 0.5) * 2,
      };
    };
    const tick = (time: number) => {
      // Ease toward the pointer; the idle sway keeps the scene alive on touch screens.
      current.x += (target.x - current.x) * 0.06;
      current.y += (target.y - current.y) * 0.06;
      const sway = Math.sin(time / 2600) * 5;
      el.style.transform = `rotateX(${12 - current.y * 8}deg) rotateY(${-18 + current.x * 14 + sway}deg)`;
      frame = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className={cn('[perspective:1400px]', className)}>
      <div
        ref={stage}
        className="relative size-full [transform-style:preserve-3d]"
        style={{ transform: 'rotateX(12deg) rotateY(-18deg)' }}
      >
        {children}
      </div>
    </div>
  );
}

/** One card in the stage, lifted toward the viewer by `depth` pixels and floating gently. */
export function Layer({
  depth,
  delay = 0,
  className,
  children,
}: {
  depth: number;
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn('landing-float absolute', className)}
      style={{ transform: `translateZ(${depth}px)`, animationDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}
