import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BranchRequestForm, TableForm } from '@/components/branch-forms';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState, PageTitle } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { toggleTableActiveAction } from '@/modules/branch/actions';
import { cancelBranchRequestAction } from '@/modules/settings/actions';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';
import { SettingsNav } from '@/components/settings-nav';

export default async function BranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const [{ org }, { branch }] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner && !ctx.roles.includes('manager')) notFound();
  const current = pickBranch(ctx, branch);
  if (!current) notFound();

  const [t, tc] = await Promise.all([getTranslations('branch'), getTranslations('common')]);
  const supabase = await createClient();
  const [{ data: tables }, { data: requests }] = await Promise.all([
    supabase
      .from('dining_tables')
      .select('id, name, seats, is_active')
      .eq('org_id', ctx.org.id)
      .eq('branch_id', current.id)
      .order('name'),
    ctx.isOwner
      ? supabase
          .from('branch_requests')
          .select('id, name, area, status, decision_note')
          .eq('org_id', ctx.org.id)
          .order('created_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
  ]);
  const TONE = {
    pending: 'warning',
    approved: 'success',
    declined: 'danger',
    cancelled: 'neutral',
  } as const;

  return (
    <>
      <SettingsNav ctx={ctx} current="branchSetup" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {ctx.isOwner ? (
        <Card className="mb-6 max-w-3xl">
          <CardTitle>{t('requestTitle')}</CardTitle>
          <p className="-mt-2 mb-4 text-sm text-secondary">{t('requestBody')}</p>
          <BranchRequestForm orgId={ctx.org.id} orgSlug={ctx.org.slug} />
          {(requests ?? []).length > 0 ? (
            <div className="mt-5">
              <p className="mb-1 text-sm font-medium">{t('requestsTitle')}</p>
              <ul className="divide-y divide-line">
                {(requests ?? []).map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {r.name}
                        {r.area ? <span className="text-secondary"> · {r.area}</span> : null}
                      </p>
                      {r.decision_note ? (
                        <p className="text-sm text-secondary">{r.decision_note}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={TONE[r.status as keyof typeof TONE] ?? 'neutral'}>
                        {t(`requestStatus.${r.status as keyof typeof TONE}`)}
                      </StatusBadge>
                      {r.status === 'pending' ? (
                        <form action={cancelBranchRequestAction}>
                          <input type="hidden" name="requestId" value={r.id} />
                          <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                          <Button type="submit" variant="ghost" size="sm">
                            {t('requestCancel')}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}
      {ctx.branches.length > 1 ? (
        <PillNav
          label={t('branchPicker')}
          className="mb-6"
          items={ctx.branches.map((b) => ({
            href: `/${ctx.org.slug}/branch?branch=${b.id}`,
            label: b.name,
            active: b.id === current.id,
          }))}
        />
      ) : null}

      <div className="max-w-3xl">
        <Card>
          <CardTitle>{t('tablesTitle')}</CardTitle>
          <p className="-mt-2 mb-4 text-sm text-secondary">{t('tablesBody')}</p>
          <TableForm orgId={ctx.org.id} orgSlug={ctx.org.slug} branchId={current.id} />
          {(tables ?? []).length === 0 ? (
            <EmptyState className="mt-4" title={t('noTables')} />
          ) : (
            <ul className="mt-4 flex flex-wrap gap-2">
              {(tables ?? []).map((tb) => (
                <li
                  key={tb.id}
                  className="glass-tile flex items-center gap-1.5 rounded-full py-1 ps-3 pe-1.5"
                >
                  <span className={tb.is_active ? '' : 'text-muted line-through'}>
                    {tb.name}
                    {tb.seats ? ` · ${tb.seats}` : ''}
                  </span>
                  <form action={toggleTableActiveAction}>
                    <input type="hidden" name="id" value={tb.id} />
                    <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                    <input type="hidden" name="active" value={String(tb.is_active)} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="min-h-7 px-2 text-xs"
                    >
                      {tb.is_active ? tc('remove') : t('restore')}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
