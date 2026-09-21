import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SettingsForm } from '@/components/team-forms';
import { Card, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { getOrgContext } from '@/modules/tenancy/context';

export default async function SettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();

  const t = await getTranslations('settings');
  const supabase = await createClient();
  const { data: s } = await supabase
    .from('org_settings')
    .select(
      'price_includes_vat, vat_rate_bps, service_charge_bps, default_cutoff_minutes, week_start',
    )
    .eq('org_id', ctx.org.id)
    .single();
  if (!s) notFound();

  const hh = String(Math.floor(s.default_cutoff_minutes / 60)).padStart(2, '0');
  const mm = String(s.default_cutoff_minutes % 60).padStart(2, '0');

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <Card>
        <SettingsForm
          orgId={ctx.org.id}
          orgSlug={ctx.org.slug}
          settings={{
            priceIncludesVat: s.price_includes_vat,
            vatRatePct: String(s.vat_rate_bps / 100),
            serviceChargePct: String(s.service_charge_bps / 100),
            cutoff: `${hh}:${mm}`,
            weekStart: s.week_start,
          }}
        />
      </Card>
      <Card className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">{t('branchesTitle')}</h2>
        <ul className="divide-y divide-line">
          {ctx.branches.map((b) => (
            <li key={b.id} className="py-2">
              {b.name}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
