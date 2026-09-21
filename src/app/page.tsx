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

  const t = await getTranslations('common');
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-4 py-10">
      <div className="self-end">
        <LocaleSwitcher />
      </div>
      <h1 className="bg-brand bg-clip-text text-5xl font-bold tracking-tight text-transparent">
        {t('appName')}
      </h1>
      <p className="text-xl text-secondary">{t('tagline')}</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/sign-up" className={buttonVariants({ variant: 'primary' })}>
          {t('signUp')}
        </Link>
        <Link href="/sign-in" className={buttonVariants({ variant: 'secondary' })}>
          {t('signIn')}
        </Link>
      </div>
    </div>
  );
}
