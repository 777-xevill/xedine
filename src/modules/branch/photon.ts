/**
 * As-you-type place search for a branch's spot (ADR 0051), like typing in Google Maps. Uses Photon, a free
 * search-as-you-type service over OpenStreetMap that allows calls straight from the browser. Only the typed
 * place text is sent. This file is the pure part: the request address, reading the answer, spelling variants.
 */

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

/** Bangladesh, so a search for "Gulshan 2" never lands in another country. */
const BANGLADESH_BOX = '88.0,20.5,92.7,26.7';

export function photonUrl(query: string, limit = 6): string {
  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams({
    q: query.trim(),
    limit: String(limit),
    lang: 'en',
    bbox: BANGLADESH_BOX,
  }).toString();
  return url.toString();
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    district?: string;
    locality?: string;
    city?: string;
    county?: string;
  };
}

/** "Gulshan 2, Gulshan, Dhaka": the name, then where it is, with repeats removed. */
export function placesFromPhoton(json: unknown): Place[] {
  const features = (json as { features?: PhotonFeature[] } | null)?.features ?? [];
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const f of features) {
    const c = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const parts: string[] = [];
    for (const part of [p.name, p.street, p.district ?? p.locality, p.city ?? p.county]) {
      if (part && !parts.includes(part)) parts.push(part);
    }
    const name = parts.join(', ');
    const lat = Number(c[1].toFixed(5));
    const lon = Number(c[0].toFixed(5));
    const key = `${name}|${lat}|${lon}`;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, lat, lon });
  }
  return out;
}

/**
 * Spellings to try when a search finds nothing, because Bangla names are written many ways in English:
 * "ghulshan" for Gulshan, "dhanmondi" stays. Only used after the typed spelling gave no result.
 */
export function spellingVariants(query: string): string[] {
  const q = query.trim();
  const variants = [
    q.replace(/([gdtkbjc])h/gi, '$1'), // ghulshan → gulshan
    q.replace(/([aeiou])\1+/gi, '$1'), // baanani → banani
    q.replace(/ph/gi, 'f'),
    q.replace(/w/gi, 'v'),
  ];
  return [...new Set(variants)].filter((v) => v !== q && v.length >= 2);
}

/** Looks like numbers or a Google Maps link rather than a place name: handled by the link reader. */
export function looksLikeSpotText(text: string): boolean {
  const s = text.trim();
  return /^https?:\/\//i.test(s) || /^-?\d{1,3}(?:\.\d+)?\s*[,\s]\s*-?\d{1,3}(?:\.\d+)?$/.test(s);
}
