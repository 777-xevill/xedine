import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { DayStory } from '@/components/landing-3d/day-story';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { COUNTRY_PLACES } from '@/components/landing-3d/story';
import { demoCurrency } from '@/components/landing-3d/story-ledger';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/format';
import { countryName, currencyOf, TARGET_COUNTRIES } from '@/modules/social/culture';
import { taxLabel } from '@/modules/tenancy/tax-label';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Hidden preview of the whole day in 3D (ADR 0064, approval 3). Prices follow the visitor's country
 * (Cloudflare's `cf-ipcountry`); `?country=GB` tries another market.
 */
export default async function DayPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string }>;
}) {
  const [raw, h, params] = await Promise.all([getLocale(), headers(), searchParams]);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const asked = (params.country ?? h.get('cf-ipcountry') ?? '').toUpperCase();
  const country = (TARGET_COUNTRIES as readonly string[]).includes(asked) ? asked : 'BD';
  const pin = (code: string) => ({
    code,
    name: countryName(code, locale),
    currency: currencyOf(code),
    ...(COUNTRY_PLACES[code] ?? { lat: 0, lng: 0 }),
  });
  const countries = TARGET_COUNTRIES.map(pin);
  await getTranslations('landing3d.day');
  return (
    <DayStory
      corner={<LocaleSwitcher />}
      currency={demoCurrency(currencyOf(country))}
      taxName={taxLabel(locale, country)}
      home={pin(country)}
      countries={countries}
    />
  );
}
