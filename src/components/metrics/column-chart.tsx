import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export interface ColumnItem {
  key: string;
  /** Short label under the column (only every few columns get one, so they never collide). */
  axisLabel: string;
  /** Full label for the tooltip and screen readers. */
  label: string;
  /** Drives the column's height only; the text shown is `display`. */
  value: number;
  display: string;
}

/**
 * Columns over time (hours of a day, days of a period): soft silver columns on hairline gridlines, the
 * peak lit in yellow (BRAND.md: yellow for the peak, silver for the rest). The tallest column carries
 * the one direct label; every other value is a hover/tap pill, and each column's aria-label is the
 * table view for screen readers. The columns grow from the baseline one after another on a spring
 * (src/app/styles/charts.css): motion only, every height is final from the first frame.
 */
export function ColumnChart({
  items,
  label,
  peak,
  className,
}: {
  items: ColumnItem[];
  label: string;
  /** Key of the column to label directly (the busiest hour, the best day). */
  peak?: string | null;
  className?: string;
}) {
  const max = Math.max(0, ...items.map((i) => i.value));
  const every = Math.max(1, Math.ceil(items.length / 8));
  // Timing only: 25–32 ms between columns, so a month's cascade still crosses in under a second.
  const step = Math.round(Math.min(32, Math.max(25, 640 / Math.max(1, items.length))));
  const align = (idx: number) =>
    items.length > 3 && idx < items.length / 4
      ? 'left-0 origin-bottom-left'
      : items.length > 3 && idx >= (items.length * 3) / 4
        ? 'right-0 origin-bottom-right'
        : 'left-1/2 -translate-x-1/2 origin-bottom';

  return (
    <figure className={cn('pt-7', className)}>
      <ul
        aria-label={label}
        className="chart-plot flex h-40 items-end"
        style={{ '--chart-step': `${step}ms` } as CSSProperties}
      >
        {items.map((item, idx) => {
          const pct = max > 0 && item.value > 0 ? Math.max(2, (item.value / max) * 100) : 0;
          const isPeak = item.key === peak;
          return (
            <li
              key={item.key}
              tabIndex={0}
              aria-label={`${item.label}: ${item.display}`}
              className="chart-col relative flex h-full min-w-0 flex-1 items-end justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
              style={{ '--chart-i': idx } as CSSProperties}
            >
              <div
                aria-hidden
                className={cn('chart-bar', isPeak && 'chart-bar-peak')}
                style={{ height: `${pct}%` }}
              />
              {isPeak ? (
                <span
                  aria-hidden
                  className={cn(
                    'chart-peak-label pointer-events-none absolute text-[11px] font-semibold whitespace-nowrap text-foreground tabular-nums',
                    align(idx),
                  )}
                  style={{ bottom: `calc(${pct}% + 6px)` }}
                >
                  {item.display}
                </span>
              ) : null}
              <span
                aria-hidden
                className={cn(
                  'chart-tip pointer-events-none absolute z-10 text-xs whitespace-nowrap',
                  align(idx),
                )}
                style={{ bottom: `calc(${pct}% + 8px)` }}
              >
                <span className="block text-muted">{item.label}</span>
                <span className="block text-[0.8125rem] font-semibold text-foreground tabular-nums">
                  {item.display}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <div aria-hidden className="mt-2 flex">
        {items.map((item, idx) => (
          <span key={item.key} className="flex min-w-0 flex-1 justify-center">
            <span className="text-[10px] whitespace-nowrap text-muted tabular-nums">
              {idx % every === 0 ? item.axisLabel : ''}
            </span>
          </span>
        ))}
      </div>
    </figure>
  );
}
