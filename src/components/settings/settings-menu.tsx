'use client';

import {
  CreditCard,
  Gauge,
  IdCard,
  KeyRound,
  Search,
  Send,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Store,
  TicketPercent,
  ToggleRight,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { IconKey } from '@/modules/tenancy/navigation';

const ICONS: Partial<Record<IconKey, LucideIcon>> = {
  general: SlidersHorizontal,
  setup: Gauge,
  branchSetup: Store,
  features: ToggleRight,
  team: Users,
  staff: KeyRound,
  telegram: Send,
  costs: Wallet,
  discountCodes: TicketPercent,
  memberCard: IdCard,
  billing: CreditCard,
  assistantRules: Sparkles,
  social: Share2,
};

export interface SettingsMenuGroup {
  heading: string;
  links: { key: IconKey; href: string; label: string }[];
}

/**
 * The settings list on the left of the settings panel (like a desktop app's preferences): a search box,
 * then groups of links with icons. On a phone the same links scroll sideways above the page. Works
 * without JavaScript except the search, which only filters.
 */
export function SettingsMenu({
  groups,
  label,
  searchLabel,
  noMatch,
}: {
  groups: SettingsMenuGroup[];
  label: string;
  searchLabel: string;
  noMatch: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = groups
    .map((g) => ({
      ...g,
      links: g.links.filter((l) => !needle || l.label.toLowerCase().includes(needle)),
    }))
    .filter((g) => g.links.length > 0);
  // The page itself, not a child page that has its own entry (General is /settings, Telegram /settings/telegram).
  const all = groups.flatMap((g) => g.links);
  const activeHref =
    all
      .filter((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  const item = (l: SettingsMenuGroup['links'][number], compact: boolean) => {
    const Icon = ICONS[l.key] ?? SlidersHorizontal;
    const active = l.href === activeHref;
    return (
      <Link
        key={l.href}
        href={l.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 text-sm font-medium transition-colors duration-200',
          compact
            ? 'min-h-9 shrink-0 rounded-full border px-3.5 whitespace-nowrap'
            : 'min-h-9 rounded-[0.625rem] px-2.5',
          active
            ? compact
              ? 'border-brand-yellow/60 bg-surface-elevated text-foreground'
              : 'bg-surface-elevated text-foreground'
            : compact
              ? 'border-line text-secondary hover:text-foreground'
              : 'text-secondary hover:bg-surface hover:text-foreground',
        )}
      >
        <Icon
          aria-hidden
          className={cn('size-4 shrink-0', active ? 'text-brand-yellow' : 'text-muted')}
        />
        <span className="truncate">{l.label}</span>
      </Link>
    );
  };

  return (
    <>
      {/* Phone and tablet: one sideways row. */}
      <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 pb-1 lg:hidden">
        <div className="flex gap-2">{all.map((l) => item(l, true))}</div>
      </nav>

      {/* Desktop: search + grouped list. */}
      <nav aria-label={label} className="hidden lg:block">
        <label className="relative mb-3 block">
          <span className="sr-only">{searchLabel}</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              const first = shown[0]?.links[0];
              if (e.key === 'Enter' && first) router.push(first.href);
            }}
            placeholder={searchLabel}
            className="h-9 w-full rounded-[0.625rem] border border-line bg-surface pr-2.5 pl-8 text-sm text-foreground placeholder:text-muted focus:border-brand-yellow/60 focus:outline-none"
          />
        </label>
        {shown.length === 0 ? <p className="px-2.5 py-2 text-sm text-muted">{noMatch}</p> : null}
        {shown.map((g, i) => (
          <div key={g.heading} className={cn(i > 0 && 'mt-3 border-t border-line pt-3')}>
            <p className="px-2.5 pb-1 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
              {g.heading}
            </p>
            <ul className="space-y-0.5">
              {g.links.map((l) => (
                <li key={l.href}>{item(l, false)}</li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
