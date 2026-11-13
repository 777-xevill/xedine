'use server';

import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { isMapsLink, parseSpot } from './geocode';

/**
 * Look up a branch's spot from what the owner typed (ADR 0051): numbers, a Google Maps link (a short link
 * is opened once to see where it leads), or a place name searched on OpenStreetMap's free Nominatim.
 * Only the typed place text leaves Xedine; nothing about the restaurant or the person is sent.
 */
export interface FoundPlace {
  name: string;
  lat: number;
  lon: number;
}

export type FindPlaceResult =
  | { ok: true; places: FoundPlace[] }
  | { ok: false; error: 'signIn' | 'invalidInput' | 'notFound' | 'unavailable' };

const TIMEOUT_MS = 8000;

export async function findPlaceAction(query: string): Promise<FindPlaceResult> {
  const parsed = z.string().trim().min(2).max(400).safeParse(query);
  if (!parsed.success) return { ok: false, error: 'invalidInput' };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'signIn' };
  const text = parsed.data;

  const direct = parseSpot(text);
  if (direct) return { ok: true, places: [{ name: `${direct.lat}, ${direct.lon}`, ...direct }] };

  try {
    if (isMapsLink(text)) {
      // A short link (maps.app.goo.gl/…) leads to a long one that carries the spot. Only Google's own
      // addresses are ever opened, and the redirect ends on Google too.
      const res = await fetch(text, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const spot = parseSpot(res.url);
      return spot
        ? { ok: true, places: [{ name: `${spot.lat}, ${spot.lon}`, ...spot }] }
        : { ok: false, error: 'notFound' };
    }
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({
      q: text,
      format: 'jsonv2',
      limit: '5',
      countrycodes: 'bd',
      'accept-language': 'en',
    }).toString();
    const res = await fetch(url, {
      headers: { 'user-agent': 'Xedine/1.0 (restaurant weather location lookup)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: 'unavailable' };
    const rows = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
    const places = rows
      .map((r) => ({ name: r.display_name ?? '', lat: Number(r.lat), lon: Number(r.lon) }))
      .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => ({ ...p, lat: Number(p.lat.toFixed(5)), lon: Number(p.lon.toFixed(5)) }));
    return places.length > 0 ? { ok: true, places } : { ok: false, error: 'notFound' };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}
