import { CalendarClock, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Building blocks for the Stock page (ADR 0026): big icons and short words, so an owner who has never
 * heard of "variance" or "days of cover" still reads the page at a glance. Presentational only — every
 * string arrives already translated and every figure already formatted (CLAUDE.md #1, #6). Status
 * always pairs a colour with an icon and a word (BRAND.md).
 */
export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const ICON_BOX: Record<Tone, string> = {
  info: 'bg-purple/15 text-purple',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/18 text-warning',
  danger: 'bg-danger/15 text-danger',
  neutral: 'bg-surface-elevated text-secondary',
};
const TEXT: Record<Tone, string> = {
  info: 'text-purple',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  neutral: 'text-secondary',
};
const CARD: Record<Tone, string> = {
  info: 'border-purple/25 bg-purple/8',
  success: 'border-success/30 bg-success/10',
  warning: 'border-warning/35 bg-warning/10',
  danger: 'border-danger/30 bg-danger/8',
  neutral: 'border-line bg-surface',
};
const BAR: Record<Tone, string> = {
  info: 'bg-purple',
  success: 'bg-success-bright',
  warning: 'bg-warning-bright',
  danger: 'bg-danger-bright',
  neutral: 'bg-line-strong',
};

/** A round tinted badge around an icon. Decorative: the words next to it carry the meaning. */
export function ToneIcon({
  tone,
  icon,
  className,
  solid,
}: {
  tone: Tone;
  icon: ReactNode;
  className?: string;
  /** White behind the tint, for use on an already tinted card. */
  solid?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full [&>svg]:size-[56%]',
        ICON_BOX[tone],
        solid && 'bg-surface',
        className,
      )}
    >
      {icon}
    </span>
  );
}

export interface SectionTab {
  key: string;
  href: string;
  label: string;
  hint: string;
  icon: ReactNode;
  tone: Tone;
  active: boolean;
}

/** The sections as big tiles: an icon you can recognise before you read the word. No JavaScript. */
export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  return (
    <nav
      aria-label={label}
      className={cn(
        'mb-6 grid gap-2 sm:gap-3',
        tabs.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3',
      )}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-col items-center gap-2 rounded-card border p-3 text-center transition sm:flex-row sm:gap-3.5 sm:p-4 sm:text-start',
            tab.active
              ? 'border-purple/40 bg-surface shadow-soft ring-1 ring-purple/15'
              : 'border-line bg-surface/60 hover:bg-surface',
          )}
        >
          <ToneIcon tone={tab.tone} icon={tab.icon} className="size-11 sm:size-12" />
          <span className="min-w-0">
            <span className="block text-sm leading-tight font-semibold sm:text-base">
              {tab.label}
            </span>
            <span className="mt-0.5 hidden text-xs leading-snug text-secondary sm:block">
              {tab.hint}
            </span>
          </span>
        </Link>
      ))}
    </nav>
  );
}

/** One big message with an icon: the answer to "so, is everything alright?". */
export function Banner({
  tone,
  icon,
  title,
  body,
  children,
}: {
  tone: Tone;
  icon: ReactNode;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cn('flex items-start gap-3.5 rounded-card border p-4 sm:p-5', CARD[tone])}>
      <ToneIcon tone={tone} icon={icon} solid className="size-11 sm:size-12" />
      <div className="min-w-0">
        <h2 className="text-base leading-snug font-semibold sm:text-lg">{title}</h2>
        {body ? <p className="mt-0.5 text-sm text-secondary">{body}</p> : null}
        {children}
      </div>
    </section>
  );
}

