import { describe, expect, it } from 'vitest';
import { STAFF_SESSION_MS, staffSessionEnded } from './device-storage';

const session = { sessionId: 's', staffId: 'p', staffName: 'Rifat' };

describe('till staff sign-in', () => {
  const signedAt = '2026-10-18T23:20:41.000Z';
  const at = (ms: number) => new Date(Date.parse(signedAt) + ms);

  it('is over once the 12 hours the database keeps it have passed', () => {
    expect(staffSessionEnded({ ...session, signedAt }, at(STAFF_SESSION_MS - 1))).toBe(false);
    expect(staffSessionEnded({ ...session, signedAt }, at(STAFF_SESSION_MS))).toBe(true);
    expect(staffSessionEnded({ ...session, signedAt }, at(5 * 24 * 3600 * 1000))).toBe(true);
  });

  it('is not guessed when the time is unknown or unreadable', () => {
    expect(staffSessionEnded(session, at(STAFF_SESSION_MS * 10))).toBe(false);
    expect(
      staffSessionEnded({ ...session, signedAt: 'not a date' }, at(STAFF_SESSION_MS * 10)),
    ).toBe(false);
  });
});
