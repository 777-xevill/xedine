import { getTranslations } from 'next-intl/server';
import { Card, PageTitle } from '@/components/ui/form';

/** Where people write about their data (also the support address on Google's sign-in screen). */
export const LEGAL_CONTACT = 'support@xedine.org';

export const PRIVACY_SECTIONS = [
  'collect',
  'signIn',
  'use',
  'share',
  'safety',
  'keep',
  'contact',
] as const;
export const TERMS_SECTIONS = [
  'service',
  'account',
  'data',
  'fair',
  'ai',
  'price',
  'warranty',
  'stop',
  'law',
  'contact',
] as const;

/** The privacy policy and terms (needed to publish Google sign-in to everyone, ADR 0050). */
export async function LegalPage({
  doc,
  sections,
}: {
  doc: 'privacy' | 'terms';
  sections: readonly string[];
}) {
  const t = await getTranslations('legal');
  return (
    <Card>
      <PageTitle title={t(`${doc}.title`)} subtitle={t('updated')} />
      <p className="mb-6 text-sm leading-relaxed">{t(`${doc}.intro`)}</p>
      <div className="space-y-5">
        {sections.map((s) => (
          <section key={s}>
            <h2 className="mb-1 text-base font-semibold">{t(`${doc}.${s}.title`)}</h2>
            <p className="text-sm leading-relaxed text-secondary">
              {t(`${doc}.${s}.body`, { email: LEGAL_CONTACT })}
            </p>
          </section>
        ))}
      </div>
    </Card>
  );
}
