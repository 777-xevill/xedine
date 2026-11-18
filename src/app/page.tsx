import { redirect } from 'next/navigation';
import { DayPage } from '@/components/landing-3d/day-page';
import { SiteFooter } from '@/components/landing-3d/site-footer';
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

  // The end of the page: a last ask, the footer's columns and the privacy and terms links (Google and Meta
  // check them for sign-in).
  return <DayPage footer={<SiteFooter />} />;
}
