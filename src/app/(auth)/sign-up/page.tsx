import { getTranslations } from 'next-intl/server';
import { QuickSignIn, SignUpForm } from '@/components/auth-forms';
import { Card, PageTitle } from '@/components/ui/form';
import { safeNext } from '@/modules/tenancy/form-state';
import {
  facebookSignInEnabled,
  googleSignInEnabled,
  phoneSignInEnabled,
} from '@/modules/tenancy/oauth';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [t, { next }] = await Promise.all([getTranslations('auth'), searchParams]);
  const safe = safeNext(next);
  return (
    <Card>
      <PageTitle title={t('signUpTitle')} subtitle={t('signUpSubtitle')} />
      <QuickSignIn
        next={safe}
        google={googleSignInEnabled()}
        facebook={facebookSignInEnabled()}
        phone={phoneSignInEnabled()}
      />
      <SignUpForm next={safe} />
    </Card>
  );
}
