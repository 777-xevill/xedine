import { getTranslations } from 'next-intl/server';
import { QuickSignIn, SignInForm } from '@/components/auth-forms';
import { Alert, Card, PageTitle } from '@/components/ui/form';
import { safeNext } from '@/modules/tenancy/form-state';
import {
  facebookSignInEnabled,
  googleSignInEnabled,
  phoneSignInEnabled,
  OAUTH_ERRORS,
} from '@/modules/tenancy/oauth';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const [t, { next, error, notice }] = await Promise.all([getTranslations('auth'), searchParams]);
  const safe = safeNext(next);
  return (
    <Card>
      <PageTitle title={t('signInTitle')} subtitle={t('signInSubtitle')} />
      {notice === 'confirmedSignIn' ? (
        <Alert tone="info" className="mb-4">
          {t('confirmedSignIn')}
        </Alert>
      ) : null}
      <QuickSignIn
        next={safe}
        google={googleSignInEnabled()}
        facebook={facebookSignInEnabled()}
        phone={phoneSignInEnabled()}
      />
      <SignInForm next={safe} urlError={error && OAUTH_ERRORS.has(error) ? error : undefined} />
    </Card>
  );
}
