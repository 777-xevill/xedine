import { describe, expect, it } from 'vitest';
import { telegramApi, telegramSecretOk } from './telegram';

describe('telegram', () => {
  it('accepts only the exact webhook secret', () => {
    expect(telegramSecretOk('s3cret-value', 's3cret-value')).toBe(true);
    expect(telegramSecretOk('s3cret-value', 's3cret-valuf')).toBe(false);
    expect(telegramSecretOk('s3cret-value', null)).toBe(false);
    expect(telegramSecretOk(undefined, '')).toBe(false);
  });

  it('sends buttons as an inline keyboard and never puts the token in an error', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    const api = telegramApi('123:SECRET', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return String(url).endsWith('/editMessageText')
        ? new Response(JSON.stringify({ ok: false }), { status: 400 })
        : ok({ message_id: 7 });
    });
    expect(await api.sendMessage(1, 'hi', [[{ text: '✅', callback_data: 'ok:x' }]])).toBe(7);
    expect(calls[0]!.body).toEqual({
      chat_id: 1,
      text: 'hi',
      reply_markup: { inline_keyboard: [[{ text: '✅', callback_data: 'ok:x' }]] },
    });
    const error = await api.editMessage(1, 7, 'done').catch((e: Error) => e.message);
    expect(error).toBe('telegram editMessageText 400');
    expect(String(error)).not.toContain('SECRET');
  });
});
