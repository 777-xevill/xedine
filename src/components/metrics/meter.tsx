import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export type MeterTone = 'calm' | 'peak' | 'done';

const TONE: Record<MeterTone, string | null> = {
  calm: null,
  peak: 'chart-fill-peak',
  done: 'chart-fill-done',
};

/**
 * One horizontal track and its fill, drawn to scale: `pct` of the track (0–100). Decoration only, so
 * it is hidden from screen readers; the figure it stands for is always written beside it. Silver for
 * a plain bar, yellow for the largest of a list (`peak`), bright silver for progress toward done.
 * The fill slides in from the start of the track on a spring (src/app/styles/charts.css): motion only,
 * the length is final from the first frame.
 */
export function Meter({
  pct,
  tone = 'calm',
  className,
}: {
  pct: number;
  tone?: MeterTone;
  className?: string;
}) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div aria-hidden className={cn('chart-track', className)}>
      <div
        className={cn('chart-fill', TONE[tone])}
        style={{ '--chart-w': `${width}%` } as CSSProperties}
      />
    </div>
  );
}
