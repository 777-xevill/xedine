import { NextIntlClientProvider } from 'next-intl';

/**
 * Every word for one part of the app's browser code. The root layout sends only `common`, so the home page
 * stays light; each part's layout wraps its pages in this.
 */
export function AllMessages({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider>{children}</NextIntlClientProvider>;
}
