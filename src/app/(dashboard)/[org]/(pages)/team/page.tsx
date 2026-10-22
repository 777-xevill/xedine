import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ConfirmTeamButton, InviteForm } from '@/components/team-forms';
import { Card, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatDhakaDate, type Locale } from '@/lib/i18n/format';
import { removeMemberAction, revokeInvitationAction } from '@/modules/tenancy/actions';
import { getOrgContext } from '@/modules/tenancy/context';
import { SettingsNav } from '@/components/settings-nav';

export default async function TeamPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();

  const [t, roles, locale] = await Promise.all([
    getTranslations('team'),
    getTranslations('roles'),
    getLocale(),
  ]);
  const supabase = await createClient();
  const [{ data: memberships }, { data: links }, { data: invitations }, { data: branches }] =
    await Promise.all([
      supabase
        .from('memberships')
        .select('id, user_id, role, branch_scope')
        .eq('org_id', ctx.org.id)
        .order('created_at'),
      supabase
        .from('membership_branches')
        .select('membership_id, branch_id')
        .eq('org_id', ctx.org.id),
      supabase
        .from('invitations')
        .select('id, email, role, branch_ids, expires_at')
        .eq('org_id', ctx.org.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase.from('branches').select('id, name').eq('org_id', ctx.org.id).order('name'),
    ]);
  const userIds = [...new Set((memberships ?? []).map((m) => m.user_id))];
  const { data: profiles } =
    userIds.length > 0
      ? await supabase.from('profiles').select('user_id, full_name').in('user_id', userIds)
      : { data: [] };

  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const nameOf = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name as string | null]));
  const scopeOf = (id: string, scope: string) =>
    scope === 'all'
      ? t('allBranchesScope')
      : (links ?? [])
          .filter((l) => l.membership_id === id)
          .map((l) => branchName.get(l.branch_id) ?? '')
          .join(' · ');

  return (
    <>
      <SettingsNav ctx={ctx} current="team" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />

      <Card className="mb-6">
        <h2 className="mb-1 text-lg font-semibold">{t('tillStaffTitle')}</h2>
        <p className="text-sm text-secondary">
          {t('tillStaffBody')}{' '}
          <Link
            href={`/${ctx.org.slug}/staff`}
            className="text-purple underline-offset-4 hover:underline"
          >
            {t('tillStaffLink')}
          </Link>
        </p>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-4 text-lg font-semibold">{t('inviteTitle')}</h2>
        <InviteForm
          orgId={ctx.org.id}
          orgSlug={ctx.org.slug}
          orgName={ctx.org.name}
          branches={branches ?? []}
        />
      </Card>

      <Card className="mb-6">
        <h2 className="mb-1 text-lg font-semibold">{t('pendingTitle')}</h2>
        <p className="mb-3 text-sm text-secondary">{t('pendingHint')}</p>
        {(invitations ?? []).length === 0 ? (
          <p className="text-secondary">{t('noPending')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {(invitations ?? []).map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">{inv.email}</p>
                  <p className="text-sm text-secondary">
                    {roles(inv.role)} ·{' '}
                    {(inv.branch_ids as string[]).map((b) => branchName.get(b) ?? '').join(' · ') ||
                      t('allBranchesScope')}{' '}
                    ·{' '}
                    {t('expires', {
                      date: formatDhakaDate(new Date(inv.expires_at), locale as Locale),
                    })}
                  </p>
                </div>
                <ConfirmTeamButton
                  kind="revoke"
                  action={revokeInvitationAction}
                  field="invitationId"
                  id={inv.id}
                  orgSlug={ctx.org.slug}
                  name={inv.email}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t('membersTitle')}</h2>
        <ul className="divide-y divide-line" data-testid="members">
          {(memberships ?? []).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-medium">{nameOf.get(m.user_id) ?? m.user_id}</p>
                <p className="text-sm text-secondary">
                  {roles(m.role)} · {scopeOf(m.id, m.branch_scope)}
                </p>
              </div>
              {m.role !== 'owner' ? (
                <ConfirmTeamButton
                  kind="remove"
                  action={removeMemberAction}
                  field="membershipId"
                  id={m.id}
                  orgSlug={ctx.org.slug}
                  name={nameOf.get(m.user_id) ?? roles(m.role)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
