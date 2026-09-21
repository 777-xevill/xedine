import { getTranslations } from 'next-intl/server';
import { SignInForm } from '@/components/auth-forms';
import { Card, PageTitle } from '@/components/ui/form';
import { safeNext } from '@/modules/tenancy/form-state';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [t, { next }] = await Promise.all([getTranslations('auth'), searchParams]);
  return (
    <Card>
      <PageTitle title={t('signInTitle')} subtitle={t('signInSubtitle')} />
      <SignInForm next={safeNext(next)} />
    </Card>
  );
}
