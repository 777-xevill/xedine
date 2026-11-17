import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DayPage } from '@/components/landing-3d/day-page';
import { createClient } from '@/lib/db/supabase-server';

/**
 * The home page is one day in a café with Xedine, in real-time 3D (ADR 0064, step 4, the founder's choice
 * 2026-11-18). Someone already signed in goes straight to their restaurant.
 */
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

  const [t, tl, tlegal] = await Promise.all([
    getTranslations('common'),
    getTranslations('landing'),
    getTranslations('legal'),
  ]);

  // The privacy and terms links stay on the home page: Google and Meta check them for sign-in.
  const footer = (
    <footer className="border-t border-[color-mix(in_srgb,var(--brand-silver)_14%,transparent)] bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-[color:var(--text-muted)] sm:flex-row sm:px-8">
        <span className="inline-flex items-center gap-2.5">
          <Image
            src="/brand/logo-chef-192.png"
            alt=""
            width={30}
            height={30}
            className="rounded-[21%]"
          />
          <span className="text-base font-bold tracking-tight text-[var(--brand-silver)]">
            {t('appName')}
          </span>
        </span>
        <p>{tl('footer')}</p>
        <nav className="flex gap-4">
          <Link href="/privacy" className="hover:text-[var(--brand-silver)] hover:underline">
            {tlegal('privacyLink')}
          </Link>
          <Link href="/terms" className="hover:text-[var(--brand-silver)] hover:underline">
            {tlegal('termsLink')}
          </Link>
        </nav>
      </div>
    </footer>
  );

  return <DayPage footer={footer} />;
}
