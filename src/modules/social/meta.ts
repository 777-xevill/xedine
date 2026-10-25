import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Facebook Pages and Instagram publishing through Meta's Graph API (ADR 0040). Free; needs a Meta app
 * (META_APP_ID / META_APP_SECRET). In Development mode the app can post only to Pages whose admins hold
 * a role on the app; Business Verification + App Review open it to every restaurant.
 *
 * Instagram and Facebook fetch media by public URL, which is why posters and reels sit in the public
 * `social-media` bucket until a few days after they go out.
 */
export const GRAPH_VERSION = 'v25.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** What we ask Facebook for when the owner connects. */
export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
];

export function metaConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export class MetaError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
  }
}

async function graph<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; params?: Record<string, string>; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH}${path}`);
  const method = init.method ?? 'GET';
  let body: URLSearchParams | undefined;
  if (method === 'GET')
    for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);
  else body = new URLSearchParams(init.params ?? {});
  const res = await (init.fetchImpl ?? fetch)(url, { method, body });
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number };
  };
  if (!res.ok || json.error)
    throw new MetaError(
      (json.error?.message ?? `HTTP ${res.status}`).slice(0, 300),
      json.error?.code ?? null,
    );
  return json;
}

// ---------------------------------------------------------------------------------------------
// Connect: OAuth with a signed state, so the callback knows which org and user started it.
// ---------------------------------------------------------------------------------------------

function sign(payload: string): string {
  return createHmac('sha256', process.env.META_APP_SECRET ?? '')
    .update(payload)
    .digest('base64url');
}

/** state = orgId.userId.issuedAtMs.signature — valid for 30 minutes. */
export function makeState(orgId: string, userId: string, issuedAtMs: number): string {
  const payload = `${orgId}.${userId}.${issuedAtMs}`;
  return `${payload}.${sign(payload)}`;
}

export function readState(state: string, nowMs: number): { orgId: string; userId: string } | null {
  const parts = state.split('.');
  if (parts.length !== 4) return null;
  const [orgId, userId, issued, sig] = parts as [string, string, string, string];
  const expected = Buffer.from(sign(`${orgId}.${userId}.${issued}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!(nowMs - Number(issued) >= 0 && nowMs - Number(issued) < 30 * 60_000)) return null;
  return { orgId, userId };
}

export function oauthUrl(state: string, redirectUri: string): string {
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', process.env.META_APP_ID ?? '');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  // A "Business" type app uses a Facebook Login for Business configuration instead of a scope list.
  if (process.env.META_LOGIN_CONFIG_ID)
    url.searchParams.set('config_id', process.env.META_LOGIN_CONFIG_ID);
  else url.searchParams.set('scope', META_SCOPES.join(','));
  return url.toString();
}

/** Code → long-lived user token. Page tokens fetched with it do not expire on their own. */
export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const short = await graph<{ access_token: string }>('/oauth/access_token', {
    params: {
      client_id: process.env.META_APP_ID ?? '',
      client_secret: process.env.META_APP_SECRET ?? '',
      redirect_uri: redirectUri,
      code,
    },
  });
  const long = await graph<{ access_token: string }>('/oauth/access_token', {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.META_APP_ID ?? '',
      client_secret: process.env.META_APP_SECRET ?? '',
      fb_exchange_token: short.access_token,
    },
  });
  return long.access_token;
}

export interface PageOption {
  id: string;
  name: string;
  token: string;
  igId: string | null;
  igName: string | null;
}

export async function listPages(userToken: string): Promise<PageOption[]> {
  const res = await graph<{
    data: {
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id: string; username?: string };
    }[];
  }>('/me/accounts', {
    params: {
      access_token: userToken,
      fields: 'id,name,access_token,instagram_business_account{id,username}',
      limit: '100',
    },
  });
  return res.data.map((p) => ({
    id: p.id,
    name: p.name,
    token: p.access_token,
    igId: p.instagram_business_account?.id ?? null,
    igName: p.instagram_business_account?.username ?? null,
  }));
}

// ---------------------------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------------------------

export async function publishFacebookPhoto(
  pageId: string,
  token: string,
  imageUrl: string,
  caption: string,
): Promise<string> {
  const res = await graph<{ id: string; post_id?: string }>(`/${pageId}/photos`, {
    method: 'POST',
    params: { url: imageUrl, caption, published: 'true', access_token: token },
  });
  return res.post_id ?? res.id;
}

/** Facebook Reels: start an upload, hand Facebook the file's URL, then publish. */
export async function publishFacebookReel(
  pageId: string,
  token: string,
  videoUrl: string,
  caption: string,
): Promise<string> {
  const start = await graph<{ video_id: string; upload_url: string }>(`/${pageId}/video_reels`, {
    method: 'POST',
    params: { upload_phase: 'start', access_token: token },
  });
  const up = await fetch(start.upload_url, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_url: videoUrl },
  });
  if (!up.ok) throw new MetaError(`reel upload HTTP ${up.status}`, null);
  await graph<{ success: boolean }>(`/${pageId}/video_reels`, {
    method: 'POST',
    params: {
      upload_phase: 'finish',
      video_id: start.video_id,
      video_state: 'PUBLISHED',
      description: caption,
      access_token: token,
    },
  });
  return start.video_id;
}

/** Instagram, step 1: a media container (an image, or a reel Instagram processes for a minute or two). */
export async function createInstagramContainer(
  igId: string,
  token: string,
  media: { imageUrl: string } | { videoUrl: string },
  caption: string,
): Promise<string> {
  const params: Record<string, string> =
    'imageUrl' in media
      ? { image_url: media.imageUrl, caption, access_token: token }
      : {
          media_type: 'REELS',
          video_url: media.videoUrl,
          caption,
          share_to_feed: 'true',
          access_token: token,
        };
  const res = await graph<{ id: string }>(`/${igId}/media`, { method: 'POST', params });
  return res.id;
}

export async function instagramContainerStatus(
  containerId: string,
  token: string,
): Promise<string> {
  const res = await graph<{ status_code?: string }>(`/${containerId}`, {
    params: { fields: 'status_code', access_token: token },
  });
  return res.status_code ?? 'IN_PROGRESS';
}

/** Instagram, step 2: publish a finished container. */
export async function publishInstagramContainer(
  igId: string,
  token: string,
  containerId: string,
): Promise<string> {
  const res = await graph<{ id: string }>(`/${igId}/media_publish`, {
    method: 'POST',
    params: { creation_id: containerId, access_token: token },
  });
  return res.id;
}
