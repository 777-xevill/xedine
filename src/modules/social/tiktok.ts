import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * TikTok publishing through the Content Posting API (ADR 0041). Free; needs a TikTok developer app
 * (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET) with Login Kit and Content Posting (video.upload for drafts,
 * video.publish for direct posts). Until TikTok audits the app, direct posts can only be private
 * (SELF_ONLY); drafts land in the owner's TikTok inbox and are posted from the app with one tap.
 *
 * The video is uploaded by Xedine (FILE_UPLOAD), not pulled by URL: pulling needs a domain verified with
 * TikTok, and the reels sit on Supabase's storage domain.
 */
const API = 'https://open.tiktokapis.com/v2';

export const TIKTOK_SCOPES = ['user.info.basic', 'video.upload', 'video.publish'];
/** TikTok counts the title in UTF-16 units; 2,200 is its limit. */
const TITLE_MAX = 2200;

export type TikTokMode = 'draft' | 'direct';

export function tiktokConfigured(): boolean {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

export class TikTokError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

/** TikTok answers `{ data, error: { code: 'ok' | … } }`; anything but 'ok' is a failure. */
async function api<T>(
  path: string,
  token: string,
  body: unknown,
  fetchImpl: Fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string };
  };
  const code = json.error?.code ?? null;
  if (!res.ok || (code && code !== 'ok') || !json.data)
    throw new TikTokError(
      (json.error?.message || code || `HTTP ${res.status}`).slice(0, 300),
      code ?? null,
    );
  return json.data;
}

// ---------------------------------------------------------------------------------------------
// Connect: OAuth with a signed state, like Facebook's (meta.ts), keyed on the TikTok secret.
// ---------------------------------------------------------------------------------------------

function sign(payload: string): string {
  return createHmac('sha256', process.env.TIKTOK_CLIENT_SECRET ?? '')
    .update(`tiktok.${payload}`)
    .digest('base64url');
}

/** state = orgId.userId.issuedAtMs.signature — valid for 30 minutes. */
export function makeTikTokState(orgId: string, userId: string, issuedAtMs: number): string {
  const payload = `${orgId}.${userId}.${issuedAtMs}`;
  return `${payload}.${sign(payload)}`;
}

