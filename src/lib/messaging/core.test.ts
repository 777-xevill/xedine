import { describe, expect, it } from 'vitest';
import {
  backoffMinutes,
  drainOutbox,
  MAX_ATTEMPTS,
  maskPhone,
  mockTransport,
  whatsappTransport,
  type MessagingTransport,
  type OutboundMessage,
  type OutboxStore,
} from './core';
import { normalizeBdPhone } from './phone';

function memoryOutbox(
  rows: (OutboundMessage & { status: string; next: string; error?: string; providerId?: string })[],
) {
  const store: OutboxStore = {
    due: async (nowIso) =>
      rows.filter((r) => r.status === 'queued' && r.next <= nowIso).map((r) => ({ ...r })),
    claim: async (id) => {
      const r = rows.find((x) => x.id === id)!;
      if (r.status !== 'queued') return false;
      r.status = 'sending';
      return true;
    },
    sent: async (id, providerId) => {
      Object.assign(
        rows.find((x) => x.id === id)!,
        { status: 'sent', providerId },
      );
    },
    retry: async (id, attempts, next, error) => {
      Object.assign(
        rows.find((x) => x.id === id)!,
        { status: 'queued', attempts, next, error },
      );
    },
    failed: async (id, attempts, error) => {
      Object.assign(
        rows.find((x) => x.id === id)!,
        { status: 'failed', attempts, error },
      );
    },
  };
  return { store, rows };
}

const msg = (id: string, attempts = 0) => ({
  id,
  orgId: 'org',
  toPhone: '+8801712345678',
  templateKey: 'brief_morning',
  language: 'bn' as const,
  body: 'Yesterday: ৳1,23,456',
  attempts,
  status: 'queued',
  next: '2026-09-21T00:00:00.000Z',
});

describe('outbox', () => {
  const now = () => new Date('2026-09-21T03:00:00.000Z');

  it('sends each due message once, even if drained twice', async () => {
    const { store, rows } = memoryOutbox([msg('a'), msg('b')]);
    const log: OutboundMessage[] = [];
    const transport = mockTransport(log);
    await drainOutbox({ store, transport, now });
    await drainOutbox({ store, transport, now });
    expect(log.map((m) => m.id)).toEqual(['a', 'b']);
    expect(rows.every((r) => r.status === 'sent' && r.providerId)).toBe(true);
  });

  it('backs off after a failure, never logs the phone number, and gives up after the last attempt', async () => {
    const failing: MessagingTransport = {
      name: 'broken',
      send: async (m) => {
        throw new Error(`rejected recipient ${m.toPhone}`);
      },
    };
    const { store, rows } = memoryOutbox([msg('a'), msg('z', MAX_ATTEMPTS - 1)]);
    const r = await drainOutbox({ store, transport: failing, now });
    expect(r).toEqual({ sent: 0, retried: 1, failed: 1 });
    const a = rows.find((x) => x.id === 'a')!;
    expect(a.status).toBe('queued');
    expect(a.next).toBe('2026-09-21T03:01:00.000Z');
    expect(a.error).not.toContain('12345678');
    expect(rows.find((x) => x.id === 'z')!.status).toBe('failed');
    expect(backoffMinutes(3)).toBe(4);
    expect(backoffMinutes(10)).toBe(60);
    expect(maskPhone('call +8801712345678')).toBe('call +880…78');
  });

  it('builds a WhatsApp template message, or plain text when no template applies', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const transport = whatsappTransport({
      token: 't',
      phoneNumberId: '123',
      graphVersion: 'v99.0',
      templateName: (key, lang) => (key === 'brief_morning' ? `xedine_${key}_${lang}` : null),
      fetchImpl: fakeFetch,
    });
    expect(await transport.send(msg('a'))).toEqual({ providerMessageId: 'wamid.1' });
    await transport.send({ ...msg('b'), templateKey: 'assistant_reply' });
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v99.0/123/messages');
    expect(calls[0]!.body).toMatchObject({
      type: 'template',
      template: { name: 'xedine_brief_morning_bn' },
    });
    expect(calls[1]!.body).toMatchObject({ type: 'text', text: { body: 'Yesterday: ৳1,23,456' } });
  });
});

describe('Bangladeshi phone numbers', () => {
  it.each([
    ['01712-345678', '+8801712345678'],
    ['+880 1712 345678', '+8801712345678'],
    ['8801712345678', '+8801712345678'],
    ['০১৭১২৩৪৫৬৭৮', '+8801712345678'],
    ['0212345678', null],
    ['01212345678', null],
  ])('%s → %s', (input, out) => {
    expect(normalizeBdPhone(input)).toBe(out);
  });
});
