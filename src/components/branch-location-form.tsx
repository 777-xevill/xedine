'use client';

import { MapPin, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/form';
import { setBranchLocationAction } from '@/modules/branch/actions';
import { findPlaceAction, type FoundPlace } from '@/modules/branch/geocode-actions';

/**
 * Where the branch is, for its weather (ADR 0051), made easy for a laptop as well as a phone: type the place
 * and tap the right result, paste a Google Maps link, or use this device's location. The numbers are there
 * to see (and to type) under "numbers". Both boxes empty = follow the branch's area.
 */
export function BranchLocationForm({
  orgId,
  orgSlug,
  branchId,
  latitude,
  longitude,
}: {
  orgId: string;
  orgSlug: string;
  branchId: string;
  latitude: number | null;
  longitude: number | null;
}) {
  const t = useTranslations('branch');
  const [lat, setLat] = React.useState(latitude === null ? '' : String(latitude));
  const [lon, setLon] = React.useState(longitude === null ? '' : String(longitude));
  const [status, setStatus] = React.useState<'idle' | 'finding' | 'failed'>('idle');
  const [query, setQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [places, setPlaces] = React.useState<FoundPlace[]>([]);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string | null>(null);

  const choose = (name: string, la: number, lo: number) => {
    setLat(String(la));
    setLon(String(lo));
    setPicked(name);
    setPlaces([]);
    setSearchError(null);
  };
  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    setPlaces([]);
    setPicked(null);
    const found = await findPlaceAction(query);
    setSearching(false);
    if (!found.ok) {
      setSearchError(found.error);
      return;
    }
    // One clear answer (numbers or a map link): fill it in. Several: let the owner pick.
    if (found.places.length === 1) {
      const only = found.places[0]!;
      choose(only.name, only.lat, only.lon);
    } else setPlaces(found.places);
  };
  const locate = () => {
    if (!('geolocation' in navigator)) {
      setStatus('failed');
      return;
    }
    setStatus('finding');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(4));
        setLon(pos.coords.longitude.toFixed(4));
        setPicked(null);
        setStatus('idle');
      },
      () => setStatus('failed'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  const hasSpot = lat.trim() !== '' && lon.trim() !== '';
  return (
    <ActionForm action={setBranchLocationAction} successKey="common.saved" className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="latitude" value={lat} />
      <input type="hidden" name="longitude" value={lon} />

      <div>
        <Label htmlFor="b-search">{t('searchLabel')}</Label>
        <div className="flex gap-2">
          <Input
            id="b-search"
            value={query}
            maxLength={400}
            autoComplete="off"
            placeholder={t('searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter searches; it must not save the form.
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void search()}
            disabled={searching}
          >
            <Search aria-hidden className="size-4" />
            {searching ? t('searching') : t('search')}
          </Button>
        </div>
        {searchError ? (
          <p className="mt-2 text-sm text-warning">{t(`searchError.${searchError}`)}</p>
        ) : null}
        {places.length > 0 ? (
          <div className="mt-2">
            <p className="mb-1 text-sm text-secondary">{t('pickOne')}</p>
            <ul className="space-y-1">
              {places.map((p) => (
                <li key={`${p.lat},${p.lon}`}>
                  <button
                    type="button"
                    onClick={() => choose(p.name, p.lat, p.lon)}
                    className="glass-tile w-full rounded-input px-3 py-2 text-start text-sm hover:underline"
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={locate}
          disabled={status === 'finding'}
        >
          <MapPin aria-hidden className="size-4" />
          {status === 'finding' ? t('locating') : t('useMyLocation')}
        </Button>
        <span className="text-xs text-secondary">{t('laptopNote')}</span>
      </div>
      {status === 'failed' ? <p className="text-sm text-warning">{t('locateFailed')}</p> : null}

      {hasSpot ? (
        <div className="glass-tile rounded-input p-3 text-sm">
          <p className="font-medium">{picked ? t('picked', { name: picked }) : t('spotReady')}</p>
          <a
            href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block font-medium text-purple underline"
          >
            {t('checkMap')}
          </a>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!hasSpot}>
          {t('saveLocation')}
        </Button>
        <Button
          type="submit"
          name="clear"
          value="1"
          variant="ghost"
          size="sm"
          disabled={latitude === null && longitude === null}
        >
          {t('useArea')}
        </Button>
      </div>

      <details>
        <summary className="cursor-pointer text-sm text-secondary">{t('numbersToggle')}</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="b-lat">{t('latitude')}</Label>
            <Input
              id="b-lat"
              inputMode="decimal"
              value={lat}
              onChange={(e) => {
                setLat(e.target.value);
                setPicked(null);
              }}
              className="w-32"
            />
          </div>
          <div>
            <Label htmlFor="b-lon">{t('longitude')}</Label>
            <Input
              id="b-lon"
              inputMode="decimal"
              value={lon}
              onChange={(e) => {
                setLon(e.target.value);
                setPicked(null);
              }}
              className="w-32"
            />
          </div>
        </div>
      </details>
      <Hint>{t('locationHint')}</Hint>
    </ActionForm>
  );
}
