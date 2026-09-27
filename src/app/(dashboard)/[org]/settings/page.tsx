import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ChannelForm,
  CommissionForm,
  ReasonCodeForm,
  ReceiptSettingsForm,
} from '@/components/settings-forms';
import { SettingsForm } from '@/components/team-forms';
import { Button } from '@/components/ui/button';
import { ActionForm } from '@/components/action-form';
import { Card, CardTitle, EmptyState, Input, Label, PageTitle, Select } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/badge';
import { createClient } from '@/lib/db/supabase-server';
import { formatBps, type Locale } from '@/lib/i18n/format';
import {
  ensureDefaultsAction,
  setOwnerWhatsappAction,
  toggleChannelActiveAction,
  toggleReasonActiveAction,
} from '@/modules/settings/actions';
import { getOrgContext } from '@/modules/tenancy/context';

export default async function SettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();

  const [t, tc, locale] = await Promise.all([
    getTranslations('settings'),
    getTranslations('common'),
    getLocale(),
  ]);
  const supabase = await createClient();
  const [
    { data: s },
    { data: receipt },
    { data: channels },
    { data: commissions },
    { data: reasons },
    { data: profile },
  ] = await Promise.all([
    supabase
      .from('org_settings')
      .select(
        'price_includes_vat, vat_rate_bps, service_charge_bps, default_cutoff_minutes, week_start',
      )
      .eq('org_id', ctx.org.id)
      .single(),
    supabase
      .from('org_receipt_settings')
      .select('legal_name, bin, address, phone, footer')
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
    supabase
      .from('channels')
      .select('id, name, kind, is_active')
      .eq('org_id', ctx.org.id)
      .order('name'),
    supabase
      .from('channel_commissions')
      .select('channel_id, commission_bps, fixed_fee_poisha, packaging_poisha, effective_from')
      .eq('org_id', ctx.org.id)
      .order('effective_from', { ascending: false }),
    supabase
      .from('reason_codes')
      .select('id, kind, label, is_active, requires_manager_approval')
      .eq('org_id', ctx.org.id)
      .order('kind')
      .order('label'),
    supabase
      .from('org_profile')
      .select('owner_whatsapp, brief_language, owner_whatsapp_opt_in_at')
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
  ]);
  if (!s) notFound();

  const hh = String(Math.floor(s.default_cutoff_minutes / 60)).padStart(2, '0');
  const mm = String(s.default_cutoff_minutes % 60).padStart(2, '0');
  interface CommissionRow {
    channel_id: string;
    commission_bps: number;
    fixed_fee_poisha: number;
    packaging_poisha: number;
  }
  const latestCommission = new Map<string, CommissionRow>();
  for (const c of commissions ?? []) {
    if (!latestCommission.has(c.channel_id)) latestCommission.set(c.channel_id, c);
  }
  const money = (p: number) => (p / 100).toFixed(2);

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
        <CardTitle>{t('receiptTitle')}</CardTitle>
        <p className="-mt-2 mb-4 text-sm text-secondary">{t('receiptSubtitle')}</p>
        <ReceiptSettingsForm
          orgId={ctx.org.id}
          orgSlug={ctx.org.slug}
          settings={{
            legalName: receipt?.legal_name ?? '',
            bin: receipt?.bin ?? '',
            address: receipt?.address ?? '',
            phone: receipt?.phone ?? '',
            footer: receipt?.footer ?? '',
          }}
        />
      </Card>

      <Card className="mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="mb-0">{t('channelsTitle')}</CardTitle>
          <form action={ensureDefaultsAction}>
            <input type="hidden" name="orgId" value={ctx.org.id} />
            <input type="hidden" name="orgSlug" value={ctx.org.slug} />
            <Button type="submit" variant="secondary" size="sm">
              {t('addDefaults')}
            </Button>
          </form>
        </div>
        <ChannelForm orgId={ctx.org.id} orgSlug={ctx.org.slug} />
        {(channels ?? []).length === 0 ? (
          <EmptyState className="mt-4" title={t('noChannels')} />
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {(channels ?? []).map((c) => {
              const commission = latestCommission.get(c.id);
              return (
                <li key={c.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-sm text-secondary">
                        {t(`channelKindOptions.${c.kind}`)}
                        {commission
                          ? ` · ${formatBps(commission.commission_bps, locale as Locale)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.is_active ? (
                        <StatusBadge tone="success">{t('active')}</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">{t('inactive')}</StatusBadge>
                      )}
                      <CommissionForm
                        orgId={ctx.org.id}
                        orgSlug={ctx.org.slug}
                        channelId={c.id}
                        current={
                          commission
                            ? {
                                commissionPct: (commission.commission_bps / 100).toString(),
                                fixedFee: money(commission.fixed_fee_poisha),
                                packaging: money(commission.packaging_poisha),
                              }
                            : null
                        }
                      />
                      <form action={toggleChannelActiveAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                        <input type="hidden" name="active" value={String(c.is_active)} />
                        <Button type="submit" variant="ghost" size="sm">
                          {c.is_active ? t('deactivate') : t('activate')}
                        </Button>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardTitle>{t('reasonsTitle')}</CardTitle>
        <ReasonCodeForm orgId={ctx.org.id} orgSlug={ctx.org.slug} />
        {(reasons ?? []).length === 0 ? (
          <EmptyState className="mt-4" title={t('noReasons')} />
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {(reasons ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <p>
                  <span className="text-sm text-secondary">{t(`reasonKindOptions.${r.kind}`)}</span>{' '}
                  <span className="font-medium">{r.label}</span>
                  {r.requires_manager_approval ? (
                    <StatusBadge tone="warning" className="ms-2">
                      {t('requiresApproval')}
                    </StatusBadge>
                  ) : null}
                </p>
                <form action={toggleReasonActiveAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                  <input type="hidden" name="active" value={String(r.is_active)} />
                  <Button type="submit" variant="ghost" size="sm">
                    {r.is_active ? t('deactivate') : t('activate')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardTitle>{t('whatsappTitle')}</CardTitle>
        <p className="-mt-2 mb-4 max-w-2xl text-sm text-secondary">{t('whatsappBody')}</p>
        <ActionForm
          action={setOwnerWhatsappAction}
          successKey="common.saved"
          className="grid gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="orgId" value={ctx.org.id} />
          <input type="hidden" name="orgSlug" value={ctx.org.slug} />
          <div>
            <Label htmlFor="wa-phone">{t('whatsappNumber')}</Label>
            <Input
              id="wa-phone"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              defaultValue={profile?.owner_whatsapp ?? ''}
            />
          </div>
          <div>
            <Label htmlFor="wa-lang">{t('briefLanguage')}</Label>
            <Select id="wa-lang" name="language" defaultValue={profile?.brief_language ?? 'bn'}>
              <option value="bn">{tc('bangla')}</option>
              <option value="en">{tc('english')}</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              name="consent"
              defaultChecked={Boolean(profile?.owner_whatsapp_opt_in_at)}
              className="size-4 accent-blue"
            />
            {t('whatsappConsent')}
          </label>
          <div className="sm:col-span-2">
            <Button type="submit">{t('save')}</Button>
          </div>
        </ActionForm>
      </Card>

      <Card className="mt-6">
        <CardTitle>{t('branchesTitle')}</CardTitle>
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
