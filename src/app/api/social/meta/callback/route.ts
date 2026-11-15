import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/db/supabase-server';
import { publicEnv } from '@/lib/env';
import { now } from '@/lib/time/clock';
import { connectPage, orgExistsForAdmin, storePendingPages } from '@/modules/social/connect';
import { exchangeCode, listPages, readState } from '@/modules/social/meta';

/**
 * Facebook sends the owner back here after they allowed Xedine (ADR 0040). One Page: it is connected at
 * once (with its Instagram account, if linked). Several: they are kept for 30 minutes and the owner
 * picks one on Settings → Social. Tokens are written with the service role only.
 *
 * A platform admin connecting a restaurant's Page for it (ADR 0059) comes back here too: their Facebook
 * account manages many restaurants' Pages, so they always pick the Page on the admin console.
 */
export async function GET(request: NextRequest) {
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const params = request.nextUrl.searchParams;
  const state = readState(params.get('state') ?? '', now().getTime());
  if (!state) return NextResponse.redirect(new URL('/', site));
  // The browser that comes back must be the person who started the connect.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (state.admin) return adminReturn(state, user?.id ?? null, params, site, supabase);

  // The owner's own session reads the org.
  const { data: org } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', state.orgId)
    .maybeSingle();
  if (!org) return NextResponse.redirect(new URL('/', site));
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/${String(org.slug)}/settings/social?meta=${q}`, site));
  if (!user || user.id !== state.userId) return back('wrong_user');
  const code = params.get('code');
  if (!code) return back('cancelled');

  try {
    const token = await exchangeCode(code, `${site}/api/social/meta/callback`);
    const pages = await listPages(token);
    if (pages.length === 0) return back('no_pages');
    if (pages.length === 1) {
      await connectPage(state.orgId, state.userId, pages[0]!);
      return back('connected');
    }
    await storePendingPages(state.orgId, state.userId, pages);
    return back('pick');
  } catch (e) {
    console.error('meta connect', e instanceof Error ? e.message.slice(0, 200) : e);
    return back('failed');
  }
}

async function adminReturn(
  state: { orgId: string; userId: string },
  userId: string | null,
  params: URLSearchParams,
  site: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/admin?meta=${q}&org=${state.orgId}#facebook`, site));
  if (!userId || userId !== state.userId) return back('wrong_user');
  const { data: isAdmin } = await supabase.rpc('am_platform_admin');
  if (isAdmin !== true || !(await orgExistsForAdmin(state.orgId)))
    return NextResponse.redirect(new URL('/', site));
  const code = params.get('code');
  if (!code) return back('cancelled');
  try {
    const token = await exchangeCode(code, `${site}/api/social/meta/callback`);
    const pages = await listPages(token);
    if (pages.length === 0) return back('no_pages');
    await storePendingPages(state.orgId, state.userId, pages);
    return back('pick');
  } catch (e) {
    console.error('meta admin connect', e instanceof Error ? e.message.slice(0, 200) : e);
    return back('failed');
  }
}
