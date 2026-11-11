import { describe, expect, it } from 'vitest';
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  generateVapidKeys,
  sendWebPush,
  vapidAuthorization,
} from './web-push';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

/** A phone: its own key pair and auth secret, the way a browser makes them. */
async function phone() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const pub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return {
    pair,
    pub,
    auth,
    target: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      p256dh: b64urlEncode(pub),
      auth: b64urlEncode(auth),
    },
  };
}

async function hkdf(
  secret: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bits: number,
) {
  const key = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits),
  );
}

/** What the phone does with a push body (RFC 8291 section 4). */
async function decrypt(p: Awaited<ReturnType<typeof phone>>, body: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer).getUint32(16);
  const idLen = body[20]!;
  const asPublic = body.slice(21, 21 + idLen);
  const cipher = body.slice(21 + idLen);
  expect(rs).toBe(4096);
  const asKey = await subtle.importKey(
    'raw',
    asPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: asKey }, p.pair.privateKey, 256),
  );
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...p.pub, ...asPublic]);
  const ikm = await hkdf(shared, p.auth, info, 256);
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 96);
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
  expect(plain.at(-1)).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe('web push', () => {
  it('base64url round-trips bytes', () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255, 1, 2]);
    expect(b64urlEncode(bytes)).not.toMatch(/[+/=]/);
    expect([...b64urlDecode(b64urlEncode(bytes))]).toEqual([...bytes]);
  });

  it('encrypts so only the phone can read it, including Bangla text', async () => {
    const p = await phone();
    const message = JSON.stringify({ title: 'কাচ্চি হাউস', body: 'আপনার জন্য বিশেষ অফার' });
    const body = await encryptPayload(p.target, message);
    expect(await decrypt(p, body)).toBe(message);
    // A second message uses fresh randomness, so the bytes differ.
    const again = await encryptPayload(p.target, message);
    expect(b64urlEncode(again)).not.toBe(b64urlEncode(body));
    // Another phone cannot open it.
    const other = await phone();
    await expect(decrypt({ ...other }, body)).rejects.toThrow();
  });

  it('signs a VAPID token the public key verifies, for the push service origin', async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization({
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/xyz',
      keys,
      subject: 'https://xedine.org',
      nowMs: Date.UTC(2026, 10, 13),
    });
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, s, k] = m!;
    expect(k).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c!)));
    expect(claims).toEqual({
      aud: 'https://updates.push.services.mozilla.com',
      exp: Math.floor(Date.UTC(2026, 10, 13) / 1000) + 43200,
      sub: 'https://xedine.org',
    });
    const pub = await subtle.importKey(
      'raw',
      b64urlDecode(k!),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      b64urlDecode(s!),
      enc.encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it('reports sent, gone (404/410) and failed from the push service', async () => {
    const keys = await generateVapidKeys();
    const p = await phone();
    const run = (status: number) =>
      sendWebPush({
        target: p.target,
        message: 'hi',
        keys,
        subject: 'https://xedine.org',
        nowMs: 0,
        fetcher: (async () => new Response(null, { status })) as typeof fetch,
      });
    expect(await run(201)).toBe('sent');
    expect(await run(410)).toBe('gone');
    expect(await run(404)).toBe('gone');
    expect(await run(500)).toBe('failed');
  });
});
