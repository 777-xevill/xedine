import { getTranslations } from 'next-intl/server';
import { OnboardingForm } from '@/components/auth-forms';
import { Card, PageTitle } from '@/components/ui/form';

export default async function OnboardingPage() {
  const t = await getTranslations('onboarding');
  return (
    <Card>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <OnboardingForm />
    </Card>
  );
}
