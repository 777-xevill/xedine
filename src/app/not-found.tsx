import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';

/** A page that is not there (ADR 0063): the chef floats in the light, with one way home. */
export default async function NotFound() {
  const [t, tc] = await Promise.all([getTranslations('pageStates'), getTranslations('common')]);
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <div aria-hidden className="auth-halo" />
      <div className="card-glass animate-[sheet-in_0.6s_var(--ease-spring)_both] w-full max-w-md rounded-sheet border p-8 text-center">
        <Image
          src="/brand/logo-chef-192.png"
          alt=""
          width={72}
          height={72}
          className="landing-float mx-auto rounded-[24%] shadow-soft ring-1 ring-edge"
        />
        <h1 className="mt-6 text-2xl font-bold tracking-[-0.03em]">{t('notFoundTitle')}</h1>
        <p className="mt-2 text-secondary">{t('notFoundBody')}</p>
        <Link href="/" className={buttonVariants({ className: 'mt-7' })}>
          {tc('backHome')}
        </Link>
      </div>
    </main>
  );
}
