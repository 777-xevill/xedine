import 'server-only';
import { createHash } from 'node:crypto';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { now } from '@/lib/time/clock';

/**
 * The one place a server action may use the service role (ADR 0035). An invitation link was sent to
 * one email address, so holding a live token for that address proves the address: the account is
 * created already confirmed, which also avoids Supabase's tiny hourly confirmation-email allowance.
 * Nothing else is done here: no org data is read or written; the person then signs in with their own
 * password and accept_invitation (RLS-checked, audited) adds them to the restaurant.
 */
export async function createInvitedAccount(input: {
  token: string;
  email: string;
  password: string;
  fullName: string;
}): Promise<'ok' | 'invalid' | 'emailTaken' | 'failed'> {
  const sb = createServiceRoleClient();
  const tokenHash = createHash('sha256').update(input.token, 'utf8').digest('hex');
  const { data: invitation } = await sb
    .from('invitations')
    .select('id, email')
    .eq('token_hash', tokenHash)
    .eq('status', 'pending')
    .gt('expires_at', now().toISOString())
    .maybeSingle();
  if (!invitation || String(invitation.email).toLowerCase() !== input.email.trim().toLowerCase()) {
    return 'invalid';
  }
  const { error } = await sb.auth.admin.createUser({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (!error) return 'ok';
  return error.code === 'email_exists' || /already|registered/i.test(error.message)
    ? 'emailTaken'
    : 'failed';
}
