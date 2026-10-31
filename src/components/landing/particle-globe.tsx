'use client';

import { useEffect, useRef } from 'react';

const ACCENTS = ['--accent-pink', '--accent-purple', '--accent-blue', '--accent-cyan'];
const COUNT = 560;

/**
 * A slowly turning globe of brand-coloured dots behind the hero, drawn on a 2D canvas with a simple
 * perspective projection (no 3D library). Colours come from the brand tokens; one still frame for
 * reduced motion.
 */
export function ParticleGlobe({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const css = getComputedStyle(document.documentElement);
    const colors = ACCENTS.map((v) => css.getPropertyValue(v).trim() || 'currentColor');
    // A Fibonacci sphere spreads the dots evenly; the colour bands run pink at the top to cyan below.
    const points = Array.from({ length: COUNT }, (_, i) => {
      const y = 1 - (2 * (i + 0.5)) / COUNT;
      const r = Math.sqrt(1 - y * y);
      const a = i * Math.PI * (3 - Math.sqrt(5));
      const band = Math.min(colors.length - 1, Math.floor(((y + 1) / 2) * colors.length));
      return {
        x: Math.cos(a) * r,
        y,
        z: Math.sin(a) * r,
        color: colors[colors.length - 1 - band]!,
      };
    });
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, w, h);
      const spin = time / 9000;
      const tilt = 0.45;
      const radius = Math.min(w, h) * 0.42;
      const [cs, ss, ct, st] = [Math.cos(spin), Math.sin(spin), Math.cos(tilt), Math.sin(tilt)];
      for (const p of points) {
        const x = p.x * cs - p.z * ss;
        const z0 = p.x * ss + p.z * cs;
        const y = p.y * ct - z0 * st;
        const z = p.y * st + z0 * ct;
        // Nearer dots (z toward -1) are larger and brighter.
        const scale = 2.6 / (2.6 + z);
        ctx.globalAlpha = 0.12 + 0.78 * ((1 - z) / 2);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(
          w / 2 + x * radius * scale,
          h / 2 + y * radius * scale,
          1.7 * scale,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!still) frame = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (still) draw(0);
    });
    observer.observe(canvas);
    resize();
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
