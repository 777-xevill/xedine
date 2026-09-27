import { ChevronDown, ChefHat, MonitorSmartphone } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AppNav, type NavItem } from '@/components/app-nav';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { setBranchAction, signOutAction } from '@/modules/tenancy/actions';
import type { OrgContext } from '@/modules/tenancy/context';

const menu = 'glass-strong absolute start-0 z-40 mt-2 min-w-60 rounded-input p-1.5 shadow-2xl';
const menuItem =
  'block w-full rounded-[0.625rem] px-3 py-2 text-start text-sm hover:bg-surface-elevated';
const trigger =
  'glass-tile flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-full px-3.5 text-sm hover:border-edge-strong [&::-webkit-details-marker]:hidden';

/** Floating glass pill header. Org and branch switchers are <details> menus: no client JS needed. */
export async function AppHeader({ ctx }: { ctx: OrgContext }) {
  const [t, tMenu, tc] = await Promise.all([
    getTranslations('nav'),
    getTranslations('menu'),
    getTranslations('common'),
  ]);
  const selectedBranch = ctx.branches.find((b) => b.id === ctx.selectedBranchId);
  const base = `/${ctx.org.slug}`;
  const has = (role: OrgContext['roles'][number]) => ctx.roles.includes(role);
  const isManager = has('manager');
  const canTill = ctx.isOwner || isManager || has('cashier');
  const canKds = ctx.isOwner || isManager || has('kitchen');

  const items: NavItem[] = [
    { href: base, label: t('overview'), exact: true },
    ...(ctx.isOwner || isManager || has('accountant')
      ? [{ href: `${base}/sales`, label: t('sales') }]
      : []),
    ...(ctx.isOwner || has('accountant') ? [{ href: `${base}/leaks`, label: t('leaks') }] : []),
    ...(ctx.isOwner || isManager || has('accountant')
      ? [{ href: `${base}/assistant`, label: t('assistant') }]
      : []),
    ...(ctx.isOwner || has('accountant')
      ? [{ href: `${base}/menu-profit`, label: t('menuProfit') }]
      : []),
    ...(ctx.isOwner ? [{ href: `${base}/menu`, label: tMenu('title') }] : []),
    ...(ctx.isOwner || isManager || has('kitchen') || has('accountant')
      ? [{ href: `${base}/recipes`, label: t('recipes') }]
      : []),
    ...(ctx.isOwner || isManager || has('kitchen') || has('purchaser') || has('accountant')
      ? [{ href: `${base}/stock`, label: t('stock') }]
      : []),
    ...(ctx.isOwner || has('purchaser') || has('accountant')
      ? [{ href: `${base}/purchases`, label: t('purchases') }]
      : []),
    ...(ctx.isOwner || isManager
      ? [
          { href: `${base}/branch`, label: t('branchSetup') },
          { href: `${base}/staff`, label: t('staff') },
        ]
      : []),
    ...(ctx.isOwner
      ? [
          { href: `${base}/costs`, label: t('costs') },
          { href: `${base}/team`, label: t('team') },
          { href: `${base}/settings`, label: t('settings') },
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-30 px-3 pt-3">
      <div className="glass mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 rounded-card px-3 py-2 lg:rounded-full">
        <Link href={base} className="flex items-center gap-2 pe-1">
          <Image
            src="/brand/logo-64.png"
            alt=""
            width={30}
            height={30}
            className="rounded-full"
            priority
          />
          <span className="text-brand text-lg font-extrabold tracking-tight">{tc('appName')}</span>
        </Link>

        <details className="relative">
          <summary className={trigger}>
            <span className="text-secondary">{t('organization')}</span>
            <span className="font-semibold" data-testid="org-name">
              {ctx.org.name}
            </span>
            <ChevronDown aria-hidden className="size-3.5 text-secondary" />
          </summary>
          <div className={menu}>
            {ctx.allOrgs.map((o) => (
              <Link
                key={o.slug}
                href={`/${o.slug}`}
                className={cn(menuItem, o.slug === ctx.org.slug && 'font-semibold')}
              >
                {o.name}
              </Link>
            ))}
          </div>
        </details>

        <details className="relative">
          <summary className={trigger}>
            <span className="text-secondary">{t('branch')}</span>
            <span className="font-semibold" data-testid="branch-name">
              {selectedBranch?.name ?? t('allBranches')}
            </span>
            <ChevronDown aria-hidden className="size-3.5 text-secondary" />
          </summary>
          <div className={menu}>
            {ctx.branches.length > 1 ? (
              <form action={setBranchAction}>
                <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                <button type="submit" name="branchId" value="all" className={menuItem}>
                  {t('allBranches')}
                </button>
              </form>
            ) : null}
            {ctx.branches.map((b) => (
              <form key={b.id} action={setBranchAction}>
                <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                <button
                  type="submit"
                  name="branchId"
                  value={b.id}
                  className={cn(menuItem, b.id === ctx.selectedBranchId && 'font-semibold')}
                >
                  {b.name}
                </button>
              </form>
            ))}
          </div>
        </details>

        <AppNav items={items} label={t('main')} />

        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          {canTill ? (
            <Link href="/pos" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
              <MonitorSmartphone aria-hidden className="size-4" />
              {t('openPos')}
            </Link>
          ) : null}
          {canKds ? (
            <Link href="/kds" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              <ChefHat aria-hidden className="size-4" />
              {t('openKds')}
            </Link>
          ) : null}
          <LocaleSwitcher />
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm">
              {tc('signOut')}
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
