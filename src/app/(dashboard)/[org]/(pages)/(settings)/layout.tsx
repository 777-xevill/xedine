import { X } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SettingsMenu } from '@/components/settings/settings-menu';
import { getOrgContext } from '@/modules/tenancy/context';
import { buildNavigation, groupSettings } from '@/modules/tenancy/navigation';

/**
 * Every settings page sits in one panel, like a desktop app's preferences window: a title bar with a
 * close button, the settings list on the left (search, groups, icons) and the chosen page on the right.
 * The URLs are unchanged; `(settings)` is only a route group. The list is filtered by role exactly like
 * the sidebar, and each page still decides access for itself.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  const t = await getTranslations('nav');
  const links = buildNavigation({ slug: ctx.org.slug, roles: ctx.roles, enabled: [] }).settings;
  const groups = groupSettings(links).map((g) => ({
    heading: t(`settingsGroups.${g.group}`),
    links: g.links.map((l) => ({ key: l.key, href: l.href, label: t(l.key) })),
  }));

  return (
    // On a computer the panel is a window of fixed height: the title bar and the list stay still and only
    // the page on the right scrolls (main's lg:py-10 leaves 5rem). On a phone the page scrolls as usual.
    <section
      aria-labelledby="settings-panel-title"
      className="glass-tile overflow-hidden rounded-card border border-edge lg:flex lg:h-[calc(100dvh-5rem)] lg:min-h-[32rem] lg:flex-col"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <h2 id="settings-panel-title" className="text-base font-semibold">
          {t('settings')}
        </h2>
        <Link
          href={`/${ctx.org.slug}`}
          aria-label={t('closeSettings')}
          className="inline-flex size-9 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-elevated hover:text-foreground active:scale-95"
        >
          <X aria-hidden className="size-5" />
        </Link>
      </header>
      <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <aside className="border-b border-line px-4 py-3 lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-b-0 lg:p-4">
          <SettingsMenu
            groups={groups}
            label={t('settings')}
            searchLabel={t('settingsSearch')}
            noMatch={t('settingsNoMatch')}
          />
        </aside>
        <div
          id="settings-scroll"
          className="min-w-0 px-4 py-5 sm:px-6 lg:overflow-y-auto lg:overscroll-contain lg:px-8 lg:py-7"
        >
          {children}
        </div>
      </div>
    </section>
  );
}
