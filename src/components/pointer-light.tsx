'use client';

import { useEffect } from 'react';

/**
 * Lets glass cards catch the light where the pointer is (ADR 0063, "glass glow"): one passive listener
 * for the whole app writes the pointer's position into --mx / --my on the card under it, once per
 * frame. Mouse and pen only; touch screens and reduced motion get the still card.
 */
export function PointerLight() {
  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!fine.matches || still.matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      const target = last?.target;
      if (!last || !(target instanceof Element)) return;
      const card = target.closest<HTMLElement>('[data-spot], .workspace .rounded-card.bg-surface');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${Math.round(last.clientX - r.left)}px`);
      card.style.setProperty('--my', `${Math.round(last.clientY - r.top)}px`);
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
