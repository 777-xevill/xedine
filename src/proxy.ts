import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { APP_COOKIE, APP_COOKIE_MAX_AGE, APP_COOKIE_VALUE, isAppLaunch } from '@/lib/android-app';

/**
 * Next 16 "proxy" (formerly middleware). Refreshes the Supabase session cookie on every request and
 * sends signed-out visitors to /sign-in. Authorization itself lives in RLS, never here.
 */
// /t/ is the customer-facing QR table page (no account); /api/jobs authenticates with a shared secret;
// /api/webhooks verifies the provider's signature.
const PUBLIC_PREFIXES = [
  '/sign-in',
  '/sign-up',
  // An invited person lands here first; the page itself offers sign-up or accept.
  '/accept-invite',
  // Facebook sign-in returns here before there is a session (ADR 0041).
  '/auth/callback',
  // The link in the "confirm your email" message (opened on any device, signed out).
  '/auth/confirm',
  '/api/health',
  '/api/jobs',
  '/api/webhooks',
  // The post-meal feedback page: a customer with a link, no account.
  '/f/',
  // A customer's complaint through the branch's QR code (ADR 0043).
  '/c/',
  // A customer's read-only member card (ADR 0042): the link token is the credential.
  '/m/',
  '/t/',
  // Privacy policy and terms: Google requires them to be public (ADR 0050).
  '/privacy',
  '/data-deletion',
  '/terms',
  // The hidden look test of the landing page's 3D character (ADR 0064), before it replaces the landing page.
  '/landing-preview',
];

export async function proxy(request: NextRequest) {
  // One address only. Google and Facebook send the person back to the main address, and the sign-in
  // cookie set on www would not travel with them, so a sign-in begun on www always failed.
  const host = request.nextUrl.host;
  if (host.startsWith('www.')) {
    const main = request.nextUrl.clone();
    main.host = host.slice(4);
    return NextResponse.redirect(main, 308);
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the token with the auth server; getSession() would trust a cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  // The Android app (ADR 0065) opens /?source=app. Someone signed out goes straight to sign-in, not
  // to the 3D café; someone signed in goes on to their restaurant (the home page does that).
  const appLaunch = isAppLaunch(pathname, request.nextUrl.searchParams);
  if (appLaunch && !user) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/sign-in';
    signIn.search = '';
    return rememberApp(NextResponse.redirect(signIn));
  }

  const isPublic = pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/sign-in';
    redirect.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(redirect);
  }
  return appLaunch ? rememberApp(response) : response;
}

/** "This phone uses the Android app" (ADR 0065), renewed at every app launch. */
function rememberApp(response: NextResponse): NextResponse {
  response.cookies.set(APP_COOKIE, APP_COOKIE_VALUE, {
    path: '/',
    maxAge: APP_COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: true,
    httpOnly: true,
  });
  return response;
}

export const config = {
  matcher: [
    // sw.js must load even after the session expires: a redirected service-worker script fails.
    // The landing page's 3D files (ADR 0064) are public, static and fetched by every visitor.
    // The web manifest and /.well-known/assetlinks.json (ADR 0065) must load signed out: Chrome and
    // Google Play read them to trust the Android app.
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|offline\\.html|brand/|landing/|\\.well-known/|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|glb|ktx2)$).*)',
  ],
};
