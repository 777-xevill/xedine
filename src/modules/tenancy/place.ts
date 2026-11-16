import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_CUTOFF_MINUTES } from '@/lib/time/business-date';
import { countryOf, currencyOf, timezoneOf } from '@/modules/social/culture';

/** Where a restaurant is (ADR 0062): every date, time and amount it sees uses these. */
export interface Place {
  country: string;
  /** IANA time zone: dates and times are shown, and business days counted, on this clock. */
  tz: string;
  /** ISO 4217: every amount is in this currency's hundredths. */
  currency: string;
  /** The org's business-day cutoff in minutes after local midnight. */
  cutoffMinutes: number;
}

/** The place from an org_settings row (Bangladesh, Dhaka time and taka when a value is missing). */
export function placeFrom(
  row:
    | {
        country?: unknown;
        timezone?: unknown;
        currency?: unknown;
        default_cutoff_minutes?: unknown;
      }
    | null
    | undefined,
): Place {
  const country = countryOf(row?.country);
  return {
    country,
    tz: timezoneOf(country, row?.timezone),
    currency: typeof row?.currency === 'string' ? row.currency : currencyOf(country),
    cutoffMinutes: Number(row?.default_cutoff_minutes ?? DEFAULT_CUTOFF_MINUTES),
  };
}

/** The place of any org, read with the caller's client (a job's service role, a public page's loader). */
export async function placeOfOrg(sb: SupabaseClient, orgId: string): Promise<Place> {
  const { data } = await sb
    .from('org_settings')
    .select('country, timezone, currency, default_cutoff_minutes')
    .eq('org_id', orgId)
    .maybeSingle();
  return placeFrom(data);
}