/** A smaller tinted box with an icon, for the plain verdict inside an item ("A difference of 0.4 kg is normal"). */
export function Callout({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-input border p-3 text-sm', CARD[tone])}>
      <span aria-hidden className={cn('mt-0.5 inline-flex shrink-0 [&>svg]:size-4.5', TEXT[tone])}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A small round-cornered word, e.g. an item's name in a list of what is running low. */
export function Chips({ items, more }: { items: string[]; more?: string }) {
  return (
    <ul className="mt-2.5 flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <li
          key={`${item}-${i}`}
          className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-sm font-medium"
        >
          {item}
        </li>
      ))}
      {more ? <li className="px-1 py-0.5 text-sm text-secondary">{more}</li> : null}
    </ul>
  );
}

/** A heading with its icon, for a group of rows ("Running low", "Enough"). */
export function GroupHeading({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <h3
      className={cn(
        'mb-2 flex items-center gap-2 text-sm font-semibold [&>svg]:size-4',
        TEXT[tone],
      )}
    >
      <span aria-hidden className="inline-flex">
        {icon}
      </span>
      {children}
    </h3>
  );
}

/** One ingredient and how much is left: icon, name, a plain sentence, and the amount, large. */
export function LevelRow({
  tone,
  icon,
  name,
  note,
  noteTone = 'neutral',
  detail,
  amount,
  amountTone = 'neutral',
  lot,
}: {
  tone: Tone;
  icon: ReactNode;
  name: string;
  note: string;
  noteTone?: Tone;
  /** ADR 0030: "Used 1.2 kg in 4 days · about 300 g a day". */
  detail?: string;
  amount: string;
  amountTone?: Tone;
  /** ADR 0029: the latest lot's countdown ("Bought Sat for 3 days · 1 day left"). */
  lot?: { text: string; tone: Tone };
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-input border px-3 py-2.5 sm:px-4',
        tone === 'danger' ? CARD.danger : 'border-line bg-surface',
      )}
    >
      <ToneIcon tone={tone} icon={icon} className="size-9" solid={tone === 'danger'} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{name}</p>
        <p className={cn('text-sm', TEXT[noteTone])}>{note}</p>
        {detail ? <p className="text-xs text-secondary">{detail}</p> : null}
        {lot ? (
          <p className={cn('mt-0.5 flex items-start gap-1 text-xs font-medium', TEXT[lot.tone])}>
            <CalendarClock aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>{lot.text}</span>
          </p>
        ) : null}
      </div>
      <p
        className={cn(
          'shrink-0 text-end text-base font-bold tabular-nums sm:text-lg',
          amountTone === 'neutral' ? '' : TEXT[amountTone],
        )}
      >
        {amount}
      </p>
    </li>
  );
}

/**
 * One ingredient as a line you can read in a second; tap it for the detail. The worst ones start open.
 * Native <details>, so it works with no JavaScript.
 */
export function ItemRow({
  tone,
  icon,
  name,
  note,
  noteTone = 'neutral',
  aside,
  open,
  children,
}: {
  tone: Tone;
  icon: ReactNode;
  name: string;
  note?: string;
  noteTone?: Tone;
  aside?: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <li>
      <details open={open} className="group rounded-card border border-line bg-surface">
        <summary className="flex min-h-14 cursor-pointer list-none items-start gap-3 rounded-card p-3.5 sm:px-4 [&::-webkit-details-marker]:hidden">
          <ToneIcon tone={tone} icon={icon} className="size-10" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{name}</span>
            {note ? (
              <span className={cn('block text-sm font-medium', TEXT[noteTone])}>{note}</span>
            ) : null}
          </span>
          {aside ? (
            <span className="shrink-0 pt-0.5 text-base font-bold tabular-nums">{aside}</span>
          ) : null}
          <ChevronDown
            aria-hidden
            className="mt-2.5 size-4 shrink-0 text-secondary transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="border-t border-line px-3.5 pt-3.5 pb-4 sm:px-4">{children}</div>
      </details>
    </li>
  );
}

export interface SplitPart {
  key: string;
  label: string;
  /** Ready-written quantity ("1.034 kg"). */
  value: string;
  /** The raw quantity, only to draw this part to scale. */
  qty: number;
  tone: Tone;
}

