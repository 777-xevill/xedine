import type { SupabaseClient } from '@supabase/supabase-js';
import { createTranslator } from 'next-intl';
import type { TelegramApi, TelegramMessage } from '@/lib/messaging/telegram';
import { normalizeBdPhone } from '@/lib/messaging/phone';
import { now } from '@/lib/time/clock';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { newSignInCode, PHONE_SIGN_IN_START, signInCodeHash } from './phone-sign-in-core';

/**
 * The bot half of phone sign-in (ADR 0050). "/start signin" (the link on the sign-in page) asks for the
 * person's contact; a contact that is their own Telegram account's card gets a 6-digit code. The client is
 * the webhook's service-role client, passed in.
 */

/** True when this message belongs to phone sign-in; the bazar bot then leaves it alone. */
export function isPhoneSignInMessage(message: TelegramMessage): boolean {
  return message.text?.trim() === `/start ${PHONE_SIGN_IN_START}` || message.contact !== undefined;
}

function translator(message: TelegramMessage) {
  const english = message.from?.language_code?.startsWith('en') ?? false;
  return createTranslator({
    locale: english ? 'en' : 'bn',
    messages: english ? en : bn,
    namespace: 'phoneSignIn.bot',
  });
}

export async function handlePhoneSignIn(
  message: TelegramMessage,
  api: TelegramApi,
  sb: SupabaseClient,
  secret: string,
): Promise<void> {
  const t = translator(message);
  const chatId = message.chat.id;
  const contact = message.contact;
  if (!contact) return api.askForContact(chatId, t('askContact'), t('shareButton'));

  // Telegram fills user_id only for an account's own card; a forwarded or typed contact is someone else's.
  const sender = message.from?.id ?? chatId;
  if (contact.user_id !== sender) return api.sendClearingKeyboard(chatId, t('notYours'));
  const phone = normalizeBdPhone(contact.phone_number);
  if (!phone) return api.sendClearingKeyboard(chatId, t('notBangladeshi'));

  const code = newSignInCode();
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  const { data, error } = await sb.rpc('phone_sign_in_issue', {
    p_phone: phone,
    p_code_hash: signInCodeHash(phone, code, secret),
    p_full_name: name,
    p_now: now().toISOString(),
  });
  if (error) return api.sendClearingKeyboard(chatId, t('failed'));
  if (data === 'too_many') return api.sendClearingKeyboard(chatId, t('tooMany'));
  if (data !== 'sent') return api.sendClearingKeyboard(chatId, t('failed'));
  return api.sendClearingKeyboard(chatId, t('code', { code, phone: `0${phone.slice(4)}` }));
}
