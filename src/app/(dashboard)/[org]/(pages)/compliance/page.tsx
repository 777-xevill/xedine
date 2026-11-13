import { CircleAlert, CircleCheck, Download } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { DeleteLicenceButton } from '@/components/delete-licence-button';
import { Banner } from '@/components/stock/parts';
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
 * Compliance (ROADMAP Phase 10), made simple: one line saying whether anything needs attention, then each
 * paper with how long is left, then last month's sales and VAT to hand to the accountant. Nothing here is
 * legal advice; the VAT due day and licence names are the owner's own settings.
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
    supabase.rpc('metric_compliance', {
      p_org: ctx.org.id,
      p_branch: ctx.selectedBranchId,
      p_now: now().toISOString(),
    }),
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
  const showBranch = ctx.branches.length > 1;
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
      ? t('expiredAgo', { count: -r.days_left, n: formatNumber(-r.days_left, loc) })
      : t('daysLeft', { count: r.days_left, n: formatNumber(r.days_left, loc) });
  // Needs attention = expired, or running out within a month.
  const attention = rows.filter((r) => ['expired', 'urgent', 'due'].includes(r.status));

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="mx-auto max-w-2xl space-y-5">
        {attention.length > 0 ? (
          <Banner
            tone={attention.some((r) => r.status !== 'due') ? 'danger' : 'warning'}
            icon={<CircleAlert />}
            title={t('attention', {
              count: attention.length,
              n: formatNumber(attention.length, loc),
            })}
          />
        ) : rows.length > 0 ? (
          <Banner tone="success" icon={<CircleCheck />} title={t('allGood')} />
        ) : null}

        <Card className="p-4 sm:p-5">
          <CardTitle>{t('listTitle')}</CardTitle>
          {rows.length === 0 ? (
            <EmptyState title={t('none')} body={t('noneBody')} />
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.ref_id ?? r.kind} className="glass-tile rounded-input p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {r.kind === 'vat_return' ? t('vatReturn', { month: r.label }) : r.label}
                      </p>
                      <p className="text-xs text-secondary">
                        {r.kind === 'vat_return'
                          ? t('vatHint')
                          : showBranch
                            ? branchName(r.branch_id)
                            : ''}
                        {r.number ? ` · ${r.number}` : ''} · {r.due_on}
                      </p>
                    </div>
                    <StatusBadge tone={TONE[r.status]}>{dueText(r)}</StatusBadge>
                  </div>
                  {ctx.isOwner && r.kind === 'licence' && r.ref_id ? (
                    <div className="mt-2 flex flex-wrap items-start gap-2">
                      <details className="min-w-0 flex-1">
                        <summary className="cursor-pointer text-sm font-medium text-purple">
                          {t('renew')}
                        </summary>
                        <ActionForm
                          action={renewLicenceAction}
                          successKey="common.saved"
                          className="mt-2 flex items-end gap-2"
                        >
                          {hidden}
                          <input type="hidden" name="licenceId" value={r.ref_id} />
                          <div>
                            <Label htmlFor={`renew-${r.ref_id}`}>{t('newExpiry')}</Label>
                            <Input id={`renew-${r.ref_id}`} name="expiresOn" type="date" required />
                          </div>
                          <Button type="submit" size="sm" variant="secondary">
                            {t('save')}
                          </Button>
                        </ActionForm>
                      </details>
                      <DeleteLicenceButton
                        orgId={ctx.org.id}
                        orgSlug={ctx.org.slug}
                        licenceId={r.ref_id}
                        name={r.label}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Hint className="mt-3">{t('remindersHint')}</Hint>
        </Card>

        {ctx.isOwner ? (
          <details className="glass-tile rounded-card p-4 sm:p-5">
            <summary className="cursor-pointer font-semibold">{t('addTitle')}</summary>
            <ActionForm
              action={addLicenceAction}
              successKey="common.saved"
              className="mt-3 space-y-3"
            >
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
              <div>
                <Label htmlFor="lc-expires">{t('expiresOn')}</Label>
                <Input id="lc-expires" name="expiresOn" type="date" required />
              </div>
              <details>
                <summary className="cursor-pointer text-sm text-secondary">
                  {t('moreDetails')}
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {showBranch ? (
                    <div className="col-span-2">
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
                  ) : (
                    <input type="hidden" name="branchId" value="" />
                  )}
                  <div>
                    <Label htmlFor="lc-number">{t('number')}</Label>
                    <Input id="lc-number" name="number" maxLength={80} />
                  </div>
                  <div>
                    <Label htmlFor="lc-issued">{t('issuedOn')}</Label>
                    <Input id="lc-issued" name="issuedOn" type="date" />
                  </div>
                </div>
              </details>
              <Button type="submit">{t('add')}</Button>
            </ActionForm>
          </details>
        ) : null}

        {money ? (
          <Card className="p-4 sm:p-5">
            <CardTitle>{t('vatTitle', { month: lastFrom.slice(0, 7) })}</CardTitle>
            <dl className="grid grid-cols-2 gap-2 text-sm tabular-nums">
              <dt className="text-secondary">{t('total')}</dt>
              <dd className="text-end font-semibold">{bdt(sum('total_poisha'))}</dd>
              <dt className="text-secondary">{t('vat')}</dt>
              <dd className="text-end">{bdt(sum('vat_poisha'))}</dd>
            </dl>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
              <a
                className="inline-flex items-center gap-2 text-sm font-semibold text-info underline-offset-4 hover:underline"
                href={`/api/export/vat?org=${ctx.org.id}&from=${lastFrom}&to=${lastTo}&lang=${loc}`}
              >
                <Download aria-hidden className="size-4" />
                {t('downloadVat')}
              </a>
              <a
                className="inline-flex items-center gap-2 text-sm font-semibold text-info underline-offset-4 hover:underline"
                href={`/api/export/orders?org=${ctx.org.id}&from=${lastFrom}&to=${lastTo}&lang=${loc}`}
              >
                <Download aria-hidden className="size-4" />
                {t('downloadOrders')}
              </a>
            </div>
            <Hint className="mt-3">{t('vatDisclaimer')}</Hint>
            {ctx.isOwner ? (
              <details className="mt-4 border-t border-line pt-3">
                <summary className="cursor-pointer text-sm font-medium text-purple">
                  {t('changeDay')}
                </summary>
                <ActionForm
                  action={setVatDueDayAction}
                  successKey="common.saved"
                  className="mt-2 flex items-end gap-2"
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
              </details>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
