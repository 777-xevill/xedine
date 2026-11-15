import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { publicEnv } from '@/lib/env';
import { now } from '@/lib/time/clock';
import { orgExistsForAdmin } from '@/modules/social/connect';
import { makeState, metaConfigured, oauthUrl } from '@/modules/social/meta';

/**
 * Admin console → "Connect for this restaurant" (ADR 0059): the restaurant gave Xedine's Facebook account
 * access to its Page, so a platform admin signs in to Facebook and connects that Page to the restaurant.
 * Same callback as the owner's connect; the signed state marks it as an admin connect.
 */
export async function GET(request: NextRequest) {
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const orgId = z.uuid().safeParse(request.nextUrl.searchParams.get('org'));
  if (!orgId.success) return NextResponse.json({}, { status: 404 });
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/admin?meta=${q}&org=${orgId.data}#facebook`, site));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/sign-in?next=/admin', site));
  const { data: isAdmin } = await supabase.rpc('am_platform_admin');
  if (isAdmin !== true || !(await orgExistsForAdmin(orgId.data)))
    return NextResponse.json({}, { status: 404 });
  if (!metaConfigured()) return back('not_configured');
  const state = makeState(orgId.data, user.id, now().getTime(), 'admin');
  return NextResponse.redirect(oauthUrl(state, `${site}/api/social/meta/callback`));
}
