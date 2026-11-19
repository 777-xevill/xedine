import { getImageProps } from 'next/image';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/format';
import { countryName, currencyOf, TARGET_COUNTRIES } from '@/modules/social/culture';
import { taxLabel } from '@/modules/tenancy/tax-label';
import { landingAsset } from './asset-version';
import { DayStory } from './day-story';
import { liteScript } from './lite';
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
  const [messages] = await Promise.all([getMessages(), getTranslations('landing3d.day')]);
  // The first view as a picture, shown at once. Three shapes, each framed and anchored like the 3D camera
  // (frameCamera): wide screens keep the height with the subject 66% across, squarer ones keep the width,
  // upright phones keep the width with the subject a third down. So the 3D fades in without a jump.
  const common = { alt: '', unoptimized: true, priority: true } as const;
  const wide = getImageProps({
    ...common,
    src: landingAsset('poster-wide.webp'),
    width: 2400,
    height: 1000,
  }).props;
  const square = getImageProps({
    ...common,
    src: landingAsset('poster-square.webp'),
    width: 1500,
    height: 1250,
  }).props;
  const { src: tall, ...img } = getImageProps({
    ...common,
    src: landingAsset('poster-tall.webp'),
    width: 720,
    height: 1714,
  }).props;
  const backdrop = (
    <picture>
      <source media="(min-aspect-ratio: 16/9)" srcSet={wide.src} />
      <source media="(min-aspect-ratio: 1/1)" srcSet={square.src} />
      <img
        {...img}
        alt=""
        src={tall}
        fetchPriority="high"
        className="xedine-poster h-full w-full"
      />
    </picture>
  );
  return (
    <>
      {/* The first 3D files (the street and Xedine) start downloading with the page, before the 3D code
          runs, at low priority so the page's own code comes first; a slow phone skips them (lite.ts). */}
      <script
        dangerouslySetInnerHTML={{
          __html: liteScript(['world-st.glb', 'xedine.glb'].map(landingAsset)),
        }}
      />
      {/* Only the words this page's browser code uses (the root layout sends `common` alone): the whole
          app's words made the HTML 486 KB in English and 729 KB in Bangla. */}
      <NextIntlClientProvider messages={{ common: messages.common, landing3d: messages.landing3d }}>
        <DayStory
          corner={<LocaleSwitcher />}
          footer={footer}
          backdrop={backdrop}
          currency={demoCurrency(currencyOf(country))}
          taxName={taxLabel(locale, country)}
          home={pin(country)}
          countries={TARGET_COUNTRIES.map(pin)}
        />
      </NextIntlClientProvider>
    </>
  );
}
