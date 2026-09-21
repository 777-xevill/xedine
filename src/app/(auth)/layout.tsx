import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('common');
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <span className="bg-brand bg-clip-text text-2xl font-bold tracking-tight text-transparent">
          {t('appName')}
        </span>
        <LocaleSwitcher />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