export function readTikTokState(
  state: string,
  nowMs: number,
): { orgId: string; userId: string } | null {
  const parts = state.split('.');
  if (parts.length !== 4) return null;
  const [orgId, userId, issued, sig] = parts as [string, string, string, string];
  const expected = Buffer.from(sign(`${orgId}.${userId}.${issued}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!(nowMs - Number(issued) >= 0 && nowMs - Number(issued) < 30 * 60_000)) return null;
  return { orgId, userId };
}

export function tiktokOauthUrl(state: string, redirectUri: string): string {
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', process.env.TIKTOK_CLIENT_KEY ?? '');
  url.searchParams.set('scope', TIKTOK_SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export interface TikTokTokens {
  openId: string;
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working (TikTok: 24 hours). */
  expiresAt: Date;
}

async function tokenRequest(
  params: Record<string, string>,
  at: Date,
  fetchImpl: Fetch = fetch,
): Promise<TikTokTokens> {
  const res = await fetchImpl(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
      client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
      ...params,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    open_id?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token || !json.open_id || !json.refresh_token)
    throw new TikTokError(
      (json.error_description || json.error || `HTTP ${res.status}`).slice(0, 300),
      json.error ?? null,
    );
  return {
    openId: json.open_id,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(at.getTime() + (json.expires_in ?? 86_400) * 1000),
  };
}

export function exchangeTikTokCode(
  code: string,
  redirectUri: string,
  at: Date,
  fetchImpl?: Fetch,
): Promise<TikTokTokens> {
  return tokenRequest(
    { code, grant_type: 'authorization_code', redirect_uri: redirectUri },
    at,
    fetchImpl,
  );
}

/** A fresh access token; TikTok may also hand back a new refresh token, which must replace the old. */
export function refreshTikTokToken(
  refreshToken: string,
  at: Date,
  fetchImpl?: Fetch,
): Promise<TikTokTokens> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }, at, fetchImpl);
}

export async function tiktokDisplayName(token: string, fetchImpl: Fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${API}/user/info/?fields=open_id,display_name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { user?: { display_name?: string } };
  };
  return json.data?.user?.display_name?.slice(0, 200) || 'TikTok';
}

// ---------------------------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------------------------

/** Direct posts must use a privacy level TikTok offers this creator: public if it can, else private. */
export function pickPrivacy(options: string[]): string {
  if (options.includes('PUBLIC_TO_EVERYONE')) return 'PUBLIC_TO_EVERYONE';
  if (options.includes('SELF_ONLY')) return 'SELF_ONLY';
  return options[0] ?? 'SELF_ONLY';
}

export function tiktokTitle(caption: string): string {
  return caption.length <= TITLE_MAX ? caption : `${caption.slice(0, TITLE_MAX - 1)}…`;
}

async function creatorPrivacy(token: string, fetchImpl?: Fetch): Promise<string[]> {
  const data = await api<{ privacy_level_options?: string[] }>(
    '/post/publish/creator_info/query/',
    token,
    {},
    fetchImpl,
  );
  return data.privacy_level_options ?? [];
}

/**
 * Start a post and upload the video in one piece (TikTok takes a single chunk up to 64 MB; reels are a
 * few MB). Returns the publish id to poll with `tiktokPublishStatus`.
 */
export async function startTikTokPost(
  token: string,
  mode: TikTokMode,
  video: Uint8Array<ArrayBuffer>,
  caption: string,
  fetchImpl: Fetch = fetch,
): Promise<string> {
  const source_info = {
    source: 'FILE_UPLOAD',
    video_size: video.byteLength,
    chunk_size: video.byteLength,
    total_chunk_count: 1,
  };
  const init = async (privacy: string | null) =>
    mode === 'draft'
      ? api<{ publish_id: string; upload_url: string }>(
          '/post/publish/inbox/video/init/',
          token,
          { source_info },
          fetchImpl,
        )
      : api<{ publish_id: string; upload_url: string }>(
          '/post/publish/video/init/',
          token,
          {
            post_info: {
              title: tiktokTitle(caption),
              privacy_level: privacy,
              disable_comment: false,
              disable_duet: false,
              disable_stitch: false,
            },
            source_info,
          },
          fetchImpl,
        );

  let started: { publish_id: string; upload_url: string };
  if (mode === 'draft') started = await init(null);
  else {
    const privacy = pickPrivacy(await creatorPrivacy(token, fetchImpl));
    try {
      started = await init(privacy);
    } catch (e) {
      // An app TikTok has not audited yet may only post privately: try once more as SELF_ONLY.
      if (
        !(e instanceof TikTokError) ||
        privacy === 'SELF_ONLY' ||
        !/unaudited/i.test(e.code ?? '')
      )
        throw e;
      started = await init('SELF_ONLY');
    }
  }

  const up = await fetchImpl(started.upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(video.byteLength),
      'Content-Range': `bytes 0-${video.byteLength - 1}/${video.byteLength}`,
    },
    body: video,
  });
  if (!up.ok) throw new TikTokError(`upload HTTP ${up.status}`, null);
  return started.publish_id;
}

export type TikTokProgress =
  { state: 'done'; postId: string } | { state: 'processing' } | { state: 'failed'; reason: string };

/**
 * Where a started post is. A draft is done once it reached the owner's inbox; a direct post once it is
 * published (its public id, or the publish id when TikTok keeps it private and gives none).
 */
export async function tiktokPublishStatus(
  token: string,
  publishId: string,
  fetchImpl?: Fetch,
): Promise<TikTokProgress> {
  const data = await api<{
    status?: string;
    fail_reason?: string;
    publicaly_available_post_id?: (string | number)[];
  }>('/post/publish/status/fetch/', token, { publish_id: publishId }, fetchImpl);
  switch (data.status) {
    case 'SEND_TO_USER_INBOX':
      return { state: 'done', postId: `inbox:${publishId}` };
    case 'PUBLISH_COMPLETE': {
      const id = data.publicaly_available_post_id?.[0];
      return { state: 'done', postId: id != null ? String(id) : publishId };
    }
    case 'FAILED':
      return { state: 'failed', reason: (data.fail_reason ?? 'failed').slice(0, 200) };
    default:
      return { state: 'processing' };
  }
}
