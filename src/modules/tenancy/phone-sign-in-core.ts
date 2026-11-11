import { createHmac, randomInt } from 'node:crypto';

/**
 * Phone sign-in at no cost (ADR 0050): the Telegram bot proves the phone (a person can share only their own
 * account's number), sends a 6-digit code, and the sign-in page checks it. Pure helpers, shared by the bot
 * and the sign-in action.
 */

/** The `/start` payload of the bot link on the sign-in page. */
export const PHONE_SIGN_IN_START = 'signin';

/** A 6-digit code, from the crypto random source. */
export function newSignInCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * What is stored for a code: an HMAC of phone and code with a server secret, so the table alone is not
 * enough to read a code back (a 6-digit code would fall to a plain hash at once).
 */
export function signInCodeHash(phone: string, code: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`phone-sign-in:${phone}:${code}`, 'utf8')
    .digest('hex');
}

/** The code as typed: Bangla digits and spaces are fine. Null unless it is 6 digits. */
export function cleanSignInCode(input: string): string | null {
  const digits = input
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
    .replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * Supabase Auth needs an email or a working SMS provider to make a session; there is no SMS provider (it
 * costs money), so a phone account carries an address on our own domain that never receives mail. It is
 * fixed by the phone, so the same phone always reaches the same account.
 */
export function phoneAccountEmail(phone: string): string {
  return `phone-${phone.replace(/\D/g, '')}@phone.xedine.org`;
}

export function isPhoneAccountEmail(email: string | null | undefined): boolean {
  return !!email && /^phone-\d+@phone\.xedine\.org$/.test(email);
}

/** The bot link the sign-in page opens; null when the bot is not set up. */
export function phoneSignInBotLink(username: string | undefined): string | null {
  const name = username?.trim().replace(/^@/, '');
  return name && /^\w{5,32}$/.test(name)
    ? `https://t.me/${name}?start=${PHONE_SIGN_IN_START}`
    : null;
}