/** Segments of one bar drawn to scale: 2px gaps, 4px corners, never thinner than a tap-sized sliver. */
function SplitBar({ parts }: { parts: SplitPart[] }) {
  return (
    <div aria-hidden className="flex h-6 gap-0.5">
      {parts
        .filter((p) => p.qty > 0)
        .map((p) => (
          <div
            key={p.key}
            className={cn('h-full min-w-1.5 rounded-[4px]', BAR[p.tone])}
            style={{ flexGrow: p.qty, flexBasis: 0 }}
          />
        ))}
    </div>
  );
}

function Swatch({ tone }: { tone: Tone }) {
  return <span aria-hidden className={cn('size-3 shrink-0 rounded-[3px]', BAR[tone])} />;
}

/**
 * Where the stock went, in one picture (replaces two near-equal bars that hid a small loss).
 * Top: one bar for everything that left the shelf — the part the dishes needed, then the extra at the
 * end. When there is an extra, a zoom opens below it: the same extra drawn big and split into what was
 * written down as waste and what nobody explained, so even a 2% loss reads at a glance. Every part
 * is a quantity from the metric, drawn to scale; this component adds nothing up.
 */
export function UsageSplit({
  title,
  total,
  main,
  zoom,
  ariaLabel,
}: {
  title: string;
  total: string;
  /** The bar's parts in order; the last one is what the zoom opens up when `zoom` is given. */
  main: SplitPart[];
  zoom?: { title: string; total: string; parts: SplitPart[] };
  ariaLabel: string;
}) {
  const shown = main.filter((p) => p.qty > 0);
  return (
    <figure role="img" aria-label={ariaLabel} className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{title}</span>
        <span className="shrink-0 font-semibold tabular-nums">{total}</span>
      </div>
      <SplitBar parts={main} />
      <ul className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
        {shown.map((p) => (
          <li key={p.key} className="flex min-w-0 items-center gap-1.5">
            <Swatch tone={p.tone} />
            <span className="text-secondary">{p.label}</span>
            <span className="font-semibold tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
      {zoom ? (
        <>
          <div className="flex items-baseline justify-between gap-3 pt-4 text-sm">
            <span className="font-medium">{zoom.title}</span>
            <span className="shrink-0 font-semibold tabular-nums">{zoom.total}</span>
          </div>
          <SplitBar parts={zoom.parts} />
          <ul className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
            {zoom.parts
              .filter((p) => p.qty > 0)
              .map((p) => (
                <li key={p.key} className="flex min-w-0 items-center gap-1.5">
                  <Swatch tone={p.tone} />
                  <span className="text-secondary">{p.label}</span>
                  <span className="font-semibold tabular-nums">{p.value}</span>
                </li>
              ))}
          </ul>
        </>
      ) : null}
    </figure>
  );
}

/** One line of the "how we worked this out" sum. `strong` rows are the results. */
export function LedgerLine({
  icon,
  label,
  value,
  strong,
  tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  strong?: boolean;
  tone?: Tone;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 py-1.5 text-sm',
        strong && 'border-t border-line pt-2.5 font-semibold',
      )}
    >
      <span className="flex min-w-0 items-center gap-2 [&>span>svg]:size-4">
        <span aria-hidden className={cn('inline-flex shrink-0', TEXT[strong ? tone : 'neutral'])}>
          {icon}
        </span>
        {label}
      </span>
      <span className={cn('shrink-0 tabular-nums', strong && TEXT[tone])}>{value}</span>
    </div>
  );
}

/** A closed-by-default section for the detail most people do not need (native <details>, no script). */
export function Disclosure({
  summary,
  icon,
  open,
  className,
  children,
}: {
  summary: ReactNode;
  icon?: ReactNode;
  open?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details open={open} className={cn('group', className)}>
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-purple [&::-webkit-details-marker]:hidden">
        {icon ? (
          <span aria-hidden className="inline-flex [&>svg]:size-4">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
