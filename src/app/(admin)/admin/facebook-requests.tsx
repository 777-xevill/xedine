import { ExternalLink, Share2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ActionForm } from '@/components/action-form';
import { StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { now } from '@/lib/time/clock';
import { pendingPageNames } from '@/modules/social/connect';
import { adminMarkSocialConnectAction, adminPickSocialPageAction } from '@/modules/social/actions';

const NOTICES = {
  pick: 'info',
  no_pages: 'warning',
  failed: 'danger',
  cancelled: 'warning',
  wrong_user: 'danger',
  not_configured: 'warning',
} as const;
type Notice = keyof typeof NOTICES;
const TONE = { waiting: 'warning', invited: 'info', done: 'success' } as const;

interface Request {
  org_id: string;
  org_name: string;
  slug: string;
  way: 'page_access' | 'tester';
  facebook_link: string | null;
  status: keyof typeof TONE;
  connected_page: string | null;
}

/**
 * Admin console → Facebook connect requests (ADR 0059). "Gave Page access": accept the restaurant's Page
 * invite on Xedine's Facebook account, then connect and pick their Page. "Wants a Tester invite": add the
 * profile in Meta → App roles → Testers, then mark it invited so the owner sees the Accept button.
 */
export async function FacebookRequests({
  userId,
  meta,
  metaOrg,
}: {
  userId: string;
  meta: string | undefined;
  metaOrg: string | undefined;
}) {
  const t = await getTranslations('admin.facebook');
  const supabase = await createClient();
  const { data } = await supabase.rpc('admin_social_connect_requests', {
    p_now: now().toISOString(),
  });
  const requests = (data ?? []) as Request[];
  const notice = meta && meta in NOTICES ? (meta as Notice) : null;
  const pickOrg = notice === 'pick' && z.uuid().safeParse(metaOrg).success ? metaOrg! : null;
  const pages = pickOrg ? await pendingPageNames(pickOrg, userId, now()) : [];
  const appId = process.env.META_APP_ID;
  const mark = (orgId: string, status: 'waiting' | 'invited' | 'done', label: string) => (
    <form action={adminMarkSocialConnectAction}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" size="sm" variant={status === 'invited' ? 'primary' : 'ghost'}>
        {label}
      </Button>
    </form>
  );

  return (
    <Card id="facebook" className="mb-6 p-4">
      <p className="mb-3 font-semibold">{t('title')}</p>
      {notice ? (
        <Alert tone={NOTICES[notice]} className="mb-3">
          {t(`notice.${notice}`)}
        </Alert>
      ) : null}
      {requests.length === 0 ? (
        <p className="text-sm text-secondary">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {requests.map((r) => (
            <li key={r.org_id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{r.org_name}</span>
                <span className="text-secondary">{r.slug}</span>
                <span>· {t(`ways.${r.way}`)}</span>
                <StatusBadge tone={TONE[r.status]}>{t(`statuses.${r.status}`)}</StatusBadge>
                {r.connected_page ? (
                  <span className="text-secondary">
                    {t('connectedPage', { page: r.connected_page })}
                  </span>
                ) : null}
              </div>
              {r.facebook_link ? (
                <a
                  href={r.facebook_link}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 break-all text-sm font-medium text-primary underline"
                >
                  <ExternalLink aria-hidden className="size-4 shrink-0" />
                  {`${t('link')}: ${r.facebook_link}`}
                </a>
              ) : null}
              {r.status === 'done' ? (
                <div className="flex flex-wrap gap-2">{mark(r.org_id, 'waiting', t('reopen'))}</div>
              ) : r.way === 'page_access' ? (
                <>
                  <p className="text-xs text-secondary">{t('acceptFirst')}</p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/api/social/meta/admin-start?org=${r.org_id}`}
                      className={buttonVariants({ variant: 'primary', size: 'sm' })}
                    >
                      <Share2 aria-hidden className="size-4" />
                      {t('connectFor')}
                    </a>
                    {mark(r.org_id, 'done', t('markDone'))}
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {appId ? (
                    <a
                      href={`https://developers.facebook.com/apps/${appId}/roles/roles/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                    >
                      <ExternalLink aria-hidden className="size-4" />
                      {t('openTesters')}
                    </a>
                  ) : null}
                  {r.status === 'waiting'
                    ? mark(r.org_id, 'invited', t('markInvited'))
                    : mark(r.org_id, 'waiting', t('reopen'))}
                  {mark(r.org_id, 'done', t('markDone'))}
                </div>
              )}
              {pickOrg === r.org_id && pages.length > 0 ? (
                <ActionForm
                  action={adminPickSocialPageAction}
                  successKey="common.saved"
                  className="mt-2 space-y-2 rounded-input border border-line p-3"
                >
                  <input type="hidden" name="orgId" value={r.org_id} />
                  <p className="text-sm font-semibold">{t('pickTitle', { org: r.org_name })}</p>
                  {pages.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="pageId"
                        value={p.id}
                        required
                        className="size-4 accent-purple"
                      />
                      <span className="font-semibold">{p.name}</span>
                      <span className="text-secondary">{p.igName ? `@${p.igName}` : '—'}</span>
                    </label>
                  ))}
                  <Button type="submit" size="sm">
                    {t('usePage')}
                  </Button>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
