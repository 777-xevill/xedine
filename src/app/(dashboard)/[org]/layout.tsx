import { SquarePen } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BrandMark } from '@/components/brand-mark';
import { GlobalAgent } from '@/components/chat/global-agent';
import { AppShell } from '@/components/shell/app-shell';
import { Sidebar } from '@/components/shell/sidebar';
import { aiConfigured } from '@/lib/llm-gateway';
import { getOrgContext } from '@/modules/tenancy/context';
import { buildNavigation } from '@/modules/tenancy/navigation';
import { getEnabledFeatures, recentChats } from '@/modules/tenancy/shell';

/** Signed-in app frame (ADR 0024): sidebar + one workspace. Pages render inside the workspace. */
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  const [t, tc, enabled] = await Promise.all([
    getTranslations('nav'),
    getTranslations('common'),
    getEnabledFeatures(ctx.org.id),
  ]);
  const nav = buildNavigation({ slug: ctx.org.slug, roles: ctx.roles, enabled });
  const chats = nav.canChat ? await recentChats(ctx.org.id, ctx.user.id) : [];

  return (
    <AppShell
      openLabel={t('openMenu')}
      closeLabel={t('closeMenu')}
      sidebar={<Sidebar ctx={ctx} nav={nav} chats={chats} />}
      mobileBar={
        <>
          <Link href={`/${ctx.org.slug}`} className="min-w-0 flex-1">
            <BrandMark name={tc('appName')} size="sm" />
          </Link>
          {nav.canChat ? (
            <Link
              href={`/${ctx.org.slug}/assistant`}
              aria-label={t('newChat')}
              className="inline-flex size-10 items-center justify-center rounded-full text-foreground hover:bg-surface-elevated"
            >
              <SquarePen aria-hidden className="size-5" />
            </Link>
          ) : null}
        </>
      }
    >
      {children}
      {nav.canChat ? (
        <GlobalAgent
          orgId={ctx.org.id}
          orgSlug={ctx.org.slug}
          aiOn={aiConfigured()}
          canSeeMoney={ctx.roles.some((r) => r === 'owner' || r === 'accountant')}
        />
      ) : null}
    </AppShell>
  );
}
