/**
 * "Continue with Facebook" next to email + password (ADR 0041). Supabase Auth runs the Facebook sign-in;
 * the provider is switched on in the Supabase dashboard with the same Meta app the social autopilot uses,
 * and FACEBOOK_SIGN_IN=on shows the button (the app cannot see the dashboard setting by itself).
 */
export function facebookSignInEnabled(): boolean {
  return process.env.FACEBOOK_SIGN_IN === 'on';
}

/**
 * Supabase sends the browser back with `error_description` when the sign-in did not work. A Facebook
 * account made with a phone number has no email, which Supabase refuses; that one gets its own words.
 * Returns a key under `errors.*`.
 */
export function oauthErrorKey(description: string | null): string {
  if (description && /email/i.test(description)) return 'facebookNoEmail';
  if (description && /denied|cancel/i.test(description)) return 'facebookCancelled';
  return 'facebookFailed';
}

/** Only the error keys the callback can send are shown from the URL; anything else is ignored. */
export const OAUTH_ERRORS = new Set(['facebookNoEmail', 'facebookCancelled', 'facebookFailed']);
