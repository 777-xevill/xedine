import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { Inter, Noto_Sans_Bengali } from 'next/font/google';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { AppServiceWorker } from '@/components/app-service-worker';
import { PointerLight } from '@/components/pointer-light';
import { cn } from '@/lib/utils';
import './globals.css';

/**
 * ADR 0063: Inter for Latin letters and digits (with its optical sizes, so large titles get the
 * tighter display cut), Noto Sans Bengali for Bangla. Self-hosted by next/font.
 */
// `subsets` only picks the files preloaded with every page; the others still load when a letter needs them.
// Preloading all three cost 309 KB before the page's code on a slow phone (the founder's video, 2026-11-19):
// now only basic Latin (72 KB). Latin-ext (131 KB: ā, ş, ₫…) and Bangla (106 KB) come when used, and
// until the Bangla font arrives an Android phone shows its own Bangla letters (display: swap).
const inter = Inter({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-inter',
  display: 'swap',
});
const bengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  preload: false,
  variable: '--font-bengali',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: t('tagline'),
    applicationName: t('appName'),
    // The installable app and the Android app on Google Play read this (ADR 0065).
    manifest: '/manifest.webmanifest',
  };
}

export const viewport: Viewport = {
  // The founder's grey (ADR 0063): the phone's status bar matches the page.
  themeColor: '#2b2d31',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

/**
 * The browser gets only `common` here. Each part of the app sends its own words from its own layout
 * (`AllMessages`), and the home page only the 3D day's: this layout stays mounted when a visitor moves
 * between parts, so the words cannot be trimmed here per page, and sending all of them made the home page
 * 486 KB in English and 729 KB in Bangla before any picture (the founder's phone video, 2026-11-19).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html lang={locale} className={cn(inter.variable, bengali.variable)} suppressHydrationWarning>
      <body>
        <div aria-hidden className="aurora">
          <span />
          <span />
        </div>
        <PointerLight />
        <AppServiceWorker />
        <NextIntlClientProvider messages={{ common: messages.common }}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
