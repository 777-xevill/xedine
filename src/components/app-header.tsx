import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { setBranchAction, signOutAction } from '@/modules/tenancy/actions';
import type { OrgContext } from '@/modules/tenancy/context';

const menu =
  'absolute left-0 z-20 mt-2 min-w-56 rounded-card border border-line-strong bg-surface-elevated p-1 shadow-lg';
const menuItem = 'block w-full rounded-input px-3 py-2 text-start text-sm hover:bg-surface';

/** Org and branch switchers are <details> menus and plain forms: they work with no client JavaScript. */
export async function AppHeader({ ctx }: { ctx: OrgContext }) {
  const [t, tMenu] = await Promise.all([getTranslations('nav'), getTranslations('menu')]);
  const tc = await getTranslations('common');
  const selectedBranch = ctx.branches.find((b) => b.id === ctx.selectedBranchId);
  const base = `/${ctx.org.slug}`;

  return (
    <header className="border-b border-line bg-background-secondary">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <span className="bg-brand bg-clip-text text-xl font-bold tracking-tight text-transparent">
          {tc('appName')}
        </span>

        <details className="relative">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-input border border-line px-3 text-sm">
            <span className="text-secondary">{t('organization')}</span>
            <span className="font-medium" data-testid="org-name">
              {ctx.org.name}
            </span>
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
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-input border border-line px-3 text-sm">
            <span className="text-secondary">{t('branch')}</span>
            <span className="font-medium" data-testid="branch-name">
              {selectedBranch?.name ?? t('allBranches')}
            </span>
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

        <nav className="ms-auto flex items-center gap-1" aria-label="Main">
          <Link
            href={base}
            className="rounded-input px-3 py-2 text-sm text-secondary hover:text-foreground"
          >
            {t('overview')}
          </Link>
          {ctx.isOwner ? (
            <>
              <Link
                href={`${base}/menu`}
                className="rounded-input px-3 py-2 text-sm text-secondary hover:text-foreground"
              >
                {tMenu('title')}
              </Link>
              <Link
                href={`${base}/team`}
                className="rounded-input px-3 py-2 text-sm text-secondary hover:text-foreground"
              >
                {t('team')}
              </Link>
              <Link
                href={`${base}/settings`}
                className="rounded-input px-3 py-2 text-sm text-secondary hover:text-foreground"
              >
                {t('settings')}
              </Link>
            </>
          ) : null}
        </nav>

        <LocaleSwitcher />
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" size="sm">
            {tc('signOut')}
          </Button>
        </form>
      </div>
    </header>
  );
}
