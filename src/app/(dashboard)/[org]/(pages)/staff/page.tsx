import { KeyRound, MonitorSmartphone, ShieldCheck, UserRound } from 'lucide-react';
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
import { PillNav } from '@/components/ui/pill-nav';
import { createClient } from '@/lib/db/supabase-server';
import { formatDhakaDateTime, type Locale } from '@/lib/i18n/format';
import {
  createStaffAction,
  revokeDeviceAction,
  setStaffPinAction,
  toggleStaffActiveAction,
} from '@/modules/staff/actions';
import { getOrgContext, pickBranch } from '@/modules/tenancy/context';
import { SettingsNav } from '@/components/settings-nav';

export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const [{ org }, { branch }] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  const isManager = ctx.roles.includes('manager');
  if (!ctx.isOwner && !isManager) notFound();
  const current = pickBranch(ctx, branch);
  if (!current) notFound();

  const [t, tr, tc, locale] = await Promise.all([
    getTranslations('staff'),
    getTranslations('roles'),
    getTranslations('common'),
    getLocale(),
  ]);
  const supabase = await createClient();
  const [{ data: staff }, { data: devices }] = await Promise.all([
    supabase
      .from('staff')
      .select('id, display_name, role, is_active')
      .eq('org_id', ctx.org.id)
      .eq('branch_id', current.id)
      .order('is_active', { ascending: false })
      .order('display_name'),
    supabase
      .from('devices')
      .select('id, name, kind, status, last_seen_at')
      .eq('org_id', ctx.org.id)
      .eq('branch_id', current.id)
      .order('created_at', { ascending: false }),
  ]);

  // The database enforces this too (ADR 0014); the form just doesn't offer what would be refused.
  const roles = ctx.isOwner
    ? (['cashier', 'kitchen', 'manager', 'owner'] as const)
    : (['cashier', 'kitchen'] as const);
  const canEdit = (role: string) => ctx.isOwner || (role !== 'manager' && role !== 'owner');
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
      <input type="hidden" name="branchId" value={current.id} />
    </>
  );

  return (
    <>
      <SettingsNav ctx={ctx} current="staff" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {ctx.branches.length > 1 ? (
        <PillNav
          label={t('branchPicker')}
          className="mb-6"
          items={ctx.branches.map((b) => ({
            href: `/${ctx.org.slug}/staff?branch=${b.id}`,
            label: b.name,
            active: b.id === current.id,
          }))}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardTitle>{t('addTitle', { branch: current.name })}</CardTitle>
          <ActionForm action={createStaffAction} successKey="staff.added" className="space-y-4">
            {hidden}
            <div>
              <Label htmlFor="staff-name">{t('name')}</Label>
              <Input id="staff-name" name="displayName" required maxLength={120} />
            </div>
            <div>
              <Label htmlFor="staff-role">{t('role')}</Label>
              <Select id="staff-role" name="role" defaultValue="cashier">
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {tr(r)}
                  </option>
                ))}
              </Select>
              {!ctx.isOwner ? <Hint>{t('managerLimit')}</Hint> : null}
            </div>
            <div>
              <Label htmlFor="staff-pin">{t('pin')}</Label>
              <Input
                id="staff-pin"
                name="pin"
                inputMode="numeric"
                pattern="[0-9]{4,6}"
                autoComplete="off"
                maxLength={6}
              />
              <Hint>{t('pinHint')}</Hint>
            </div>
            <Button type="submit">{t('add')}</Button>
          </ActionForm>
        </Card>

        <Card>
          <CardTitle>{t('listTitle')}</CardTitle>
          {(staff ?? []).length === 0 ? (
            <EmptyState title={t('empty')} body={t('emptyBody')} />
          ) : (
            <ul className="space-y-2" data-testid="staff-list">
              {(staff ?? []).map((s) => (
                <li key={s.id} className="glass-tile rounded-input p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="inline-flex size-9 items-center justify-center rounded-full bg-surface-elevated text-secondary"
                      >
                        {s.role === 'manager' || s.role === 'owner' ? (
                          <ShieldCheck className="size-4" />
                        ) : (
                          <UserRound className="size-4" />
                        )}
                      </span>
                      <div>
                        <p className={s.is_active ? 'font-semibold' : 'font-semibold text-muted'}>
                          {s.display_name}
                        </p>
                        <p className="text-xs text-secondary">{tr(s.role)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.is_active ? (
                        <StatusBadge tone="success">{t('active')}</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">{t('inactive')}</StatusBadge>
                      )}
                      {canEdit(s.role) ? (
                        <form action={toggleStaffActiveAction}>
                          <input type="hidden" name="staffId" value={s.id} />
                          <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                          <input type="hidden" name="active" value={String(s.is_active)} />
                          <Button type="submit" variant="ghost" size="sm">
                            {s.is_active ? t('deactivate') : t('activate')}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                  {canEdit(s.role) && s.is_active ? (
                    <ActionForm
                      action={setStaffPinAction}
                      successKey="staff.pinSaved"
                      className="mt-3 flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="staffId" value={s.id} />
                      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                      <KeyRound aria-hidden className="size-4 text-secondary" />
                      <Input
                        name="pin"
                        inputMode="numeric"
                        pattern="[0-9]{4,6}"
                        maxLength={6}
                        autoComplete="off"
                        required
                        aria-label={t('newPinFor', { name: s.display_name })}
                        placeholder={t('newPin')}
                        className="min-h-9 w-32"
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        {t('setPin')}
                      </Button>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardTitle>{t('devicesTitle')}</CardTitle>
        <p className="-mt-2 mb-4 text-sm text-secondary">{t('devicesBody')}</p>
        {(devices ?? []).length === 0 ? (
          <EmptyState title={t('noDevices')} />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {(devices ?? []).map((d) => (
              <li
                key={d.id}
                className="glass-tile flex items-center justify-between gap-3 rounded-input p-3"
              >
                <div className="flex items-center gap-2.5">
                  <MonitorSmartphone aria-hidden className="size-5 text-secondary" />
                  <div>
                    <p className="font-semibold">{d.name}</p>
                    <p className="text-xs text-secondary">
                      {t(`deviceKind.${d.kind}`)}
                      {d.last_seen_at
                        ? ` · ${formatDhakaDateTime(new Date(d.last_seen_at), locale as Locale)}`
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    tone={
                      d.status === 'active'
                        ? 'success'
                        : d.status === 'revoked'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {t(`deviceStatus.${d.status}`)}
                  </StatusBadge>
                  {d.status !== 'revoked' ? (
                    <form action={revokeDeviceAction}>
                      <input type="hidden" name="deviceId" value={d.id} />
                      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                      <Button type="submit" variant="danger" size="sm">
                        {tc('revoke')}
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
