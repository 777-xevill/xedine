import { createTranslator } from 'next-intl';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { taxKindOf } from '@/modules/social/culture';

/** What the sales tax is called in the restaurant's country, in a language ("VAT", "GST", "ভ্যাট"; ADR 0062). */
export function taxLabel(locale: 'bn' | 'en', country: string): string {
  return createTranslator({ locale, messages: locale === 'bn' ? bn : en, namespace: 'place' })(
    `taxNames.${taxKindOf(country)}`,
  );
}
