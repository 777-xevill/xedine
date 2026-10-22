import { getTranslations } from 'next-intl/server';
import { AcceptInviteForm, JoinInviteForm } from '@/components/auth-forms';
import { Alert, Card, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const [t, e, { token, email }] = await Promise.all([
    getTranslations('auth'),
    getTranslations('errors'),
    searchParams,
  ]);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <Card>
      <PageTitle title={t('inviteTitle')} subtitle={user ? t('inviteBody') : t('joinSubtitle')} />
      {!token ? (
        <Alert tone="danger">{e('inviteInvalid')}</Alert>
      ) : user ? (
        <AcceptInviteForm token={token} />
      ) : (
        <JoinInviteForm token={token} email={email} />
      )}
    </Card>
  );
}
