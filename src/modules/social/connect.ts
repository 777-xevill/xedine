import 'server-only';
import { createServiceRoleClient } from '@/lib/db/service-role';
import type { PageOption } from './meta';
import type { TikTokTokens } from './tiktok';

/**
 * Saving a connected Facebook Page (and the Instagram account linked to it) for an org (ADR 0040), and
 * a TikTok account (ADR 0041).
 * The only place outside jobs that touches Page tokens, so it is the only file allowed the service role
 * here: tokens go straight into service-only tables and never reach a browser. Callers have already
 * proved the signed-in user is the org's owner (signed OAuth state, or getOrgContext).
 * Instagram publishing uses the same Page token.
 */
export type PendingPage = PageOption;
const PENDING_MINUTES = 30;

export async function connectPage(orgId: string, userId: string, page: PendingPage): Promise<void> {
  const sb = createServiceRoleClient();
  const accounts: { platform: 'facebook' | 'instagram'; external_id: string; name: string }[] = [
    { platform: 'facebook', external_id: page.id, name: page.name },
  ];
  if (page.igId)
    accounts.push({
      platform: 'instagram',
      external_id: page.igId,
      name: page.igName ?? page.name,
    });
  // A different Page replaces the old one, so drop what was there first (tokens cascade). TikTok stays.
  const { error: delError } = await sb
    .from('social_accounts')
    .delete()
    .eq('org_id', orgId)
    .in('platform', ['facebook', 'instagram']);
  if (delError) throw delError;
  for (const a of accounts) {
    const { data, error } = await sb
      .from('social_accounts')
      .insert({ org_id: orgId, connected_by: userId, ...a })
      .select('id')
      .single();
    if (error) throw error;
    const { error: tokenError } = await sb
      .from('social_tokens')
      .insert({ account_id: data.id, org_id: orgId, access_token: page.token });
    if (tokenError) throw tokenError;
  }
  await sb.from('social_connect_pending').delete().eq('org_id', orgId).eq('user_id', userId);
}

/** A TikTok account replaces the org's previous one; its tokens go to the service-only table. */
export async function connectTikTok(
  orgId: string,
  userId: string,
  tokens: TikTokTokens,
  name: string,
): Promise<void> {
  const sb = createServiceRoleClient();
  const { error: delError } = await sb
    .from('social_accounts')
    .delete()
    .eq('org_id', orgId)
    .eq('platform', 'tiktok');
  if (delError) throw delError;
  const { data, error } = await sb
    .from('social_accounts')
    .insert({
      org_id: orgId,
      connected_by: userId,
      platform: 'tiktok',
      external_id: tokens.openId,
      name,
    })
    .select('id')
    .single();
  if (error) throw error;
  const { error: tokenError } = await sb.from('social_tokens').insert({
    account_id: data.id,
    org_id: orgId,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.expiresAt.toISOString(),
  });
  if (tokenError) throw tokenError;
}

/** Facebook offered several Pages: keep them (tokens included) until the owner picks one. */
export async function storePendingPages(
  orgId: string,
  userId: string,
  pages: PendingPage[],
): Promise<void> {
  const sb = createServiceRoleClient();
  await sb.from('social_connect_pending').delete().eq('org_id', orgId);
  const { error } = await sb
    .from('social_connect_pending')
    .insert({ org_id: orgId, user_id: userId, pages });
  if (error) throw error;
}

async function latestPending(orgId: string, userId: string, at: Date): Promise<PendingPage[]> {
  const since = new Date(at.getTime() - PENDING_MINUTES * 60_000).toISOString();
  const { data } = await createServiceRoleClient()
    .from('social_connect_pending')
    .select('pages')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.pages ?? []) as PendingPage[];
}

/** The offered Pages by name only, for the picker: tokens stay on the server. */
export async function pendingPageNames(
  orgId: string,
  userId: string,
  at: Date,
): Promise<{ id: string; name: string; igName: string | null }[]> {
  return (await latestPending(orgId, userId, at)).map((p) => ({
    id: p.id,
    name: p.name,
    igName: p.igName,
  }));
}

/** Connect the Page the owner picked. False when the offer has expired or the Page is not in it. */
export async function connectPendingPage(
  orgId: string,
  userId: string,
  pageId: string,
  at: Date,
): Promise<boolean> {
  const page = (await latestPending(orgId, userId, at)).find((p) => p.id === pageId);
  if (!page) return false;
  await connectPage(orgId, userId, page);
  return true;
}
