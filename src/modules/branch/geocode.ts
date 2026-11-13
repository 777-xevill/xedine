/**
 * Finding a branch's spot without a phone (ADR 0051): the owner types a place name, pastes a Google Maps
 * link, or pastes the numbers. This file is the pure part: reading coordinates out of text and links.
 */

export interface Spot {
  lat: number;
  lon: number;
}

const inRange = (lat: number, lon: number): Spot | null =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon }
    : null;

/** Google Maps links Xedine will open to find where a short link leads (nothing else is ever fetched). */
const MAPS_HOSTS = new Set([
  'maps.app.goo.gl',
  'goo.gl',
  'google.com',
  'www.google.com',
  'maps.google.com',
]);

export function isMapsLink(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' && MAPS_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * "23.8759, 90.3795", or a Google Maps link that carries the spot: the place pin (!3d…!4d…) first, then
 * @lat,lng, then q= / ll= / query=. Returns null when there are no coordinates in the text.
 */
export function parseSpot(text: string): Spot | null {
  const s = text.trim();
  const plain = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (plain) return inRange(Number(plain[1]), Number(plain[2]));
  if (!isMapsLink(s)) return null;
  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    // keep the raw text
  }
  const pin = decoded.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (pin) return inRange(Number(pin[1]), Number(pin[2]));
  const at = decoded.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (at) return inRange(Number(at[1]), Number(at[2]));
  const q = decoded.match(/[?&](?:q|ll|query)=(-?\d{1,2}\.\d+)[,+\s]+(-?\d{1,3}\.\d+)/);
  if (q) return inRange(Number(q[1]), Number(q[2]));
  return null;
}
