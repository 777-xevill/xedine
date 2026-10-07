'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toBanglaDigits, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';

export interface CountPeriodLabels {
  presets: { last: string; month: string; quarter: string; all: string };
  pickLast: string;
  /** "{from} → {to} · {days} days" */
  chosen: string;
  show: string;
  prev: string;
  next: string;
  legend: string;
}

const DAY_MS = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Pick the period for the loss report. A loss is measured between two shelf counts, so only the days
 * a count was done can be chosen: they are filled in the calendar, every other day is greyed out.
 * Tap the first count, then the last; or use a shortcut. Dates are plain business dates (no clock).
 */
export function CountPeriod({
  dates,
  from: initialFrom,
  to: initialTo,
  basePath,
  params,
  locale,
  labels,
}: {
  /** Count dates (ISO), any order. */
  dates: string[];
  from: string;
  to: string;
  basePath: string;
  params: Record<string, string>;
  locale: Locale;
  labels: CountPeriodLabels;
}) {
  const router = useRouter();
  const counts = useMemo(() => [...new Set(dates)].sort(), [dates]);
  const countSet = useMemo(() => new Set(counts), [counts]);
  const [range, setRange] = useState<[string, string]>([initialFrom, initialTo]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [month, setMonth] = useState(initialTo.slice(0, 7));

  const first = counts[0]!;
  const last = counts[counts.length - 1]!;
  const lang = locale === 'bn' ? 'bn-BD' : 'en-GB';
  const num = (n: number) => (locale === 'bn' ? toBanglaDigits(String(n)) : String(n));
  const long = (d: string) =>
    new Intl.DateTimeFormat(lang, {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(ms(d));

  const go = (f: string, t: string) => {
    const q = new URLSearchParams({ ...params, from: f, to: t });
    router.push(`${basePath}?${q.toString()}`);
  };

  // Shortcuts: the newest count, then the oldest count that is at least N days before it.
  const preset = (daysBack: number | null) => {
    const to = last;
    const earlier = counts.filter((d) => d < to);
    if (earlier.length === 0) return;
    const from =
      daysBack === null
        ? first
        : (earlier.find((d) => ms(d) >= ms(to) - daysBack * DAY_MS) ??
          earlier[earlier.length - 1]!);
    setRange([from, to]);
    setAnchor(null);
    go(from, to);
  };

  const [year, mon] = month.split('-').map(Number) as [number, number];
  const monthStart = Date.UTC(year, mon - 1, 1);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const lead = new Date(monthStart).getUTCDay(); // Sunday first
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(lang, { timeZone: 'UTC', weekday: 'narrow' }).format(
      Date.UTC(2026, 0, 4 + i),
    ),
  );
  const monthTitle = new Intl.DateTimeFormat(lang, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(monthStart);
  const shift = (by: number) => {
    const d = new Date(Date.UTC(year, mon - 1 + by, 1));
    setMonth(iso(d.getTime()).slice(0, 7));
  };
  const canPrev = month > first.slice(0, 7);
  const canNext = month < last.slice(0, 7);

  const [rf, rt] = anchor ? [anchor, anchor] : range;
  const pick = (d: string) => {
    if (!anchor) {
      setAnchor(d);
      return;
    }
    if (d === anchor) return;
    const next: [string, string] = d < anchor ? [d, anchor] : [anchor, d];
    setRange(next);
    setAnchor(null);
  };
  const nights = Math.round((ms(range[1]) - ms(range[0])) / DAY_MS);

  const chip =
    'rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium transition hover:border-line-strong hover:bg-surface-elevated';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={chip} onClick={() => preset(null)}>
          {labels.presets.all}
        </button>
        <button type="button" className={chip} onClick={() => preset(90)}>
          {labels.presets.quarter}
        </button>
        <button type="button" className={chip} onClick={() => preset(30)}>
          {labels.presets.month}
        </button>
        <button type="button" className={chip} onClick={() => preset(0)}>
          {labels.presets.last}
        </button>
      </div>

      <div className="max-w-sm rounded-card border border-line bg-surface p-3 shadow-soft">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            aria-label={labels.prev}
            disabled={!canPrev}
            onClick={() => shift(-1)}
            className="inline-flex size-9 items-center justify-center rounded-full hover:bg-surface-elevated disabled:opacity-30"
          >
            <ChevronLeft aria-hidden className="size-5 rtl:rotate-180" />
          </button>
          <p className="text-sm font-semibold">{monthTitle}</p>
          <button
            type="button"
            aria-label={labels.next}
            disabled={!canNext}
            onClick={() => shift(1)}
            className="inline-flex size-9 items-center justify-center rounded-full hover:bg-surface-elevated disabled:opacity-30"
          >
            <ChevronRight aria-hidden className="size-5 rtl:rotate-180" />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-xs text-secondary">
          {weekdays.map((w, i) => (
            <span key={i} className="py-1">
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = iso(monthStart + i * DAY_MS);
            const counted = countSet.has(d);
            const edge = d === rf || d === rt;
            const inside = d > rf && d < rt;
            return (
              <span
                key={d}
                className={cn(
                  'flex h-10 items-center justify-center',
                  inside && 'bg-purple/10',
                  d === rf && rf !== rt && 'rounded-s-full bg-purple/10',
                  d === rt && rf !== rt && 'rounded-e-full bg-purple/10',
                )}
              >
                {counted ? (
                  <button
                    type="button"
                    aria-pressed={edge}
                    aria-label={long(d)}
                    onClick={() => pick(d)}
                    className={cn(
                      'size-9 rounded-full text-sm font-semibold transition',
                      edge
                        ? 'bg-action text-on-action'
                        : 'border border-purple/40 text-foreground hover:bg-purple/10',
                    )}
                  >
                    {num(i + 1)}
                  </button>
                ) : (
                  <span aria-hidden className="text-sm text-secondary/40">
                    {num(i + 1)}
                  </span>
                )}
              </span>
            );
          })}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-secondary">
          <span aria-hidden className="size-3 rounded-full border border-purple/40" />
          {labels.legend}
        </p>
      </div>

      <p className="text-sm font-medium" aria-live="polite">
        {anchor
          ? labels.pickLast
          : labels.chosen
              .replace('{from}', long(range[0]))
              .replace('{to}', long(range[1]))
              .replace('{days}', num(nights))}
      </p>
      <Button
        type="button"
        variant="secondary"
        disabled={anchor !== null}
        onClick={() => go(range[0], range[1])}
      >
        {labels.show}
      </Button>
    </div>
  );
}
