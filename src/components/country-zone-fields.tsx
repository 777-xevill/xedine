'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Hint, Label, Select } from '@/components/ui/form';

/**
 * The restaurant's country and its time zone (ADR 0061): picking a country fills the time zone list with
 * that country's own, so a restaurant in Texas never sees Dhaka in the list. Names come from the server in
 * the viewer's language.
 */
export function CountryZoneFields({
  countries,
  zones,
  country: savedCountry,
  timezone: savedZone,
}: {
  /** Every country the app knows, already sorted by name in the viewer's language. */
  countries: { code: string; name: string }[];
  /** Each country's time zones (the first is the usual one), with a readable city name. */
  zones: Record<string, { tz: string; city: string }[]>;
  country: string;
  timezone: string;
}) {
  const t = useTranslations('social.video.settings');
  const [country, setCountry] = useState(savedCountry);
  const list = zones[country] ?? [];
  const [zone, setZone] = useState(
    list.some((z) => z.tz === savedZone) ? savedZone : (list[0]?.tz ?? ''),
  );
  const pick = (code: string) => {
    setCountry(code);
    setZone(zones[code]?.[0]?.tz ?? '');
  };
  return (
    <>
      <div>
        <Label htmlFor="sv-country">{t('country')}</Label>
        <Select
          id="sv-country"
          name="country"
          value={country}
          onChange={(e) => pick(e.target.value)}
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="sv-zone">{t('timezone')}</Label>
        {list.length > 1 ? (
          <Select
            id="sv-zone"
            name="timezone"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            {list.map((z) => (
              <option key={z.tz} value={z.tz}>
                {z.city}
              </option>
            ))}
          </Select>
        ) : (
          <>
            <input type="hidden" name="timezone" value={zone} />
            <p className="flex h-10 items-center text-sm text-secondary">{list[0]?.city ?? zone}</p>
          </>
        )}
        <Hint>{t('timezoneHint')}</Hint>
      </div>
    </>
  );
}
