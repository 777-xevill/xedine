import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FeatureToggle } from '@/components/feature-toggle';
import { SettingsNav } from '@/components/settings-nav';
import { Card, PageTitle } from '@/components/ui/form';
import { getOrgContext } from '@/modules/tenancy/context';
import { FEATURE_KEYS, FEATURE_LINKS } from '@/modules/tenancy/navigation';
import { getEnabledFeatures } from '@/modules/tenancy/shell';

/**
 * Settings → Features (ADR 0024): the sidebar shows only core sections until the owner switches an
 * extra module on here. Switching off only hides the links; nothing is deleted.
 */
export default async function FeaturesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();
  const [t, tn, enabled] = await Promise.all([
    getTranslations('features'),
    getTranslations('nav'),
    getEnabledFeatures(ctx.org.id),
  ]);

  return (
    <>
      <SettingsNav ctx={ctx} current="features" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <Card className="p-0">
        <ul className="divide-y divide-line">
          {FEATURE_KEYS.map((f) => (
            <li key={f} className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="font-medium">{t(`items.${f}.title`)}</p>
                <p className="mt-0.5 text-sm text-secondary">{t(`items.${f}.body`)}</p>
                <p className="mt-1.5 text-xs text-muted">
                  {t('adds', { list: FEATURE_LINKS[f].map((k) => tn(k)).join(', ') })}
                </p>
              </div>
              <FeatureToggle
                orgId={ctx.org.id}
                orgSlug={ctx.org.slug}
                feature={f}
                enabled={enabled.includes(f)}
                label={t(`items.${f}.title`)}
              />
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-4 text-sm text-secondary">{t('footnote')}</p>
    </>
  );
}
