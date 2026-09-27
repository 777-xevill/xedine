import { Download } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardTitle,
  EmptyState,
  Hint,
  Input,
  Label,
  PageTitle,
  Select,
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, formatNumber, type Locale } from '@/lib/i18n/format';
import { addDays } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import {
  addLicenceAction,
  deleteLicenceAction,
  renewLicenceAction,
  setVatDueDayAction,
} from '@/modules/compliance/actions';
import { businessToday } from '@/modules/metrics/queries';
import { getOrgContext } from '@/modules/tenancy/context';

const TONE = {
  expired: 'danger',
  urgent: 'danger',
  due: 'warning',
  upcoming: 'info',
  ok: 'success',
} as const;
// Suggestions only — the owner types whatever their licences are called. TODO(verify) the list with an accountant.
const KIND_SUGGESTIONS = ['trade', 'fire', 'bfsa', 'environment', 'vat_registration'] as const;

/**
 * Compliance (ROADMAP Phase 10): licences with expiry reminders, the VAT return's due day, and the monthly
 * sales-VAT working summary (download for the accountant). Nothing here is legal advice; the due day and
 * licence names are the owner's configuration.
 */
export default async function CompliancePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  const has = (r: string) => ctx.roles.includes(r as never);
  if (!['owner', 'manager', 'accountant'].some(has)) notFound();
  const money = has('owner') || has('accountant');
  const [t, locale] = await Promise.all([getTranslations('compliance'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const { date: today } = await businessToday(ctx.org.id);
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastTo = addDays(monthStart, -1);
  const lastFrom = `${lastTo.slice(0, 7)}-01`;
  const [{ data: items }, { data: settings }, vat] = await Promise.all([
    supabase.rpc('metric_compliance', { p_org: ctx.org.id, p_now: now().toISOString() }),
    supabase
      .from('org_settings')
      .select('vat_return_due_day')
      .eq('org_id', ctx.org.id)
      .maybeSingle(),
    money
      ? supabase.rpc('metric_vat_summary', {
          p_org: ctx.org.id,
          p_branch: null,
          p_from: lastFrom,
          p_to: lastTo,
        })
      : Promise.resolve({ data: null }),
  ]);
  const rows = (items ?? []) as {
    kind: string;
    ref_id: string | null;
    label: string;
    branch_id: string | null;
    number: string | null;
    due_on: string;
    days_left: number;
    status: keyof typeof TONE;
  }[];
  const vatRows = (vat.data ?? []) as Record<string, unknown>[];
  const sum = (k: string) => vatRows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const bdt = (v: number) => formatBDT(v, loc, { poisha: 'never' });
  const branchName = (id: string | null) =>
    id ? (ctx.branches.find((b) => b.id === id)?.name ?? '') : t('wholeRestaurant');
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );
  const dueText = (r: (typeof rows)[number]) =>
    r.days_left < 0
      ? t('expiredAgo', { days: formatNumber(-r.days_left, loc) })
      : t('daysLeft', { days: formatNumber(r.days_left, loc) });

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="p-4 sm:p-6">
          <CardTitle>{t('listTitle')}</CardTitle>
          {rows.length === 0 ? (
            <EmptyState title={t('none')} />
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.ref_id ?? r.kind} className="glass-tile rounded-input p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {r.kind === 'vat_return' ? t('vatReturn', { month: r.label }) : r.label}
                      </p>
                      <p className="text-xs text-secondary">
                        {r.kind === 'vat_return' ? t('vatHint') : branchName(r.branch_id)}
                        {r.number ? ` · ${r.number}` : ''} · {r.due_on}
                      </p>
                    </div>
                    <StatusBadge tone={TONE[r.status]}>{dueText(r)}</StatusBadge>
                  </div>
                  {ctx.isOwner && r.kind === 'licence' && r.ref_id ? (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <ActionForm
                        action={renewLicenceAction}
                        successKey="common.saved"
                        className="flex items-end gap-2"
                      >
                        {hidden}
                        <input type="hidden" name="licenceId" value={r.ref_id} />
                        <div>
                          <Label htmlFor={`renew-${r.ref_id}`}>{t('newExpiry')}</Label>
                          <Input id={`renew-${r.ref_id}`} name="expiresOn" type="date" required />
                        </div>
                        <Button type="submit" size="sm" variant="secondary">
                          {t('renew')}
                        </Button>
                      </ActionForm>
                      <form action={deleteLicenceAction}>
                        {hidden}
                        <input type="hidden" name="licenceId" value={r.ref_id} />
                        <Button type="submit" size="sm" variant="ghost">
                          {t('remove')}
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Hint className="mt-3">{t('remindersHint')}</Hint>
        </Card>

        <div className="space-y-6">
          {ctx.isOwner ? (
            <Card>
              <CardTitle>{t('addTitle')}</CardTitle>
              <ActionForm action={addLicenceAction} successKey="common.saved" className="space-y-3">
                {hidden}
                <div>
                  <Label htmlFor="lc-kind">{t('kind')}</Label>
                  <Input id="lc-kind" name="kind" list="lc-kinds" required maxLength={120} />
                  <datalist id="lc-kinds">
                    {KIND_SUGGESTIONS.map((k) => (
                      <option key={k} value={t(`kinds.${k}`)} />
                    ))}
                  </datalist>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="lc-branch">{t('branch')}</Label>
                    <Select id="lc-branch" name="branchId" defaultValue="">
                      <option value="">{t('wholeRestaurant')}</option>
                      {ctx.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="lc-number">{t('number')}</Label>
                    <Input id="lc-number" name="number" maxLength={80} />
                  </div>
                  <div>
                    <Label htmlFor="lc-issued">{t('issuedOn')}</Label>
                    <Input id="lc-issued" name="issuedOn" type="date" />
                  </div>
                  <div>
                    <Label htmlFor="lc-expires">{t('expiresOn')}</Label>
                    <Input id="lc-expires" name="expiresOn" type="date" required />
                  </div>
                </div>
                <Button type="submit">{t('add')}</Button>
              </ActionForm>
            </Card>
          ) : null}
          {money ? (
            <Card>
              <CardTitle>{t('vatTitle', { month: lastFrom.slice(0, 7) })}</CardTitle>
              <dl className="grid grid-cols-2 gap-2 text-sm tabular-nums">
                <dt className="text-secondary">{t('net')}</dt>
                <dd className="text-end">{bdt(sum('net_poisha'))}</dd>
                <dt className="text-secondary">{t('vat')}</dt>
                <dd className="text-end">{bdt(sum('vat_poisha'))}</dd>
                <dt className="text-secondary">{t('serviceCharge')}</dt>
                <dd className="text-end">{bdt(sum('service_charge_poisha'))}</dd>
                <dt className="text-secondary">{t('total')}</dt>
                <dd className="text-end font-semibold">{bdt(sum('total_poisha'))}</dd>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  className="inline-flex items-center gap-2 text-sm font-semibold text-info underline-offset-4 hover:underline"
                  href={`/api/export/vat?org=${ctx.org.id}&from=${lastFrom}&to=${lastTo}`}
                >
                  <Download aria-hidden className="size-4" />
                  {t('downloadVat')}
                </a>
                <a
                  className="inline-flex items-center gap-2 text-sm font-semibold text-info underline-offset-4 hover:underline"
                  href={`/api/export/orders?org=${ctx.org.id}&from=${lastFrom}&to=${lastTo}`}
                >
                  <Download aria-hidden className="size-4" />
                  {t('downloadOrders')}
                </a>
              </div>
              <Hint className="mt-3">{t('vatDisclaimer')}</Hint>
            </Card>
          ) : null}
          {ctx.isOwner ? (
            <Card>
              <CardTitle>{t('dueDayTitle')}</CardTitle>
              <ActionForm
                action={setVatDueDayAction}
                successKey="common.saved"
                className="flex items-end gap-2"
              >
                {hidden}
                <div>
                  <Label htmlFor="vat-day">{t('dueDay')}</Label>
                  <Input
                    id="vat-day"
                    name="day"
                    type="number"
                    min={1}
                    max={28}
                    defaultValue={Number(settings?.vat_return_due_day ?? 15)}
                    required
                  />
                </div>
                <Button type="submit" variant="secondary">
                  {t('save')}
                </Button>
              </ActionForm>
              <Hint className="mt-2">{t('dueDayHint')}</Hint>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
