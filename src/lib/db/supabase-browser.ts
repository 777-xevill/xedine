'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/**
 * Browser-side Supabase client. On the POS/KDS surfaces this carries the manager/owner's own
 * signed-in session (ADR 0013) — RLS is satisfied by that session; PIN-based staff attribution is
 * a separate, application-level check (private.verify_staff_session) on every order RPC.
 */
export function createClient() {
  const env = publicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
