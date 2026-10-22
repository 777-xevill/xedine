# 0035 — An invited person's account is created without a confirmation email

## Context
Joining by invitation took three steps and hit Supabase's built-in email allowance (a few
confirmation emails an hour), so people got "something went wrong".

## Decision
The invitation link is sent to one email address, so a live token for that address proves it.
`createInvitedAccount` (`src/modules/tenancy/invite-account.ts`) checks the token (pending, not
expired, same email) and creates the account already confirmed with the service role. The person is
then signed in with their own password and `accept_invitation` (RLS-checked, audited) adds them to
the restaurant. This file is the single server-action exception to "service role only in jobs and
webhooks" (ESLint allows only it). It reads no tenant data and writes only the auth user.

## Consequences
No email is sent, so no rate limit. Ordinary sign-up (owners creating a restaurant) is unchanged.
