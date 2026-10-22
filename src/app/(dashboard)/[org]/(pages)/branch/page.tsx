import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { BranchPriceForm, StationForm, TableForm } from '@/components/branch-forms';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, EmptyState, PageTitle } from '@/components/ui/form';
import { PillNav } from '@/components/ui/pill-nav';
import { StatusBadge } from '@/components/ui/badge';
import { createClient } from '@/lib/db/supabase-server';
import { formatBDT, type Locale } from '@/lib/i18n/format';
import {
  setAvailabilityAction,
  toggleStationActiveAction,
  toggleTableActiveAction,
} from '@/modules/branch/actions';
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

  const [t, tc, locale] = await Promise.all([
    getTranslations('branch'),
    getTranslations('common'),
    getLocale(),
  ]);
  const supabase = await createClient();
  const [{ data: items }, { data: overrides }, { data: tables }, { data: stations }] =
    await Promise.all([
      supabase
        .from('menu_items')
        .select('id, name, base_price_poisha')
        .eq('org_id', ctx.org.id)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('branch_item_prices')
        .select('menu_item_id, price_poisha, is_available, has_price_override')
        .eq('org_id', ctx.org.id)
        .eq('branch_id', current.id)
        .is('variant_id', null),
      supabase
        .from('dining_tables')
        .select('id, name, seats, is_active')
        .eq('org_id', ctx.org.id)
        .eq('branch_id', current.id)
        .order('name'),
      supabase
        .from('stations')
        .select('id, name, is_active')
        .eq('org_id', ctx.org.id)
        .eq('branch_id', current.id)
        .order('sort_order'),
    ]);
  const overrideByItem = new Map((overrides ?? []).map((o) => [o.menu_item_id, o]));
  const money = (p: number) => formatBDT(p, locale as Locale);

  return (
    <>
      <SettingsNav ctx={ctx} current="branchSetup" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
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

      <Card>
        <CardTitle>{t('menuTitle', { branch: current.name })}</CardTitle>
        <p className="-mt-2 mb-4 text-sm text-secondary">{t('menuBody')}</p>
        {(items ?? []).length === 0 ? (
          <EmptyState title={t('noItems')} />
        ) : (
          <ul className="divide-y divide-line">
            {(items ?? []).map((item) => {
              const override = overrideByItem.get(item.id);
              const available = override ? override.is_available : true;
              const price = override?.has_price_override
                ? override.price_poisha
                : item.base_price_poisha;
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-sm text-secondary">
                      {money(price)}
                      {override?.has_price_override ? ` · ${t('overridden')}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {available ? (
                      <StatusBadge tone="success">{t('onMenu')}</StatusBadge>
                    ) : (
                      <StatusBadge tone="danger">{t('eightySix')}</StatusBadge>
                    )}
                    <BranchPriceForm
                      orgId={ctx.org.id}
                      orgSlug={ctx.org.slug}
                      branchId={current.id}
                      itemId={item.id}
                      currentPrice={
                        override?.has_price_override
                          ? formatBDT(override.price_poisha, 'en', {
                              symbol: false,
                              poisha: 'auto',
                            })
                          : ''
                      }
                    />
                    <form action={setAvailabilityAction}>
                      <input type="hidden" name="orgId" value={ctx.org.id} />
                      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                      <input type="hidden" name="branchId" value={current.id} />
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="available" value={String(!available)} />
                      <Button type="submit" variant="secondary" size="sm">
                        {available ? t('markSoldOut') : t('bringBack')}
                      </Button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
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

        <Card>
          <CardTitle>{t('stationsTitle')}</CardTitle>
          <p className="-mt-2 mb-4 text-sm text-secondary">{t('stationsBody')}</p>
          <StationForm orgId={ctx.org.id} orgSlug={ctx.org.slug} branchId={current.id} />
          {(stations ?? []).length === 0 ? (
            <EmptyState className="mt-4" title={t('noStations')} />
          ) : (
            <ul className="mt-4 flex flex-wrap gap-2">
              {(stations ?? []).map((s) => (
                <li
                  key={s.id}
                  className="glass-tile flex items-center gap-1.5 rounded-full py-1 ps-3 pe-1.5"
                >
                  <span className={s.is_active ? '' : 'text-muted line-through'}>{s.name}</span>
                  <form action={toggleStationActiveAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                    <input type="hidden" name="active" value={String(s.is_active)} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="min-h-7 px-2 text-xs"
                    >
                      {s.is_active ? tc('remove') : t('restore')}
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
