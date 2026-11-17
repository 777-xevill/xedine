import { getTranslations } from 'next-intl/server';
import { DATA_DELETION_SECTIONS, LEGAL_CONTACT, LegalPage } from '@/components/legal-page';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * How to have the account deleted. Google Play links here as the app's "delete account" web page, and
 * the app's sidebar links here from inside the app (ADR 0065): the request must be easy to find, so the
 * email button sits right under the introduction.
 */
export default async function DataDeletionPage() {
  const t = await getTranslations('legal.dataDeletion');
  const mailto = `mailto:${LEGAL_CONTACT}?subject=${encodeURIComponent(
    t('mailSubject'),
  )}&body=${encodeURIComponent(t('mailBody'))}`;
  return (
    <LegalPage
      doc="dataDeletion"
      sections={DATA_DELETION_SECTIONS}
      action={
        <>
          <a
            href={mailto}
            className={cn(buttonVariants(), 'w-full')}
            data-testid="request-deletion"
          >
            {t('button')}
          </a>
          <p className="mt-2 text-center text-xs text-muted">
            {t('buttonHint', { email: LEGAL_CONTACT })}
          </p>
        </>
      }
    />
  );
}
