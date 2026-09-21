/** The shape every server action returns to a `useActionState` form. `error` is a key under `errors.*`. */
export interface FormState {
  ok?: boolean;
  error?: string;
  /** Free-form result for the UI (e.g. the invitation link). */
  data?: Record<string, string>;
  /** A message key under `auth.*` shown on success. */
  message?: string;
}

export const initialState: FormState = {};

interface DbError {
  code?: string;
  message?: string;
}

/** Map a Postgres/PostgREST error to an `errors.*` key. Never leak raw database text to the user. */
export function mapDbError(error: DbError | null | undefined): string {
  if (!error) return 'generic';
  const message = error.message ?? '';
  switch (error.code) {
    case '23505':
      if (message.includes('slug')) return 'slugTaken';
      if (message.includes('memberships') || message.includes('already have'))
        return 'inviteAlreadyMember';
      return 'generic';
    case '23514':
      if (message.includes('price_includes_vat')) return 'priceBasisLocked';
      if (message.includes('slug')) return 'slugInvalid';
      return 'invalidInput';
    case '22023':
      return 'invalidInput';
    case '42501':
      return message.includes('different email') ? 'inviteWrongEmail' : 'notAllowed';
    case 'P0002':
      return 'inviteInvalid';
    default:
      return 'generic';
  }
}

/** Only same-site relative paths are honoured for `?next=`; anything else could be an open redirect. */
export function safeNext(next: unknown): string | undefined {
  if (typeof next !== 'string') return undefined;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return undefined;
  return next;
}
