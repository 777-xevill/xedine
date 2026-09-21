import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';

/**
 * The service-role client BYPASSES RLS. Allowed only in scheduled jobs and webhooks (ESLint restricts
 * who may import this file), and every query made with it MUST filter by org_id explicitly.
 * Never import this from a component, a server action, or anything reachable by a signed-in user.
 */
export function createServiceRoleClient() {
  const key = z.string().min(20).parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
