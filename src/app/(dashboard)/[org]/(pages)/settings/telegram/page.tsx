import { Send } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { SettingsNav } from '@/components/settings-nav';
import { TelegramLinkForm } from '@/components/telegram-link-form';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardTitle, EmptyState, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatDhakaDate, type Locale } from '@/lib/i18n/format';
import { speechConfigured } from '@/lib/llm-gateway';
import { now } from '@/lib/time/clock';
import { revokeChatLinkAction } from '@/modules/purchasing/chat-actions';
import { getOrgContext } from '@/modules/tenancy/context';

/**
 * Settings → Telegram (ADR 0025): the owner connects a purchaser's Telegram to the bazar bot with a
 * one-time link, and sees or disconnects the chats that are connected.
 */
export default async function TelegramSettingsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();
  const [t, roles, locale] = await Promise.all([
    getTranslations('telegramPage'),
    getTranslations('roles'),
    getLocale(),
  ]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const [{ data: memberships }, { data: scoped }, { data: branches }, { data: links }] =
    await Promise.all([
      supabase
        .from('memberships')
        .select('id, user_id, role, branch_scope')
        .eq('org_id', ctx.org.id)
        .eq('status', 'active')
        .in('role', ['owner', 'purchaser'])
        .order('created_at'),
      supabase
        .from('membership_branches')
        .select('membership_id, branch_id')
        .eq('org_id', ctx.org.id),
      supabase.from('branches').select('id, name').eq('org_id', ctx.org.id).order('name'),
      supabase
        .from('chat_links')
        .select('id, user_id, branch_id, external_id, linked_at, code_expires_at, created_at')
        .eq('org_id', ctx.org.id)
        .eq('channel', 'telegram')
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
    ]);
  const userIds = [
    ...new Set([
      ...(memberships ?? []).map((m) => m.user_id as string),
      ...(links ?? []).map((l) => l.user_id as string),
    ]),
  ];
  const { data: profiles } =
    userIds.length > 0
      ? await supabase.from('profiles').select('user_id, full_name').in('user_id', userIds)
      : { data: [] };
  const nameOf = new Map(
    (profiles ?? []).map((p) => [
      p.user_id as string,
      (p.full_name as string | null) ?? t('unnamed'),
    ]),
  );
  const branchName = new Map((branches ?? []).map((b) => [b.id as string, b.name as string]));

  // Everyone who may buy, for each branch they may buy for.
  const targets = (memberships ?? []).flatMap((m) => {
    const ids =
      m.branch_scope === 'all'
        ? (branches ?? []).map((b) => b.id as string)
        : (scoped ?? []).filter((s) => s.membership_id === m.id).map((s) => s.branch_id as string);
    return ids.map((b) => ({
      value: `${m.user_id}|${b}`,
      label: `${nameOf.get(m.user_id as string) ?? t('unnamed')} · ${roles(m.role as string)} · ${branchName.get(b) ?? ''}`,
    }));
  });
  const at = now();
  const connected = (links ?? []).filter((l) => l.external_id !== null);
  const pending = (links ?? []).filter(
    (l) => l.external_id === null && new Date(l.code_expires_at as string) > at,
  );
  const ready = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME);

  const row = (l: NonNullable<typeof links>[number], status: React.ReactNode) => (
    <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-medium">{nameOf.get(l.user_id as string) ?? t('unnamed')}</p>
        <p className="text-sm text-secondary">
          {branchName.get(l.branch_id as string) ?? ''} · {status}
        </p>
      </div>
      <form action={revokeChatLinkAction}>
        <input type="hidden" name="linkId" value={l.id as string} />
        <input type="hidden" name="orgSlug" value={ctx.org.slug} />
        <Button type="submit" variant="secondary" size="sm">
          {l.external_id ? t('disconnect') : t('cancelLink')}
        </Button>
      </form>
    </li>
  );

  return (
    <>
      <SettingsNav ctx={ctx} current="telegram" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />

      {!ready ? (
        <Alert tone="warning" className="mb-6">
          {t('notSetUp')}
        </Alert>
      ) : null}

      <Card className="mb-6 max-w-3xl">
        <CardTitle className="flex items-center gap-2">
          <Send aria-hidden className="size-5 text-primary" />
          {t('connectTitle')}
        </CardTitle>
        <p className="-mt-2 mb-4 text-sm text-secondary">{t('connectBody')}</p>
        {targets.length === 0 ? (
          <EmptyState title={t('noPurchasers')} className="py-6" />
        ) : (
          <TelegramLinkForm
            orgId={ctx.org.id}
            orgSlug={ctx.org.slug}
            targets={targets}
            ready={ready}
          />
        )}
      </Card>

      <Card className="mb-6 max-w-3xl">
        <CardTitle>{t('connectedTitle')}</CardTitle>
        {connected.length === 0 && pending.length === 0 ? (
          <EmptyState title={t('noneConnected')} className="py-6" />
        ) : (
          <ul className="divide-y divide-line">
            {connected.map((l) =>
              row(
                l,
                <StatusBadge tone="success">
                  {t('connectedOn', {
                    date: formatDhakaDate(new Date(l.linked_at as string), loc),
                  })}
                </StatusBadge>,
              ),
            )}
            {pending.map((l) =>
              row(
                l,
                <StatusBadge tone="neutral">
                  {t('waiting', {
                    date: formatDhakaDate(new Date(l.code_expires_at as string), loc),
                  })}
                </StatusBadge>,
              ),
            )}
          </ul>
        )}
      </Card>

      <Card className="max-w-3xl">
        <CardTitle>{t('howTitle')}</CardTitle>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-secondary">
          <li>{t('how1')}</li>
          <li>{t('how2')}</li>
          <li>{t('how3')}</li>
          <li>{speechConfigured() ? t('how4Voice') : t('how4NoVoice')}</li>
        </ol>
      </Card>
    </>
  );
}
