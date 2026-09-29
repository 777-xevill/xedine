'use client';

import {
  ChartColumn,
  ChartLine,
  ChartPie,
  ChefHat,
  CookingPot,
  CalendarDays,
  Droplet,
  House,
  IdCard,
  Megaphone,
  MessageSquare,
  MonitorSmartphone,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sprout,
  Star,
  Store,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { IconKey } from '@/modules/tenancy/navigation';

const ICONS: Partial<Record<IconKey, LucideIcon>> = {
  home: House,
  chat: MessageSquare,
  stock: Package,
  sales: ChartLine,
  leaks: Droplet,
  menu: UtensilsCrossed,
  recipes: ChefHat,
  menuProfit: ChartPie,
  purchases: ShoppingCart,
  plan: CalendarDays,
  customers: Users,
  campaigns: Megaphone,
  growth: Sprout,
  reviews: Star,
  branches: Store,
  benchmarks: ChartColumn,
  compliance: ShieldCheck,
  staffRecords: IdCard,
  pos: MonitorSmartphone,
  kds: CookingPot,
  settings: Settings,
};

export interface SidebarLink {
  key: IconKey;
  href: string;
  label: string;
  exact?: boolean;
  /** Other paths that should light this link up (Settings covers every settings page). */
  alsoActive?: string[];
}

export const sidebarItem =
  'flex min-h-9 items-center gap-2.5 rounded-[0.625rem] px-2.5 text-sm font-medium transition';

function isActive(pathname: string, link: SidebarLink): boolean {
  const match = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return match(link.href, link.exact) || (link.alsoActive ?? []).some((h) => match(h));
}

/** A list of sidebar links. Client-only for the active highlight; links work without JS. */
export function SidebarNav({
  links,
  label,
  heading,
}: {
  links: SidebarLink[];
  label: string;
  heading?: string;
}) {
  const pathname = usePathname();
  if (links.length === 0) return null;
  return (
    <nav aria-label={label}>
      {heading ? (
        <p className="px-2.5 pt-4 pb-1.5 text-xs font-medium text-muted">{heading}</p>
      ) : null}
      <ul className="space-y-0.5">
        {links.map((link) => {
          const Icon = ICONS[link.key] ?? Settings;
          const active = isActive(pathname, link);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  sidebarItem,
                  active
                    ? 'bg-surface text-foreground shadow-soft'
                    : 'text-secondary hover:bg-surface/70 hover:text-foreground',
                )}
              >
                <Icon
                  aria-hidden
                  className={cn('size-4 shrink-0', active ? 'text-purple' : 'text-muted')}
                />
                <span className="truncate">{link.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
