import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/db/supabase-server';
import { publicEnv } from '@/lib/env';
import { now } from '@/lib/time/clock';
import { connectTikTok } from '@/modules/social/connect';
import { exchangeTikTokCode, readTikTokState, tiktokDisplayName } from '@/modules/social/tiktok';

/**
 * TikTok sends the owner back here after they allowed Xedine (ADR 0041). The account is connected at
 * once; its tokens are written with the service role only.
 */
export async function GET(request: NextRequest) {
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const params = request.nextUrl.searchParams;
  const at = now();
  const state = readTikTokState(params.get('state') ?? '', at.getTime());
  if (!state) return NextResponse.redirect(new URL('/', site));
  // The browser that comes back must be the owner who started the connect; their session reads the org.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: org } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', state.orgId)
    .maybeSingle();
  if (!org) return NextResponse.redirect(new URL('/', site));
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/${String(org.slug)}/settings/social?tiktok=${q}`, site));
  if (!user || user.id !== state.userId) return back('wrong_user');
  const code = params.get('code');
  if (!code) return back('cancelled');

  try {
    const tokens = await exchangeTikTokCode(code, `${site}/api/social/tiktok/callback`, at);
    const name = await tiktokDisplayName(tokens.accessToken);
    await connectTikTok(state.orgId, state.userId, tokens, name);
    return back('connected');
  } catch (e) {
    console.error('tiktok connect', e instanceof Error ? e.message.slice(0, 200) : e);
    return back('failed');
  }
}
