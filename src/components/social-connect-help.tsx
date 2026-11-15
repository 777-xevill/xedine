import { ExternalLink, Handshake, Share2, UserPlus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert, Hint, Input, Label } from '@/components/ui/form';
import { cancelSocialConnectAction, requestSocialConnectAction } from '@/modules/social/actions';

/**
 * Settings → Social, before Facebook is connected (ADR 0059). Until Meta approves Xedine for everyone, the
 * owner picks the easier of two ways: give Xedine's Facebook account access to their Page and Xedine
 * connects it, or send their own profile link, accept a Tester invite and connect themselves.
 */
export async function SocialConnectHelp({
  orgId,
  orgSlug,
  request,
  helper,
}: {
  orgId: string;
  orgSlug: string;
  request: { way: 'page_access' | 'tester'; status: 'waiting' | 'invited' } | null;
  helper: { name: string; url: string | null } | null;
}) {
  const t = await getTranslations('social.settings');
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
    </>
  );
  const connectHref = `/api/social/meta/start?org=${orgSlug}`;
  const cancel = (
    <form action={cancelSocialConnectAction}>
      {hidden}
      <Button type="submit" variant="ghost" size="sm">
        {t('help.cancel')}
      </Button>
    </form>
  );

  if (request?.status === 'invited')
    return (
      <div className="space-y-4">
        <p className="font-semibold">{t('help.invitedTitle')}</p>
        <ol className="list-decimal space-y-4 pl-5 text-sm">
          <li className="space-y-2">
            <p>{t('help.invitedStep1')}</p>
            <a
              href="https://developers.facebook.com/requests/"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'secondary' })}
            >
              <ExternalLink aria-hidden className="size-4" />
              {t('help.invitedAccept')}
            </a>
            <Hint>{t('help.invitedHint')}</Hint>
          </li>
          <li className="space-y-2">
            <p>{t('help.invitedStep2')}</p>
            <a href={connectHref} className={buttonVariants({ variant: 'primary' })}>
              <Share2 aria-hidden className="size-4" />
              {t('connect')}
            </a>
          </li>
        </ol>
        {cancel}
      </div>
    );

  if (request)
    return (
      <div className="space-y-3">
        <Alert tone="success">
          {request.way === 'page_access' ? t('help.waitingPage') : t('help.waitingTester')}
        </Alert>
        {cancel}
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">{t('help.choose')}</p>
      <div className={helper ? 'grid gap-4 md:grid-cols-2' : 'grid gap-4'}>
        {helper ? (
          <section className="rounded-card border-2 border-purple/40 p-4">
            <p className="mb-3 flex items-center gap-2 font-bold">
              <Handshake aria-hidden className="size-5 text-purple" />
              {t('help.pageTitle')}
            </p>
            <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm">
              <li>{t('help.pageStep1')}</li>
              <li>
                {t('help.pageStep2', { name: helper.name })}{' '}
                {helper.url ? (
                  <a
                    href={helper.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary underline"
                  >
                    {t('help.pageProfile')}
                  </a>
                ) : null}
              </li>
              <li>{t('help.pageStep3')}</li>
            </ol>
            <ActionForm
              action={requestSocialConnectAction}
              successKey="common.saved"
              className="space-y-2"
            >
              {hidden}
              <input type="hidden" name="way" value="page_access" />
              <Label htmlFor="help-page-link">{t('help.pageLink')}</Label>
              <Input
                id="help-page-link"
                name="link"
                inputMode="url"
                maxLength={300}
                placeholder="facebook.com/…"
              />
              <Hint>{t('help.linkHint')}</Hint>
              <Button type="submit">
                <Handshake aria-hidden className="size-4" />
                {t('help.pageSend')}
              </Button>
            </ActionForm>
          </section>
        ) : null}
        <section className="rounded-card border border-line p-4">
          <p className="mb-2 flex items-center gap-2 font-bold">
            <UserPlus aria-hidden className="size-5" />
            {t('help.selfTitle')}
          </p>
          <p className="mb-4 text-sm text-secondary">{t('help.selfBody')}</p>
          <ActionForm
            action={requestSocialConnectAction}
            successKey="common.saved"
            className="space-y-2"
          >
            {hidden}
            <input type="hidden" name="way" value="tester" />
            <Label htmlFor="help-self-link">{t('help.selfLink')}</Label>
            <Input
              id="help-self-link"
              name="link"
              inputMode="url"
              required
              maxLength={300}
              placeholder="facebook.com/…"
            />
            <Hint>{t('help.linkHint')}</Hint>
            <Button type="submit" variant="secondary">
              {t('help.selfSend')}
            </Button>
          </ActionForm>
        </section>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm text-secondary">
        {t('help.already')}
        <a href={connectHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <Share2 aria-hidden className="size-4" />
          {t('connect')}
        </a>
      </p>
    </div>
  );
}
