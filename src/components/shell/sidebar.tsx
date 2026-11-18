import { Check, ChevronsUpDown, SquarePen } from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { APP_COOKIE, isAppCookie } from '@/lib/android-app';
import { LEGAL_CONTACT } from '@/lib/contact';
import { createClient } from '@/lib/db/supabase-server';
import { now } from '@/lib/time/clock';
import { cn } from '@/lib/utils';
import { setBranchAction } from '@/modules/tenancy/actions';
import type { OrgContext } from '@/modules/tenancy/context';
import { groupNavigation, type Navigation } from '@/modules/tenancy/navigation';
import { AccountMenu, SettingsButton } from './account-menu';
import { ChatHistory, type ChatSummary } from './chat-history';
import { SidebarNav, sidebarItem, type SidebarLink } from './sidebar-nav';

/** The plan's code for the account menu (owner/accountant; metric_billing refuses anyone else). */
async function currentPlan(orgId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('metric_billing', {
    p_org: orgId,
    p_now: now().toISOString(),
  });
  const code = ((data ?? []) as { plan_code?: string }[])[0]?.plan_code;
  return code === 'starter' || code === 'growth' || code === 'chain' ? code : null;
}

const menuItem =
  'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-start text-sm hover:bg-surface-hover';

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
  const canSeeBilling = ctx.roles.some((r) => r === 'owner' || r === 'accountant');
  const [t, tc, roles, tl, tb, locale, jar, planCode] = await Promise.all([
    getTranslations('nav'),
    getTranslations('common'),
    getTranslations('roles'),
    getTranslations('legal'),
    getTranslations('billing'),
    getLocale(),
    cookies(),
    canSeeBilling ? currentPlan(ctx.org.id) : Promise.resolve(null),
  ]);
  const inApp = isAppCookie(jar.get(APP_COOKIE)?.value);
  const base = `/${ctx.org.slug}`;
  const selectedBranch = ctx.branches.find((b) => b.id === ctx.selectedBranchId);
  const label = (links: Navigation['core']): SidebarLink[] =>
    links.map((l) => ({ ...l, label: t(l.key) }));
  // The first settings page this role may open (owners: General; managers: Staff).
  const settingsHref = nav.settings[0]?.href ?? null;
  const usageHref = nav.settings.find((s) => s.key === 'usage')?.href ?? null;
  const initialsOf = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => Array.from(w)[0]?.toUpperCase())
      .join('');
  const initials = initialsOf(ctx.fullName);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pt-3.5">
        <Link href={base} className="inline-flex rounded-lg px-1 py-0.5">
          <BrandMark name={tc('appName')} size="sm" />
        </Link>

        {/* Restaurant and branch in one compact switcher. <details>: no client JS needed. */}
        <details className="group relative mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-2xl border border-edge bg-surface-elevated/80 bg-[image:var(--glass-sheen)] py-2 ps-2 pe-3 shadow-soft hover:border-edge-strong hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden
              className="initials-tile inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-[0.8125rem] font-bold"
            >
              {initialsOf(ctx.org.name) || '·'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold" data-testid="org-name">
                {ctx.org.name}
              </span>
              <span className="block truncate text-xs text-secondary" data-testid="branch-name">
                {selectedBranch?.name ?? t('allBranches')}
              </span>
            </span>
            <ChevronsUpDown
              aria-hidden
              className="size-4 shrink-0 text-muted transition-[rotate] duration-300 group-open:rotate-180"
            />
          </summary>
          <div className="glass-strong absolute inset-x-0 z-50 mt-1.5 max-h-80 overflow-y-auto rounded-xl p-1.5">
            <p className="px-2.5 pt-1 pb-1 text-xs font-medium text-muted">{t('organization')}</p>
            {ctx.allOrgs.map((o) => (
              <Link key={o.slug} href={`/${o.slug}`} className={menuItem}>
                <span className="truncate">{o.name}</span>
                {o.slug === ctx.org.slug ? (
                  <Check aria-hidden className="size-4 text-purple" />
                ) : null}
              </Link>
            ))}
            <p className="mt-1 border-t border-edge px-2.5 pt-2 pb-1 text-xs font-medium text-muted">
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
            className="btn-shine relative mt-3 flex min-h-10 items-center gap-2.5 overflow-hidden rounded-xl bg-action px-3 text-sm font-semibold text-on-action glow-action transition duration-300 hover:-translate-y-px hover:brightness-[1.06] active:scale-[0.97]"
          >
            <SquarePen aria-hidden className="size-4" />
            {t('newChat')}
          </Link>
        ) : null}
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {groupNavigation([...nav.core, ...nav.more]).map((g) => (
          <SidebarNav
            key={g.section}
            links={label(g.links)}
            label={g.section === 'top' ? t('main') : t(`section.${g.section}`)}
            heading={g.section === 'top' ? undefined : t(`section.${g.section}`)}
          />
        ))}
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

      <div className="space-y-1.5 border-t border-edge px-3 pt-2.5 pb-3">
        {settingsHref ? (
          <SettingsButton
            href={settingsHref}
            label={t('settings')}
            shortcut={t('settingsShortcut')}
            alsoActive={nav.settings.map((s) => s.href)}
          />
        ) : null}
        <AccountMenu
          email={ctx.user.email}
          name={ctx.fullName}
          initials={initials}
          role={ctx.roles.map((r) => roles(r)).join(' · ')}
          branches={
            ctx.branches.length > 0 && ctx.isOwner
              ? t('everyBranch')
              : ctx.branches.map((b) => b.name).join(' · ')
          }
          plan={planCode ? t('planLine', { plan: tb(`plans.${planCode}`) }) : null}
          locale={locale === 'bn' ? 'bn' : 'en'}
          settingsHref={settingsHref}
          usageHref={usageHref}
          upgradeHref={canSeeBilling && !inApp ? `${base}/billing` : null}
          helpHref={`mailto:${LEGAL_CONTACT}`}
          labels={{
            menu: t('accountMenu'),
            settings: t('settings'),
            shortcut: t('settingsShortcut'),
            usage: t('usage'),
            language: tc('language'),
            bangla: tc('bangla'),
            english: tc('english'),
            getHelp: t('getHelp'),
            learnMore: t('learnMore'),
            privacy: tl('privacyLink'),
            terms: tl('termsLink'),
            deleteAccount: tl('deleteAccountLink'),
            upgradePlan: t('upgradePlan'),
            signOut: tc('signOut'),
          }}
        />
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
      <p className="px-2.5 pt-5 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
        {label}
      </p>
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
