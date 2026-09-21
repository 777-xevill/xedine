import { getTranslations } from 'next-intl/server';
import { SignUpForm } from '@/components/auth-forms';
import { Card, PageTitle } from '@/components/ui/form';
import { safeNext } from '@/modules/tenancy/form-state';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [t, { next }] = await Promise.all([getTranslations('auth'), searchParams]);
  return (
    <Card>
      <PageTitle title={t('signUpTitle')} subtitle={t('signUpSubtitle')} />
      <SignUpForm next={safeNext(next)} />
    </Card>
  );
}
