import { headers } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/format';
import { countryName, currencyOf, TARGET_COUNTRIES } from '@/modules/social/culture';
import { taxLabel } from '@/modules/tenancy/tax-label';
import { landingAsset } from './asset-version';
import { DayStory } from './day-story';
import { COUNTRY_PLACES } from './story';
import { demoCurrency } from './story-ledger';

/**
 * The 3D day as a page (ADR 0064): the home page and its preview share it. Prices follow the visitor's
 * country (Cloudflare's `cf-ipcountry`; `?country=GB` tries another market).
 */
export async function DayPage({
  country: asked,
  footer,
}: {
  country?: string;
  footer?: ReactNode;
}) {
  const [raw, h] = await Promise.all([getLocale(), headers()]);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const code = (asked ?? h.get('cf-ipcountry') ?? '').toUpperCase();
  const country = (TARGET_COUNTRIES as readonly string[]).includes(code) ? code : 'BD';
  const pin = (c: string) => ({
    code: c,
    name: countryName(c, locale),
    currency: currencyOf(c),
    ...(COUNTRY_PLACES[c] ?? { lat: 0, lng: 0 }),
  });
  await getTranslations('landing3d.day');
  return (
    <>
      {/* The first picture (the street and Xedine) starts downloading with the page, before the 3D code runs. */}
      {['world-st.glb', 'xedine.glb'].map((file) => (
        <link
          key={file}
          rel="preload"
          href={landingAsset(file)}
          as="fetch"
          crossOrigin="anonymous"
          fetchPriority="high"
        />
      ))}
      <DayStory
        corner={<LocaleSwitcher />}
        footer={footer}
        currency={demoCurrency(currencyOf(country))}
        taxName={taxLabel(locale, country)}
        home={pin(country)}
        countries={TARGET_COUNTRIES.map(pin)}
      />
    </>
  );
}
