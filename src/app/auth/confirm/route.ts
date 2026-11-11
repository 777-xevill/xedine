import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/db/supabase-server';
import { publicEnv } from '@/lib/env';
import { safeNext } from '@/modules/tenancy/form-state';

const TYPES = new Set<EmailOtpType>([
  'signup',
  'email',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
]);

/**
 * The link in Xedine's emails ("Confirm your email"). The one-time token becomes the session here, on
 * whatever phone or computer opened the link, and replaces anyone already signed in on that browser
 * (before, a phone signed in as someone else stayed that person). No cookie from the sign-up device is
 * needed, unlike /auth/callback.
 */
export async function GET(request: NextRequest) {
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;
  const next = safeNext(params.get('next'));
  const failed = () => NextResponse.redirect(new URL('/sign-in?error=confirmFailed', site));
  if (!tokenHash || !type || !TYPES.has(type)) return failed();

  const supabase = await createClient();
  // Whoever was signed in on this browser is signed out first, so the new account is the one that opens.
  await supabase.auth.signOut({ scope: 'local' });
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return failed();
  return NextResponse.redirect(new URL(next ?? '/onboarding', site));
}
