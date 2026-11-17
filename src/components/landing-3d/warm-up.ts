'use client';

/** An upright phone (the layout with the card at the bottom). */
const isPhone = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

/** When the visitor last scrolled: warm-up work waits for a quiet moment. */
let lastScroll = 0;
if (typeof window !== 'undefined')
  window.addEventListener('scroll', () => (lastScroll = performance.now()), { passive: true });

/**
 * On a phone, runs `steps` one at a time, each in an idle moment while the visitor isn't scrolling, so the
 * work never lands in the middle of a scroll. Other devices keep their behaviour: does nothing there.
 */
export function onPhoneWhenQuiet(steps: (() => void)[]) {
  if (!isPhone()) return () => undefined;
  let i = 0;
  let handle = 0;
  const idle = (fn: () => void) =>
    typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(fn, { timeout: 4000 })
      : window.setTimeout(fn, 300);
  const run = () => {
    if (performance.now() - lastScroll < 600) {
      handle = window.setTimeout(() => (handle = idle(run)), 600);
      return;
    }
    steps[i++]?.();
    if (i < steps.length) handle = idle(run);
  };
  handle = idle(run);
  return () => {
    window.clearTimeout(handle);
    if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
  };
}
