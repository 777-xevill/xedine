import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next 16 "proxy" (formerly middleware). Refreshes the Supabase session cookie on every request and
 * sends signed-out visitors to /sign-in. Authorization itself lives in RLS, never here.
 */
// /t/ is the customer-facing QR table page (no account); /api/jobs authenticates with a shared secret.
const PUBLIC_PREFIXES = ['/sign-in', '/sign-up', '/api/health', '/api/jobs', '/t/'];

export async function proxy(request: NextRequest) {
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
  const isPublic = pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/sign-in';
    redirect.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(redirect);
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
