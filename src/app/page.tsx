import { Languages, ShieldCheck, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BrandMark } from '@/components/brand-mark';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { buttonVariants } from '@/components/ui/button';
import { createClient } from '@/lib/db/supabase-server';

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: orgs } = await supabase
      .from('organizations')
      .select('slug')
      .order('name')
      .limit(1);
    const first = orgs?.[0];
    redirect(first ? `/${first.slug}` : '/onboarding');
  }

  const [t, tl] = await Promise.all([getTranslations('common'), getTranslations('landing')]);
  const features = [
    { icon: <ShieldCheck />, title: tl('featureLeaksTitle'), body: tl('featureLeaksBody') },
    { icon: <WifiOff />, title: tl('featureOfflineTitle'), body: tl('featureOfflineBody') },
    { icon: <Languages />, title: tl('featureLanguageTitle'), body: tl('featureLanguageBody') },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 py-5 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <BrandMark name={t('appName')} />
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <Link href="/sign-in" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('signIn')}
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center">
        <section className="relative mt-16 flex w-full max-w-3xl flex-col items-center text-center sm:mt-24">
          <div
            aria-hidden
            className="bg-brand pointer-events-none absolute -top-10 left-1/2 -z-10 h-56 w-[min(40rem,90vw)] -translate-x-1/2 rounded-full opacity-[0.12] blur-3xl"
          />
          <p className="inline-flex items-center rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-purple shadow-soft">
            {tl('eyebrow')}
          </p>
          <h1 className="mt-5 text-4xl font-bold tracking-[-0.035em] text-balance sm:text-6xl">
            {tl('headline')}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-balance text-secondary">{t('tagline')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/sign-up" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              {t('signUp')}
            </Link>
            <Link href="/sign-in" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
              {t('signIn')}
            </Link>
          </div>
        </section>

        <ul className="mt-16 mb-10 grid w-full max-w-4xl gap-4 sm:mt-20 sm:grid-cols-3">
          {features.map((f) => (
            <li
              key={f.title}
              className="rounded-card border border-line bg-surface p-5 shadow-soft"
            >
              <span
                aria-hidden
                className="inline-flex size-10 items-center justify-center rounded-xl bg-purple/10 text-purple [&>svg]:size-5"
              >
                {f.icon}
              </span>
              <h2 className="mt-4 font-semibold">{f.title}</h2>
              <p className="mt-1 text-sm text-secondary">{f.body}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
