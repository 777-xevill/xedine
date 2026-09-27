import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('common');
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <header className="glass mb-10 flex items-center justify-between rounded-full py-1.5 ps-2 pe-1.5">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/brand/logo-64.png" alt="" width={30} height={30} className="rounded-full" />
          <span className="text-brand text-xl font-extrabold tracking-tight">{t('appName')}</span>
        </Link>
        <LocaleSwitcher />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
