/**
 * Browser push without a library (ADR 0048): VAPID (RFC 8292) to identify Xedine, and aes128gcm
 * (RFC 8291 / RFC 8188) to encrypt the message so only the customer's phone can read it. WebCrypto only,
 * so it runs the same on the Cloudflare Worker and in tests. No clock here: the caller passes `nowMs`.
 */
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array<ArrayBuffer> {
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface VapidKeys {
  /** The 65-byte public key, URL-safe base64: what a browser's subscribe() takes. */
  publicKey: string;
  /** The private key as a JSON Web Key string. */
  privateJwk: string;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const jwk = await subtle().exportKey('jwk', pair.privateKey);
  return { publicKey: b64urlEncode(raw), privateJwk: JSON.stringify(jwk) };
}

/** The signed token that goes in the Authorization header: audience = the push service's own origin. */
export async function vapidAuthorization(args: {
  endpoint: string;
  keys: VapidKeys;
  subject: string;
  nowMs: number;
}): Promise<string> {
  const aud = new URL(args.endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    enc.encode(
      JSON.stringify({
        aud,
        exp: Math.floor(args.nowMs / 1000) + 12 * 60 * 60,
        sub: args.subject,
      }),
    ),
  );
  const key = await subtle().importKey(
    'jwk',
    JSON.parse(args.keys.privateJwk) as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto already returns the raw r||s signature that JWT's ES256 wants.
  const sig = new Uint8Array(
    await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)),
  );
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${args.keys.publicKey}`;
}

async function hkdf(
  secret: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bits: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits),
  );
}

export interface PushTarget {
  endpoint: string;
  /** The phone's public key, URL-safe base64. */
  p256dh: string;
  /** The phone's auth secret, URL-safe base64. */
  auth: string;
}

/** The encrypted request body for one message to one phone (RFC 8291). */
export async function encryptPayload(
  target: PushTarget,
  message: string,
  fixed?: { salt: Uint8Array<ArrayBuffer>; senderKeys: CryptoKeyPair },
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(target.p256dh);
  const authSecret = b64urlDecode(target.auth);
  const sender =
    fixed?.senderKeys ??
    (await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await subtle().exportKey('raw', sender.publicKey));
  const uaKey = await subtle().importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await subtle().deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256),
  );
  const salt = fixed?.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(
    shared,
    authSecret,
    concat(enc.encode('WebPush: info\0'), uaPublic, asPublic),
    256,
  );
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 96);
  const aes = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the message, then 0x02 marks it as the last record.
  const plain = concat(enc.encode(message), new Uint8Array([2]));
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPublic.length;
  return concat(head, asPublic, cipher);
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Sends one message. 'gone' means the browser says this subscription no longer exists (switch it off). */
export async function sendWebPush(args: {
  target: PushTarget;
  message: string;
  keys: VapidKeys;
  subject: string;
  nowMs: number;
  fetcher?: typeof fetch;
}): Promise<PushOutcome> {
  const body = await encryptPayload(args.target, args.message);
  const authorization = await vapidAuthorization({
    endpoint: args.target.endpoint,
    keys: args.keys,
    subject: args.subject,
    nowMs: args.nowMs,
  });
  const res = await (args.fetcher ?? fetch)(args.target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  return res.ok ? 'sent' : 'failed';
}
