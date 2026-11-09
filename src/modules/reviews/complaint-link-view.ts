import 'server-only';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { COMPLAINT_TOKEN } from './complaint-link';

/**
 * The customer's complaint page (ADR 0043) has no account: the branch's link token is the only credential.
 * complaint_link is callable by the service role only and returns the two names the page shows.
 */
export async function readComplaintLink(
  token: string,
): Promise<{ restaurant: string; branch: string } | null> {
  if (!COMPLAINT_TOKEN.test(token)) return null;
  const { data, error } = await createServiceRoleClient().rpc('complaint_link', {
    p_token: token,
  });
  if (error) {
    console.error('complaint link', error.code);
    return null;
  }
  return ((data ?? []) as { restaurant: string; branch: string }[])[0] ?? null;
}
