import { describe, expect, it } from 'vitest';
import { mapDbError, safeNext } from './form-state';

describe('safeNext (open-redirect guard)', () => {
  it('accepts same-site paths with a query', () => {
    expect(safeNext('/accept-invite?token=abc')).toBe('/accept-invite?token=abc');
    expect(safeNext('/demo/team')).toBe('/demo/team');
  });

  it.each([
    '//evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/\\evil.example',
    '',
    undefined,
    null,
    42,
  ])('rejects %s', (bad) => {
    expect(safeNext(bad)).toBeUndefined();
  });
});

describe('mapDbError', () => {
  it('maps known Postgres errors to user-facing keys, never raw text', () => {
    expect(
      mapDbError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "organizations_slug_key"',
      }),
    ).toBe('slugTaken');
    expect(
      mapDbError({
        code: '23514',
        message: 'new row violates check constraint "organizations_slug_check"',
      }),
    ).toBe('slugInvalid');
    expect(
      mapDbError({
        code: '23514',
        message: 'price_includes_vat cannot change after the organization has orders',
      }),
    ).toBe('priceBasisLocked');
    expect(
      mapDbError({
        code: '42501',
        message: 'this invitation was sent to a different email address',
      }),
    ).toBe('inviteWrongEmail');
    expect(mapDbError({ code: '42501', message: 'permission denied' })).toBe('notAllowed');
    expect(
      mapDbError({ code: 'P0002', message: 'this invitation is invalid or has expired' }),
    ).toBe('inviteInvalid');
    expect(
      mapDbError({ code: '23505', message: 'you already have this role in the organization' }),
    ).toBe('inviteAlreadyMember');
    expect(mapDbError({ code: 'XX000', message: 'secret internal detail' })).toBe('generic');
    expect(mapDbError(null)).toBe('generic');
  });
});
