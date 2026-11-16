'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Hint, Label, Select } from '@/components/ui/form';
import type { PlaceOptions } from '@/modules/social/culture';

/**
 * Where the restaurant is (sign-up and Settings): its country, its time zone and its currency. Picking a
 * country fills in that country's time zones and its usual currency, so a restaurant in Texas never sees Dhaka
 * in the list. The currency cannot change once the restaurant has sales (`currencyLocked`): every amount it
 * stored is in that currency.
 */
export function PlaceFields({
  options,
  country: savedCountry,
  timezone: savedZone,
  currency: savedCurrency,
  currencyLocked = false,
}: {
  options: PlaceOptions;
  country: string;
  timezone: string;
  currency: string;
  currencyLocked?: boolean;
}) {
  const t = useTranslations('place');
  const [country, setCountry] = useState(savedCountry);
  const list = options.zones[country] ?? [];
  const [zone, setZone] = useState(
    list.some((z) => z.tz === savedZone) ? savedZone : (list[0]?.tz ?? ''),
  );
  const [currency, setCurrency] = useState(savedCurrency);
  const pick = (code: string) => {
    setCountry(code);
    setZone(options.zones[code]?.[0]?.tz ?? '');
    if (!currencyLocked) setCurrency(options.currencyOf[code] ?? currency);
  };
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div>
        <Label htmlFor="place-country">{t('country')}</Label>
        <Select
          id="place-country"
          name="country"
          value={country}
          onChange={(e) => pick(e.target.value)}
        >
          {options.countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="place-zone">{t('timezone')}</Label>
        <Select
          id="place-zone"
          name="timezone"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          disabled={list.length < 2}
        >
          {list.map((z) => (
            <option key={z.tz} value={z.tz}>
              {z.label}
            </option>
          ))}
        </Select>
        {/* A disabled select is not submitted: the one zone travels in a hidden field. */}
        {list.length < 2 ? <input type="hidden" name="timezone" value={zone} /> : null}
      </div>
      <div>
        <Label htmlFor="place-currency">{t('currency')}</Label>
        <Select
          id="place-currency"
          name="currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          disabled={currencyLocked}
        >
          {options.currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
        {currencyLocked ? <input type="hidden" name="currency" value={currency} /> : null}
        {currencyLocked ? <Hint>{t('currencyLocked')}</Hint> : null}
      </div>
      <Hint className="sm:col-span-3">
        {currency === 'BDT' ? t('hint') : t('hintOtherCurrency')}
      </Hint>
    </div>
  );
}
