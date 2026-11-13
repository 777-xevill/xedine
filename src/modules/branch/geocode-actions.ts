'use server';

import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { isMapsLink, parseSpot } from './geocode';

/**
 * Read numbers or a Google Maps link into a spot (ADR 0051). A short link (maps.app.goo.gl/…) is opened once
 * to see where it leads: only Google's own addresses are ever opened, and the redirect ends on Google too.
 * Searching by place name happens in the browser as the owner types (see photon.ts), not here.
 */
export type SpotResult =
  | { ok: true; lat: number; lon: number }
  | { ok: false; error: 'signIn' | 'invalidInput' | 'notFound' | 'unavailable' };

const TIMEOUT_MS = 8000;

export async function resolveSpotAction(text: string): Promise<SpotResult> {
  const parsed = z.string().trim().min(2).max(600).safeParse(text);
  if (!parsed.success) return { ok: false, error: 'invalidInput' };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'signIn' };

  const direct = parseSpot(parsed.data);
  if (direct) return { ok: true, ...direct };
  if (!isMapsLink(parsed.data)) return { ok: false, error: 'notFound' };
  try {
    const res = await fetch(parsed.data, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const spot = parseSpot(res.url);
    return spot ? { ok: true, ...spot } : { ok: false, error: 'notFound' };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}
