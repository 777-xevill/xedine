import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { Inter, Noto_Sans_Bengali } from 'next/font/google';
import { getLocale, getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';
import './globals.css';

/** ADR 0063: Inter for Latin letters and digits, Noto Sans Bengali for Bangla. Self-hosted by next/font. */
const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' });
const bengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  variable: '--font-bengali',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: t('tagline'),
    applicationName: t('appName'),
  };
}

export const viewport: Viewport = {
  // The founder's grey (ADR 0063): the phone's status bar matches the page.
  themeColor: '#2b2d31',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={cn(inter.variable, bengali.variable)} suppressHydrationWarning>
      <body>
        <div aria-hidden className="aurora" />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
