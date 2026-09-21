import { getTranslations } from 'next-intl/server';
import { AcceptInviteForm } from '@/components/auth-forms';
import { Alert, Card, PageTitle } from '@/components/ui/form';

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [t, e, { token }] = await Promise.all([
    getTranslations('auth'),
    getTranslations('errors'),
    searchParams,
  ]);
  return (
    <Card>
      <PageTitle title={t('inviteTitle')} subtitle={t('inviteBody')} />
      {token ? (
        <AcceptInviteForm token={token} />
      ) : (
        <Alert tone="danger">{e('inviteInvalid')}</Alert>
      )}
    </Card>
  );
}
