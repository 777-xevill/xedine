import { Check, ChevronsUpDown, LogOut, SquarePen } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { cn } from '@/lib/utils';
import { setBranchAction, signOutAction } from '@/modules/tenancy/actions';
import type { OrgContext } from '@/modules/tenancy/context';
import type { Navigation } from '@/modules/tenancy/navigation';
import { ChatHistory, type ChatSummary } from './chat-history';
import { SidebarNav, sidebarItem, type SidebarLink } from './sidebar-nav';

const menuItem =
  'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-start text-sm hover:bg-surface-elevated';

/** The sidebar's contents (ADR 0024): workspace, new chat, core sections, chats, account. */
export async function Sidebar({
  ctx,
  nav,
  chats,
}: {
  ctx: OrgContext;
  nav: Navigation;
  chats: ChatSummary[];
}) {
  const [t, tc, roles] = await Promise.all([
    getTranslations('nav'),
    getTranslations('common'),
    getTranslations('roles'),
  ]);
  const base = `/${ctx.org.slug}`;
  const selectedBranch = ctx.branches.find((b) => b.id === ctx.selectedBranchId);
  const label = (links: Navigation['core']): SidebarLink[] =>
    links.map((l) => ({ ...l, label: t(l.key) }));
  const settingsLink: SidebarLink[] =
    nav.settings.length > 0
      ? [
          {
            key: 'settings',
            // The first settings page this role may open (owners: General; managers: Staff).
            href: nav.settings[0]!.href,
            label: t('settings'),
            alsoActive: nav.settings.map((s) => s.href),
          },
        ]
      : [];
  const initials = ctx.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pt-3.5">
        <Link href={base} className="inline-flex rounded-lg px-1 py-0.5">
          <BrandMark name={tc('appName')} size="sm" />
        </Link>

        {/* Restaurant and branch in one compact switcher. <details>: no client JS needed. */}
        <details className="group relative mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-soft hover:border-line-strong [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold" data-testid="org-name">
                {ctx.org.name}
              </span>
              <span className="block truncate text-xs text-secondary" data-testid="branch-name">
                {selectedBranch?.name ?? t('allBranches')}
              </span>
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted" />
          </summary>
          <div className="absolute inset-x-0 z-50 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lift">
            <p className="px-2.5 pt-1 pb-1 text-xs font-medium text-muted">{t('organization')}</p>
            {ctx.allOrgs.map((o) => (
              <Link key={o.slug} href={`/${o.slug}`} className={menuItem}>
                <span className="truncate">{o.name}</span>
                {o.slug === ctx.org.slug ? (
                  <Check aria-hidden className="size-4 text-purple" />
                ) : null}
              </Link>
            ))}
            <p className="mt-1 border-t border-line px-2.5 pt-2 pb-1 text-xs font-medium text-muted">
              {t('branch')}
            </p>
            {ctx.branches.length > 1 ? (
              <form action={setBranchAction}>
                <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                <button type="submit" name="branchId" value="all" className={menuItem}>
                  {t('allBranches')}
                  {ctx.selectedBranchId === null ? (
                    <Check aria-hidden className="size-4 text-purple" />
                  ) : null}
                </button>
              </form>
            ) : null}
            {ctx.branches.map((b) => (
              <form key={b.id} action={setBranchAction}>
                <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                <button type="submit" name="branchId" value={b.id} className={menuItem}>
                  <span className="truncate">{b.name}</span>
                  {b.id === ctx.selectedBranchId ? (
                    <Check aria-hidden className="size-4 text-purple" />
                  ) : null}
                </button>
              </form>
            ))}
          </div>
        </details>

        {nav.canChat ? (
          <Link
            href={`${base}/assistant`}
            className="mt-3 flex min-h-10 items-center gap-2.5 rounded-xl bg-action px-3 text-sm font-semibold text-on-action glow-action transition hover:brightness-110"
          >
            <SquarePen aria-hidden className="size-4" />
            {t('newChat')}
          </Link>
        ) : null}
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <SidebarNav links={label(nav.core)} label={t('main')} />
        <SidebarNav links={label(nav.more)} label={t('more')} heading={t('more')} />
        <SidebarNav links={label(nav.apps)} label={t('apps')} heading={t('apps')} />
        {nav.canChat ? (
          <Suspense
            fallback={
              <ChatHistoryStatic
                chats={chats}
                base={base}
                label={t('recentChats')}
                empty={t('noChats')}
              />
            }
          >
            <ChatHistory
              chats={chats}
              assistantHref={`${base}/assistant`}
              label={t('recentChats')}
              empty={t('noChats')}
            />
          </Suspense>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-line px-3 pt-2.5 pb-3">
        <SidebarNav links={settingsLink} label={t('settings')} />
        <div className="flex items-center gap-2.5 px-1">
          <span
            aria-hidden
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-xs font-bold text-on-action"
          >
            {initials || '·'}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-semibold">{ctx.fullName}</span>
            <span className="block truncate text-xs text-secondary">
              <span data-testid="role">{ctx.roles.map((r) => roles(r)).join(' · ')}</span>
              {' · '}
              <span data-testid="branches">
                {ctx.branches.length > 0 && ctx.isOwner
                  ? t('everyBranch')
                  : ctx.branches.map((b) => b.name).join(' · ')}
              </span>
            </span>
          </span>
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label={tc('signOut')}
              title={tc('signOut')}
              className="inline-flex size-8 items-center justify-center rounded-full text-secondary hover:bg-surface hover:text-foreground"
            >
              <LogOut aria-hidden className="size-4" />
            </button>
          </form>
        </div>
        <LocaleSwitcher className="w-full [&>form]:flex-1 [&_button]:w-full" />
      </div>
    </div>
  );
}

/** Server-rendered history for the Suspense fallback (no active highlight until the client loads). */
function ChatHistoryStatic({
  chats,
  base,
  label,
  empty,
}: {
  chats: ChatSummary[];
  base: string;
  label: string;
  empty: string;
}) {
  return (
    <nav aria-label={label}>
      <p className="px-2.5 pt-4 pb-1.5 text-xs font-medium text-muted">{label}</p>
      {chats.length === 0 ? (
        <p className="px-2.5 py-1 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {chats.map((c) => (
            <li key={c.id}>
              <Link
                href={`${base}/assistant?c=${c.id}`}
                className={cn(sidebarItem, 'block truncate py-1.5 leading-6 text-secondary')}
              >
                {c.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
