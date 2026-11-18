import { describe, expect, it } from 'vitest';
import { OAUTH_ERRORS, oauthErrorKey, oauthProvider } from './oauth';

describe('Facebook sign-in errors (ADR 0041)', () => {
  it('explains a Facebook account with no email in its own words', () => {
    expect(oauthErrorKey('Error getting user email from external provider')).toBe(
      'facebookNoEmail',
    );
  });

  it('tells a cancelled sign-in from a failed one', () => {
    expect(oauthErrorKey('Permissions error: user denied')).toBe('facebookCancelled');
    expect(oauthErrorKey('Unable to exchange external code')).toBe('facebookFailed');
    expect(oauthErrorKey(null)).toBe('facebookFailed');
  });

  it('only ever produces keys the sign-in page shows', () => {
    for (const p of ['facebook', 'google'] as const)
      for (const d of ['email missing', 'access_denied', 'boom', null])
        expect(OAUTH_ERRORS.has(oauthErrorKey(d, p))).toBe(true);
  });
});

describe('Google sign-in (ADR 0050)', () => {
  it('words Google errors as Google, never as Facebook', () => {
    expect(oauthErrorKey('access_denied', 'google')).toBe('googleCancelled');
    expect(oauthErrorKey('email missing', 'google')).toBe('googleFailed');
  });

  it('reads the provider from a form or URL, Facebook unless it says google', () => {
    expect(oauthProvider('google')).toBe('google');
    expect(oauthProvider('facebook')).toBe('facebook');
    expect(oauthProvider('github')).toBe('facebook');
    expect(oauthProvider(null)).toBe('facebook');
  });
});

describe('X sign-in (the founder, 2026-11-18)', () => {
  it('reads x from the form and words its errors as X', () => {
    expect(oauthProvider('x')).toBe('x');
    expect(oauthErrorKey('access_denied', 'x')).toBe('xCancelled');
    expect(oauthErrorKey('Error getting user email from external provider', 'x')).toBe('xNoEmail');
    expect(oauthErrorKey('boom', 'x')).toBe('xFailed');
    for (const d of ['email missing', 'access_denied', 'boom', null])
      expect(OAUTH_ERRORS.has(oauthErrorKey(d, 'x'))).toBe(true);
  });
});
