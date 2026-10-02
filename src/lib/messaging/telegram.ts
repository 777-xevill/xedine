import { timingSafeEqual } from 'node:crypto';

/**
 * Telegram Bot API over fetch (ADR 0025): no SDK. Only what the bazar bot needs — send and edit a
 * message with buttons, answer a button tap, and download a voice note or photo. The token comes from
 * TELEGRAM_BOT_TOKEN and never reaches a log: errors carry the method and status only.
 */
export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number; file_size?: number };
  audio?: { file_id: string; duration: number; file_size?: number };
  photo?: { file_id: string; file_size?: number; width: number; height: number }[];
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: { id: number };
    message?: TelegramMessage;
    data?: string;
  };
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramApi {
  sendMessage(chatId: number, text: string, buttons?: InlineButton[][]): Promise<number>;
  /** Replaces a message's text; its buttons are replaced by `buttons`, or removed when none. */
  editMessage(
    chatId: number,
    messageId: number,
    text: string,
    buttons?: InlineButton[][],
  ): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  typing(chatId: number): Promise<void>;
  /** A file the person sent, as bytes; null when it is over Telegram's 20 MB bot download limit. */
  download(fileId: string): Promise<{ bytes: Uint8Array; path: string } | null>;
}

const API = 'https://api.telegram.org';

export function telegramApi(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T };
    if (!res.ok || !json.ok) throw new Error(`telegram ${method} ${res.status}`);
    return json.result as T;
  }
  const keyboard = (buttons?: InlineButton[][]) =>
    buttons && buttons.length > 0 ? { reply_markup: { inline_keyboard: buttons } } : {};

  return {
    async sendMessage(chatId, text, buttons) {
      const sent = await call<{ message_id: number }>('sendMessage', {
        chat_id: chatId,
        text,
        ...keyboard(buttons),
      });
      return sent.message_id;
    },
    async editMessage(chatId, messageId, text, buttons) {
      // Editing without reply_markup also removes the buttons, so a list cannot be tapped twice.
      await call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        ...keyboard(buttons),
      });
    },
    async answerCallback(callbackId, text) {
      await call('answerCallbackQuery', { callback_query_id: callbackId, text });
    },
    async typing(chatId) {
      await call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);
    },
    async download(fileId) {
      const file = await call<{ file_path?: string; file_size?: number }>('getFile', {
        file_id: fileId,
      });
      if (!file.file_path) return null;
      const res = await fetchImpl(`${API}/file/bot${token}/${file.file_path}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`telegram file ${res.status}`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), path: file.file_path };
    },
  };
}

/** Telegram sends the secret set with setWebhook in X-Telegram-Bot-Api-Secret-Token. */
export function telegramSecretOk(expected: string | undefined, given: string | null): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
