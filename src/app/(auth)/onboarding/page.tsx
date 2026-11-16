import { getLocale, getTranslations } from 'next-intl/server';
import { OnboardingForm } from '@/components/auth-forms';
import { Card, PageTitle } from '@/components/ui/form';
import { now } from '@/lib/time/clock';
import { placeOptions } from '@/modules/social/culture';

export default async function OnboardingPage() {
  const [t, locale] = await Promise.all([getTranslations('onboarding'), getLocale()]);
  return (
    <Card>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <OnboardingForm place={placeOptions(locale, now())} />
    </Card>
  );
}
