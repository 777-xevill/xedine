import { describe, expect, it } from 'vitest';
import { OAUTH_ERRORS, oauthErrorKey } from './oauth';

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
    for (const d of ['email missing', 'access_denied', 'boom', null])
      expect(OAUTH_ERRORS.has(oauthErrorKey(d))).toBe(true);
  });
});
