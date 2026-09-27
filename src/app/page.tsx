import { Languages, ShieldCheck, WifiOff } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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
    { icon: <WifiOff />, title: tl('featureOfflineTitle'), body: tl('featureOfflineBody') },
    { icon: <ShieldCheck />, title: tl('featureLeaksTitle'), body: tl('featureLeaksBody') },
    { icon: <Languages />, title: tl('featureLanguageTitle'), body: tl('featureLanguageBody') },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 py-5">
      <header className="glass mx-auto flex w-full max-w-3xl items-center justify-between rounded-full py-1.5 ps-2 pe-1.5">
        <span className="flex items-center gap-2">
          <Image src="/brand/logo-64.png" alt="" width={30} height={30} className="rounded-full" />
          <span className="text-brand text-lg font-extrabold tracking-tight">{t('appName')}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <LocaleSwitcher />
          <Link href="/sign-in" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('signIn')}
          </Link>
        </div>
      </header>

      <section className="relative mt-14 flex flex-1 flex-col items-center sm:mt-20">
        {/* The oversized wordmark sits behind the glass, like the reference layouts. */}
        <p
          aria-hidden
          className="text-brand pointer-events-none absolute -top-6 text-[clamp(4.5rem,17vw,12rem)] leading-none font-black tracking-[-0.06em] opacity-80 select-none"
        >
          {t('appName')}
        </p>
        <div className="glass-strong relative mt-16 w-full max-w-3xl rounded-sheet p-7 sm:mt-24 sm:p-10">
          <p className="text-sm font-semibold tracking-[0.18em] text-cyan uppercase">
            {tl('eyebrow')}
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.03em] sm:text-6xl">
            {tl('headline')}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-secondary">{t('tagline')}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-up" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              {t('signUp')}
            </Link>
            <Link href="/sign-in" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
              {t('signIn')}
            </Link>
          </div>
        </div>

        <div className="mt-8 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="glass rounded-card p-5">
              <span
                aria-hidden
                className="glass-tile inline-flex size-11 items-center justify-center rounded-input text-cyan [&>svg]:size-5"
              >
                {f.icon}
              </span>
              <h2 className="mt-4 font-bold">{f.title}</h2>
              <p className="mt-1 text-sm text-secondary">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
