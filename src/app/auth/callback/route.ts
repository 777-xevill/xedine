import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/db/supabase-server';
import { publicEnv } from '@/lib/env';
import { safeNext } from '@/modules/tenancy/form-state';
import { oauthErrorKey } from '@/modules/tenancy/oauth';

/**
 * Facebook sign-in comes back here through Supabase Auth (ADR 0041). The code becomes a session cookie;
 * then the person goes where they were headed, or home, which sends a new account to /onboarding.
 */
export async function GET(request: NextRequest) {
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get('next'));
  const failed = (key: string) => {
    const url = new URL('/sign-in', site);
    url.searchParams.set('error', key);
    if (next) url.searchParams.set('next', next);
    return NextResponse.redirect(url);
  };
  const code = params.get('code');
  if (!code) return failed(oauthErrorKey(params.get('error_description')));
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return failed(oauthErrorKey(error.message));
  return NextResponse.redirect(new URL(next ?? '/', site));
}
