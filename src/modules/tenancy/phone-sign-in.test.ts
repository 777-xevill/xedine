import { describe, expect, it, vi } from 'vitest';
import type { TelegramApi, TelegramMessage } from '@/lib/messaging/telegram';
import {
  cleanSignInCode,
  isPhoneAccountEmail,
  newSignInCode,
  phoneAccountEmail,
  phoneSignInBotLink,
  signInCodeHash,
} from './phone-sign-in-core';
import { handlePhoneSignIn, isPhoneSignInMessage } from './phone-sign-in-bot';

const SECRET = 'x'.repeat(40);

describe('phone sign-in helpers (ADR 0050)', () => {
  it('makes 6-digit codes', () => {
    for (let i = 0; i < 50; i++) expect(newSignInCode()).toMatch(/^\d{6}$/);
  });

  it('hashes per phone and code with the secret', () => {
    const h = signInCodeHash('+8801712345678', '123456', SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(signInCodeHash('+8801712345678', '123456', SECRET)).toBe(h);
    expect(signInCodeHash('+8801812345678', '123456', SECRET)).not.toBe(h);
    expect(signInCodeHash('+8801712345678', '123457', SECRET)).not.toBe(h);
    expect(signInCodeHash('+8801712345678', '123456', 'y'.repeat(40))).not.toBe(h);
  });

  it('reads a typed code, Bangla digits and spaces included', () => {
    expect(cleanSignInCode(' 123 456 ')).toBe('123456');
    expect(cleanSignInCode('১২৩৪৫৬')).toBe('123456');
    expect(cleanSignInCode('12345')).toBeNull();
    expect(cleanSignInCode('12345a')).toBeNull();
  });

  it('gives each phone one fixed address on our own domain', () => {
    const email = phoneAccountEmail('+8801712345678');
    expect(email).toBe('phone-8801712345678@phone.xedine.org');
    expect(isPhoneAccountEmail(email)).toBe(true);
    expect(isPhoneAccountEmail('owner@gmail.com')).toBe(false);
  });

  it('links to the bot only when its username looks real', () => {
    expect(phoneSignInBotLink('@XedineBot')).toBe('https://t.me/XedineBot?start=signin');
    expect(phoneSignInBotLink(undefined)).toBeNull();
    expect(phoneSignInBotLink('bad name')).toBeNull();
  });
});

function fakeApi() {
  return {
    sendMessage: vi.fn(),
    editMessage: vi.fn(),
    answerCallback: vi.fn(),
    typing: vi.fn(),
    download: vi.fn(),
    askForContact: vi.fn(async () => undefined),
    sendClearingKeyboard: vi.fn<TelegramApi['sendClearingKeyboard']>(async () => undefined),
  } satisfies TelegramApi;
}

const msg = (extra: Partial<TelegramMessage>): TelegramMessage => ({
  message_id: 1,
  chat: { id: 42, type: 'private' },
  from: { id: 42, language_code: 'en' },
  ...extra,
});

describe('phone sign-in bot (ADR 0050)', () => {
  it('takes the sign-in link and shared contacts, and nothing else', () => {
    expect(isPhoneSignInMessage(msg({ text: '/start signin' }))).toBe(true);
    expect(isPhoneSignInMessage(msg({ contact: { phone_number: '8801712345678' } }))).toBe(true);
    expect(isPhoneSignInMessage(msg({ text: '/start 0123456789abcdef0123456789abcdef' }))).toBe(
      false,
    );
    expect(isPhoneSignInMessage(msg({ text: 'murgi 10 kg 1800' }))).toBe(false);
  });

  it('asks for the contact on the sign-in link', async () => {
    const api = fakeApi();
    const rpc = vi.fn();
    await handlePhoneSignIn(msg({ text: '/start signin' }), api, { rpc } as never, SECRET);
    expect(api.askForContact).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses someone else's contact card", async () => {
    const api = fakeApi();
    const rpc = vi.fn();
    await handlePhoneSignIn(
      msg({ contact: { phone_number: '8801712345678', user_id: 99 } }),
      api,
      { rpc } as never,
      SECRET,
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(api.sendClearingKeyboard.mock.calls[0]![1]).toMatch(/not your own/);
  });

  it('refuses a number from outside Bangladesh', async () => {
    const api = fakeApi();
    const rpc = vi.fn();
    await handlePhoneSignIn(
      msg({ contact: { phone_number: '+447700900123', user_id: 42 } }),
      api,
      { rpc } as never,
      SECRET,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stores only the hash and sends the code to the owner of the number', async () => {
    const api = fakeApi();
    const rpc = vi.fn(async () => ({ data: 'sent', error: null }));
    await handlePhoneSignIn(
      msg({ contact: { phone_number: '8801712345678', user_id: 42, first_name: 'Rahim' } }),
      api,
      { rpc } as never,
      SECRET,
    );
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(fn).toBe('phone_sign_in_issue');
    expect(args.p_phone).toBe('+8801712345678');
    expect(args.p_full_name).toBe('Rahim');
    const text = api.sendClearingKeyboard.mock.calls[0]![1];
    const code = text.match(/\b(\d{6})\b/)![1]!;
    expect(args.p_code_hash).toBe(signInCodeHash('+8801712345678', code, SECRET));
    expect(JSON.stringify(args)).not.toContain(code);
    expect(text).toContain('01712345678');
  });
});
