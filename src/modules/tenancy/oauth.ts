/**
 * "Continue with Facebook" (ADR 0041), "Continue with Google" and "Continue with phone number" (ADR 0050)
 * next to email + password. Supabase Auth runs Facebook and Google; each provider is switched on in the
 * Supabase dashboard, and an env flag shows its button (the app cannot see the dashboard setting by itself).
 * Phone sign-in needs the Telegram bot, which proves the number for free.
 */
export type OAuthProvider = 'facebook' | 'google';

export function facebookSignInEnabled(): boolean {
  return process.env.FACEBOOK_SIGN_IN === 'on';
}

export function googleSignInEnabled(): boolean {
  return process.env.GOOGLE_SIGN_IN === 'on';
}

export function phoneSignInEnabled(): boolean {
  return (
    process.env.PHONE_SIGN_IN === 'on' &&
    !!process.env.TELEGRAM_BOT_TOKEN &&
    !!process.env.TELEGRAM_BOT_USERNAME
  );
}

export function oauthProvider(value: unknown): OAuthProvider {
  return value === 'google' ? 'google' : 'facebook';
}

/**
 * Supabase sends the browser back with `error_description` when the sign-in did not work. A Facebook
 * account made with a phone number has no email, which Supabase refuses; that one gets its own words.
 * Returns a key under `errors.*`.
 */
export function oauthErrorKey(
  description: string | null,
  provider: OAuthProvider = 'facebook',
): string {
  if (provider === 'google') {
    return description && /denied|cancel/i.test(description) ? 'googleCancelled' : 'googleFailed';
  }
  if (description && /email/i.test(description)) return 'facebookNoEmail';
  if (description && /denied|cancel/i.test(description)) return 'facebookCancelled';
  return 'facebookFailed';
}

/** Only the error keys the callback can send are shown from the URL; anything else is ignored. */
export const OAUTH_ERRORS = new Set([
  'facebookNoEmail',
  'facebookCancelled',
  'facebookFailed',
  'googleCancelled',
  'googleFailed',
]);
