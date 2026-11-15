import 'server-only';
import { telegramApi } from './telegram';

/**
 * A short Telegram message to the platform operator (ADR 0059), e.g. "a restaurant asked for help
 * connecting Facebook". Needs TELEGRAM_BOT_TOKEN and ADMIN_TELEGRAM_CHAT_ID; without them it does
 * nothing. It never throws: the owner's request is saved whether or not the ping goes out.
 */
export async function pingAdmin(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = Number(process.env.ADMIN_TELEGRAM_CHAT_ID);
  if (!token || !Number.isSafeInteger(chat) || chat === 0) return false;
  try {
    await telegramApi(token).sendMessage(chat, text);
    return true;
  } catch (e) {
    console.error('admin ping', e instanceof Error ? e.message : e);
    return false;
  }
}
