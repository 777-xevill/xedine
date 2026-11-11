import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { ResendSignUpEmail } from '@/components/auth-forms';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { SIGNUP_EMAIL_COOKIE } from '@/modules/tenancy/form-state';

/** After "Create account": its own page that says where the link went and what to do next. */
export default async function CheckEmailPage() {
  const [t, jar] = await Promise.all([getTranslations('auth'), cookies()]);
  const email = jar.get(SIGNUP_EMAIL_COOKIE)?.value;
  const gmail = email ? /@(gmail|googlemail)\.com$/i.test(email) : false;
  return (
    <Card className="text-center">
      <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-full bg-purple/10 text-purple">
        <MailCheck className="size-8" aria-hidden />
      </div>
      <h1 className="mb-2 text-2xl font-bold tracking-[-0.02em]">{t('checkEmailTitle')}</h1>
      <p className="mb-1 text-sm text-secondary">
        {email ? t('checkEmailSentTo') : t('checkEmailSentNoAddress')}
      </p>
      {email ? <p className="mb-5 font-semibold break-all">{email}</p> : <div className="mb-5" />}

      <ol className="mb-6 list-inside list-decimal space-y-2 rounded-xl bg-surface-elevated p-4 text-left text-sm">
        <li>{t('checkEmailStep1')}</li>
        <li>{t('checkEmailStep2')}</li>
        <li>{t('checkEmailStep3')}</li>
      </ol>

      {gmail ? (
        <a
          href="https://mail.google.com/mail/u/0/#inbox"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants(), 'mb-3 w-full')}
        >
          {t('openGmail')}
        </a>
      ) : null}

      <p className="mb-3 text-xs text-secondary">{t('checkEmailSpam')}</p>
      {email ? <ResendSignUpEmail /> : null}

      <p className="mt-5 text-sm text-secondary">
        {t('wrongEmail')}{' '}
        <Link href="/sign-up" className="text-purple underline-offset-4 hover:underline">
          {t('signUpAgain')}
        </Link>
      </p>
    </Card>
  );
}
