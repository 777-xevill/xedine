'use client';

import { useEffect, useRef, type ComponentProps } from 'react';

/**
 * The member card as a pass you can almost hold (ADR 0063): it leans a few degrees toward the pointer, or
 * toward the finger while it is pressed, the light on its metal following, then springs back flat. Only
 * CSS variables change (no re-render); still for people who ask for reduced motion.
 */
export function PassTilt({ children, ...props }: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let point: { x: number; y: number } | null = null;

    const apply = () => {
      frame = 0;
      if (!point) return;
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (point.x - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (point.y - r.top) / r.height));
      el.style.setProperty('--cust-rx', `${((0.5 - y) * 7).toFixed(2)}deg`);
      el.style.setProperty('--cust-ry', `${((x - 0.5) * 9).toFixed(2)}deg`);
      el.style.setProperty('--cust-px', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--cust-py', `${(y * 100).toFixed(1)}%`);
      el.dataset.tilt = '';
    };
    const follow = (e: PointerEvent) => {
      if (still.matches) return;
      // A finger leans the card only while it presses; a mouse leans it by pointing.
      if (e.pointerType !== 'mouse' && e.buttons === 0) return;
      point = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const settle = () => {
      point = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      delete el.dataset.tilt;
      for (const v of ['--cust-rx', '--cust-ry']) el.style.removeProperty(v);
    };
    const lift = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') settle();
    };

    el.addEventListener('pointerdown', follow, { passive: true });
    el.addEventListener('pointermove', follow, { passive: true });
    el.addEventListener('pointerup', lift);
    el.addEventListener('pointerleave', settle);
    el.addEventListener('pointercancel', settle);
    return () => {
      el.removeEventListener('pointerdown', follow);
      el.removeEventListener('pointermove', follow);
      el.removeEventListener('pointerup', lift);
      el.removeEventListener('pointerleave', settle);
      el.removeEventListener('pointercancel', settle);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} {...props}>
      <span aria-hidden className="cust-pass-glare" />
      {children}
    </div>
  );
}
