import { getTranslations } from 'next-intl/server';
import { FacebookSignIn, SignInForm } from '@/components/auth-forms';
import { Card, PageTitle } from '@/components/ui/form';
import { safeNext } from '@/modules/tenancy/form-state';
import { facebookSignInEnabled, OAUTH_ERRORS } from '@/modules/tenancy/oauth';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const [t, { next, error }] = await Promise.all([getTranslations('auth'), searchParams]);
  const safe = safeNext(next);
  return (
    <Card>
      <PageTitle title={t('signInTitle')} subtitle={t('signInSubtitle')} />
      {facebookSignInEnabled() ? <FacebookSignIn next={safe} /> : null}
      <SignInForm next={safe} urlError={error && OAUTH_ERRORS.has(error) ? error : undefined} />
    </Card>
  );
}
