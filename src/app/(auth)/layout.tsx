import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BrandMark } from '@/components/brand-mark';
import { LocaleSwitcher } from '@/components/locale-switcher';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const [t, tl] = await Promise.all([getTranslations('common'), getTranslations('legal')]);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-5">
      <header className="mb-10 flex items-center justify-between gap-3">
        <Link href="/">
          <BrandMark name={t('appName')} />
        </Link>
        <LocaleSwitcher />
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-8 flex justify-center gap-4 text-xs text-muted">
        <Link href="/privacy" className="hover:underline">
          {tl('privacyLink')}
        </Link>
        <Link href="/terms" className="hover:underline">
          {tl('termsLink')}
        </Link>
      </footer>
    </div>
  );
}
