import { cn } from '@/lib/utils';

export interface BarItem {
  key: string;
  label: string;
  /** Drives the bar's length only; the text beside it is `display`. */
  value: number;
  display: string;
  hint?: string;
}

/**
 * A ranked, single-hue horizontal bar list (magnitude, not identity: one brand colour, no palette).
 * Every bar is labelled with its own value, so nothing is read from colour or length alone, and the
 * list itself is the table view.
 */
export function BarList({
  items,
  label,
  className,
}: {
  items: BarItem[];
  label: string;
  className?: string;
}) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <ul aria-label={label} className={cn('space-y-2.5', className)}>
      {items.map((item) => {
        const pct = max > 0 ? Math.max(1, Math.round((item.value / max) * 100)) : 0;
        return (
          <li key={item.key} title={`${item.label}: ${item.display}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-foreground">{item.label}</span>
              <span className="shrink-0 font-semibold text-foreground tabular-nums">
                {item.display}
                {item.hint ? (
                  <span className="ms-1.5 font-normal text-muted">{item.hint}</span>
                ) : null}
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-elevated/60" aria-hidden>
              <div className="h-full rounded-full bg-cyan/80" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
