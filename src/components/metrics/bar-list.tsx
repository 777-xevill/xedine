import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { Meter } from './meter';

export interface BarItem {
  key: string;
  label: string;
  /** Drives the bar's length only; the text beside it is `display`. */
  value: number;
  display: string;
  hint?: string;
}

/**
 * A ranked horizontal bar list (magnitude, not identity): soft silver bars, the largest lit in yellow
 * (BRAND.md: yellow for the peak, silver for the rest). Every bar is labelled with its own value, so
 * nothing is read from colour or length alone, and the list itself is the table view. The bars fill
 * from the left one after another (motion only; every length is final from the first frame).
 */
export function BarList({
  items,
  label,
  className,
  peak,
  max,
}: {
  items: BarItem[];
  label: string;
  className?: string;
  /** Key of the bar to light up: by default the largest, `null` for none (a list's continuation). */
  peak?: string | null;
  /** The value of a full bar, when this list continues another, so both are drawn to one scale. */
  max?: number;
}) {
  const full = max ?? Math.max(0, ...items.map((i) => i.value));
  const lit =
    peak !== undefined ? peak : (items.find((i) => full > 0 && i.value === full)?.key ?? null);
  return (
    <ul aria-label={label} className={cn('space-y-3', className)}>
      {items.map((item, idx) => {
        const pct = full > 0 ? Math.max(1, Math.round((item.value / full) * 100)) : 0;
        return (
          <li
            key={item.key}
            title={`${item.label}: ${item.display}`}
            className="chart-row"
            style={{ '--chart-i': idx } as CSSProperties}
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-foreground">{item.label}</span>
              <span className="shrink-0 font-semibold text-foreground tabular-nums">
                {item.display}
                {item.hint ? (
                  <span className="ms-1.5 font-normal text-muted">{item.hint}</span>
                ) : null}
              </span>
            </div>
            <Meter pct={pct} tone={item.key === lit ? 'peak' : 'calm'} />
          </li>
        );
      })}
    </ul>
  );
}
