/**
 * The till's restaurant currency and clock (ADR 0062). The till runs in one restaurant's browser and draws
 * nothing with money before its data has loaded (client-only, ARCHITECTURE.md "Offline POS"), so one value
 * per page is enough: it is set from the loaded (or cached) receipt settings before the screens render.
 */
export interface TillPlace {
  currency: string;
  tz: string;
  country: string;
}

let current: TillPlace = { currency: 'BDT', tz: 'Asia/Dhaka', country: 'BD' };

export function setTillPlace(place: {
  currency?: string;
  timezone?: string;
  country?: string;
}): void {
  current = {
    currency: place.currency ?? 'BDT',
    tz: place.timezone ?? 'Asia/Dhaka',
    country: place.country ?? 'BD',
  };
}

export const tillPlace = (): TillPlace => current;
