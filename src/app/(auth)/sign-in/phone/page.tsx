import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PhoneSignInForm } from '@/components/auth-forms';
import { Card, PageTitle } from '@/components/ui/form';
import { safeNext } from '@/modules/tenancy/form-state';
import { phoneSignInEnabled } from '@/modules/tenancy/oauth';
import { phoneSignInBotLink } from '@/modules/tenancy/phone-sign-in-core';

/** Sign in with a phone number, proven free through the Telegram bot (ADR 0050). */
export default async function PhoneSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [t, { next }] = await Promise.all([getTranslations('auth'), searchParams]);
  const botLink = phoneSignInBotLink(process.env.TELEGRAM_BOT_USERNAME);
  if (!phoneSignInEnabled() || !botLink) notFound();
  return (
    <Card>
      <PageTitle title={t('phoneTitle')} subtitle={t('phoneSubtitle')} />
      <PhoneSignInForm next={safeNext(next)} botLink={botLink} />
    </Card>
  );
}
