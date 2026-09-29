import { getTranslations } from 'next-intl/server';
import { PillNav } from '@/components/ui/pill-nav';
import type { OrgContext } from '@/modules/tenancy/context';
import { buildNavigation, type IconKey } from '@/modules/tenancy/navigation';

/**
 * Tabs across every settings page (ADR 0024): the setup screens that used to crowd the top nav now
 * live here, filtered by role exactly like the sidebar.
 */
export async function SettingsNav({ ctx, current }: { ctx: OrgContext; current: IconKey }) {
  const t = await getTranslations('nav');
  const links = buildNavigation({ slug: ctx.org.slug, roles: ctx.roles, enabled: [] }).settings;
  if (links.length < 2) return null;
  return (
    <PillNav
      label={t('settings')}
      className="mb-6"
      items={links.map((l) => ({ href: l.href, label: t(l.key), active: l.key === current }))}
    />
  );
}
