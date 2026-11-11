import 'server-only';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { normalizeBdPhone } from '@/lib/messaging/phone';
import { now } from '@/lib/time/clock';
import { cleanSignInCode, phoneAccountEmail, signInCodeHash } from './phone-sign-in-core';

/**
 * The sign-in half of phone sign-in (ADR 0050). Like invite-account.ts, a server action may use the service
 * role here, because the person is not signed in yet: a live code for a phone the Telegram bot verified is
 * the proof. Nothing but the auth user and the private phone tables is touched; no tenant data is read.
 */

export type PhoneSignInResult =
  | { status: 'ok'; tokenHash: string }
  | { status: 'invalidPhone' | 'invalidCode' | 'noCode' | 'wrong' | 'locked' | 'failed' };

export function signInSecret(): string {
  return z.string().min(20).parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Checks the code and returns a one-time token for `auth.verifyOtp`, which the caller turns into the
 * session cookie. A phone signing in for the first time gets an account, already confirmed.
 */
export async function checkPhoneSignIn(input: {
  phone: string;
  code: string;
}): Promise<PhoneSignInResult> {
  const phone = normalizeBdPhone(input.phone);
  if (!phone) return { status: 'invalidPhone' };
  const code = cleanSignInCode(input.code);
  if (!code) return { status: 'invalidCode' };

  const sb = createServiceRoleClient();
  const { data, error } = await sb.rpc('phone_sign_in_check', {
    p_phone: phone,
    p_code_hash: signInCodeHash(phone, code, signInSecret()),
    p_now: now().toISOString(),
  });
  if (error || !data) return { status: 'failed' };
  const checked = data as { status: string; user_id?: string | null; full_name?: string | null };
  if (checked.status === 'no_code') return { status: 'noCode' };
  if (checked.status === 'wrong') return { status: 'wrong' };
  if (checked.status === 'locked') return { status: 'locked' };
  if (checked.status !== 'ok') return { status: 'failed' };

  const email = phoneAccountEmail(phone);
  if (!checked.user_id) {
    const { data: created, error: createError } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: checked.full_name ?? '', phone, sign_in: 'phone' },
    });
    // Already there: an earlier first sign-in made the account but stopped before linking it.
    if (createError && !/already|registered|exists/i.test(createError.message)) {
      return { status: 'failed' };
    }
    if (created?.user) {
      const { error: linkError } = await sb.rpc('phone_account_link', {
        p_phone: phone,
        p_user_id: created.user.id,
      });
      if (linkError) return { status: 'failed' };
    }
  }

  // Makes a one-time sign-in token without sending any email (admin generateLink only returns it).
  const { data: link, error: linkError } = await sb.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return { status: 'failed' };
  if (!checked.user_id && link.user) {
    // Covers the "already there" case above: link the phone now that the account's id is known.
    await sb.rpc('phone_account_link', { p_phone: phone, p_user_id: link.user.id });
  }
  return { status: 'ok', tokenHash };
}
