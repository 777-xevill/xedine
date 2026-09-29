import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/db/supabase-server';
import { parseFeatures, type FeatureKey } from './navigation';

/**
 * The optional modules this org switched on (Settings → Features, ADR 0024). Reads the whole row so
 * a database that has not had the enabled_features migration yet simply shows the core sections.
 */
export const getEnabledFeatures = cache(async (orgId: string): Promise<FeatureKey[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('org_settings')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  return parseFeatures((data as { enabled_features?: unknown } | null)?.enabled_features);
});

/** This person's recent assistant conversations, most recently active first (RLS: their own only). */
export async function recentChats(
  orgId: string,
  userId: string,
  limit = 30,
): Promise<{ id: string; title: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('ai_conversations')
    .select('id, title')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map((c) => ({ id: c.id as string, title: (c.title as string | null) ?? '' }));
}
