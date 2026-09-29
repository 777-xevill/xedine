import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BrandMark } from '@/components/brand-mark';
import { LocaleSwitcher } from '@/components/locale-switcher';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('common');
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-5">
      <header className="mb-10 flex items-center justify-between gap-3">
        <Link href="/">
          <BrandMark name={t('appName')} />
        </Link>
        <LocaleSwitcher />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
