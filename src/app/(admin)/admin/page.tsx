import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, Input, Label, PageTitle, Select } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { now } from '@/lib/time/clock';
import { formatBDT, type Locale } from '@/lib/i18n/format';
import { decideBranchRequestAction, setSubscriptionAction } from '@/modules/billing/actions';

const TONE = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  canceled: 'danger',
  trial_expired: 'danger',
} as const;

/**
 * Admin console (ROADMAP Phase 10). Platform admins only (public.platform_admins, added by hand); it shows
 * operational metadata — plan, status, branches, trading days — and never a tenant's sales, costs or
 * customers (ARCHITECTURE.md). Subscriptions are set here until a payment provider exists.
 */
export default async function AdminPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/sign-in?next=/admin');
  const { data: isAdmin } = await supabase.rpc('am_platform_admin');
  if (isAdmin !== true) notFound();
  const [t, locale] = await Promise.all([getTranslations('admin'), getLocale()]);
  const { data } = await supabase.rpc('admin_orgs', { p_now: now().toISOString() });
  const { data: requestData } = await supabase.rpc('admin_branch_requests', {
    p_now: now().toISOString(),
  });
  const requests = (requestData ?? []) as {
    id: string;
    org_name: string;
    slug: string;
    name: string;
    area: string | null;
    status: string;
    branches: number;
    plan_code: string;
    price_per_branch_poisha: number;
    pilot_discount_bps: number;
    decision_note: string | null;
  }[];
  const orgs = (data ?? []) as {
    org_id: string;
    name: string;
    slug: string;
    branches: number;
    plan_code: string;
    status: keyof typeof TONE;
    trial_ends: string | null;
    pilot_discount_bps: number;
    active_days_30: number;
  }[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-4 flex justify-end">
        <LocaleSwitcher />
      </div>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <Card className="mb-6 p-4">
        <p className="mb-3 font-semibold">{t('branchRequestsTitle')}</p>
        {requests.length === 0 ? (
          <p className="text-sm text-secondary">{t('branchRequestsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {requests.map((r) =>
              r.status === 'pending' ? (
                <li key={r.id} className="py-3">
                  <p className="text-sm">
                    {t('branchRequestMeta', {
                      org: r.org_name,
                      slug: r.slug,
                      branches: Number(r.branches),
                      plan: t(`plans.${r.plan_code}`),
                      name: r.name,
                      area: r.area ? ` (${r.area})` : '',
                      extra: formatBDT(Number(r.price_per_branch_poisha), locale as Locale),
                    })}
                  </p>
                  <ActionForm
                    action={decideBranchRequestAction}
                    successKey="common.saved"
                    className="mt-2 flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="requestId" value={r.id} />
                    <div>
                      <Label htmlFor={`note-${r.id}`}>{t('decisionNote')}</Label>
                      <Input id={`note-${r.id}`} name="note" maxLength={300} className="w-64" />
                    </div>
                    <Button type="submit" name="decision" value="approve" size="sm">
                      {t('approve')}
                    </Button>
                    <Button
                      type="submit"
                      name="decision"
                      value="decline"
                      variant="secondary"
                      size="sm"
                    >
                      {t('decline')}
                    </Button>
                  </ActionForm>
                </li>
              ) : (
                <li key={r.id} className="py-2 text-sm text-secondary">
                  {t('branchRequestDecided', {
                    org: r.org_name,
                    name: r.name,
                    status: t(`decisions.${r.status as 'approved' | 'declined' | 'cancelled'}`),
                  })}
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
      <div className="space-y-3">
        {orgs.map((o) => (
          <Card key={o.org_id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{o.name}</p>
                <p className="text-xs text-secondary">
                  {t('meta', {
                    slug: o.slug,
                    branches: Number(o.branches),
                    days: Number(o.active_days_30),
                  })}
                </p>
              </div>
              <StatusBadge tone={TONE[o.status] ?? 'neutral'}>
                {t('planStatus', {
                  plan: t(`plans.${o.plan_code}`),
                  status: t(`statuses.${o.status}`),
                })}
              </StatusBadge>
            </div>
            <ActionForm
              action={setSubscriptionAction}
              successKey="common.saved"
              className="mt-3 grid gap-2 sm:grid-cols-5 sm:items-end"
            >
              <input type="hidden" name="orgId" value={o.org_id} />
              <div>
                <Label htmlFor={`plan-${o.org_id}`}>{t('plan')}</Label>
                <Select id={`plan-${o.org_id}`} name="plan" defaultValue={o.plan_code}>
                  {['starter', 'growth', 'chain'].map((p) => (
                    <option key={p} value={p}>
                      {t(`plans.${p}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor={`status-${o.org_id}`}>{t('status')}</Label>
                <Select
                  id={`status-${o.org_id}`}
                  name="status"
                  defaultValue={o.status === 'trial_expired' ? 'trialing' : o.status}
                >
                  {['trialing', 'active', 'past_due', 'canceled'].map((s) => (
                    <option key={s} value={s}>
                      {t(`statuses.${s}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor={`disc-${o.org_id}`}>{t('discount')}</Label>
                <Input
                  id={`disc-${o.org_id}`}
                  name="discountPct"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={Number(o.pilot_discount_bps) / 100}
                />
              </div>
              <div>
                <Label htmlFor={`end-${o.org_id}`}>{t('periodEnd')}</Label>
                <Input id={`end-${o.org_id}`} name="periodEnd" type="date" />
              </div>
              <Button type="submit" size="sm">
                {t('save')}
              </Button>
            </ActionForm>
          </Card>
        ))}
      </div>
    </div>
  );
}
