import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import { now } from '@/lib/time/clock';
import { makeState, metaConfigured, oauthUrl } from '@/modules/social/meta';
import { getOrgContext } from '@/modules/tenancy/context';

/**
 * Settings → Social → "Connect Facebook & Instagram" (ADR 0040): the owner is sent to Facebook's sign-in
 * with a signed state naming the org and the user, so the callback cannot be replayed for someone else.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('org') ?? '';
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug))
    return NextResponse.json({}, { status: 404 });
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/${slug}/settings/social?meta=${q}`, site));
  if (!metaConfigured()) return back('not_configured');
  const ctx = await getOrgContext(slug);
  if (!ctx.isOwner) return back('not_owner');
  const state = makeState(ctx.org.id, ctx.user.id, now().getTime());
  return NextResponse.redirect(oauthUrl(state, `${site}/api/social/meta/callback`));
}
