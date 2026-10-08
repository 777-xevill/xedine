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
 * Columns over time (hours of a day, days of a period): one brand hue, magnitude only. The tallest
 * column carries the one direct label; every other value is a hover/tap tooltip, and each column's
 * aria-label is the table view for screen readers.
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
  const align = (idx: number) =>
    items.length > 3 && idx < items.length / 4
      ? 'left-0'
      : items.length > 3 && idx >= (items.length * 3) / 4
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';

  return (
    <figure className={cn('pt-7', className)}>
      <ul aria-label={label} className="flex h-40 items-end gap-0.5 border-b border-line-strong">
        {items.map((item, idx) => {
          const pct = max > 0 && item.value > 0 ? Math.max(2, (item.value / max) * 100) : 0;
          const isPeak = item.key === peak;
          return (
            <li
              key={item.key}
              tabIndex={0}
              aria-label={`${item.label}: ${item.display}`}
              className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
            >
              <div
                aria-hidden
                className={cn(
                  'w-full max-w-8 rounded-t-[4px] transition-colors group-hover:bg-purple group-focus-visible:bg-purple',
                  isPeak ? 'bg-purple' : 'bg-purple/50',
                )}
                style={{ height: `${pct}%` }}
              />
              {isPeak ? (
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute text-[11px] font-semibold whitespace-nowrap text-foreground tabular-nums group-hover:invisible group-focus-visible:invisible',
                    align(idx),
                  )}
                  style={{ bottom: `calc(${pct}% + 4px)` }}
                >
                  {item.display}
                </span>
              ) : null}
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute z-10 hidden rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-soft group-hover:block group-focus-visible:block',
                  align(idx),
                )}
                style={{ bottom: `calc(${pct}% + 6px)` }}
              >
                <span className="block text-secondary">{item.label}</span>
                <span className="block font-semibold text-foreground tabular-nums">
                  {item.display}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <div aria-hidden className="mt-1.5 flex gap-0.5">
        {items.map((item, idx) => (
          <span key={item.key} className="flex min-w-0 flex-1 justify-center">
            <span className="text-[10px] whitespace-nowrap text-muted">
              {idx % every === 0 ? item.axisLabel : ''}
            </span>
          </span>
        ))}
      </div>
    </figure>
  );
}
