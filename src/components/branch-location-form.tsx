'use client';

import { MapPin, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/form';
import { setBranchLocationAction } from '@/modules/branch/actions';
import { resolveSpotAction } from '@/modules/branch/geocode-actions';
import {
  looksLikeSpotText,
  photonUrl,
  placesFromPhoton,
  spellingVariants,
  type Place,
} from '@/modules/branch/photon';

const MIN_CHARS = 2;
const DELAY_MS = 300;

/** Ask the search service; if the spelling finds nothing, try the usual Bangla-to-English spellings. */
async function searchPlaces(query: string, signal: AbortSignal): Promise<Place[]> {
  for (const q of [query, ...spellingVariants(query)]) {
    const res = await fetch(photonUrl(q), { signal });
    if (!res.ok) throw new Error('search failed');
    const places = placesFromPhoton(await res.json());
    if (places.length > 0) return places;
  }
  return [];
}

/**
 * Where the branch is, for its weather (ADR 0051), the way Google Maps does it: type the place and
 * suggestions appear as you type (arrow keys and Enter work); or paste a Google Maps link or the numbers;
 * or use this device's location. The numbers are under "numbers". Both boxes empty = the area's weather.
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
  const [suggestions, setSuggestions] = React.useState<Place[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string | null>(null);
  const latest = React.useRef(0);

  const typed = query.trim();
  const searchable = typed.length >= MIN_CHARS && !looksLikeSpotText(typed);
  // What is shown never outlives what is typed: short or pasted text shows no suggestions.
  const shown = open && searchable ? suggestions : [];

  // Suggest as the owner types, after a short pause. Only answers to the latest text are used.
  React.useEffect(() => {
    if (!searchable) return;
    const id = ++latest.current;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const places = await searchPlaces(typed, controller.signal);
        if (id !== latest.current) return;
        setSuggestions(places);
        setActive(0);
        setSearchError(places.length === 0 ? 'notFound' : null);
      } catch {
        if (id === latest.current && !controller.signal.aborted) {
          setSuggestions([]);
          setSearchError('unavailable');
        }
      } finally {
        if (id === latest.current) setLoading(false);
      }
    }, DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [typed, searchable]);

  const choose = (name: string, la: number, lo: number) => {
    setLat(String(la));
    setLon(String(lo));
    setPicked(name);
    setQuery(name);
    setOpen(false);
    setSearchError(null);
  };
  const submitSearch = async () => {
    if (typed.length < MIN_CHARS) return;
    if (!looksLikeSpotText(typed)) {
      const choice = shown[active] ?? suggestions[active] ?? suggestions[0];
      if (choice) choose(choice.name, choice.lat, choice.lon);
      else setOpen(true);
      return;
    }
    // Numbers or a Google Maps link (a short link is opened on the server to see where it leads).
    setLoading(true);
    const found = await resolveSpotAction(typed);
    setLoading(false);
    if (found.ok) choose(`${found.lat}, ${found.lon}`, found.lat, found.lon);
    else setSearchError(found.error);
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
            maxLength={600}
            autoComplete="off"
            role="combobox"
            aria-expanded={shown.length > 0}
            aria-controls="b-suggestions"
            placeholder={t('searchPlaceholder')}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setPicked(null);
              setSearchError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && shown.length > 0) {
                e.preventDefault();
                setActive((i) => (i + 1) % shown.length);
              } else if (e.key === 'ArrowUp' && shown.length > 0) {
                e.preventDefault();
                setActive((i) => (i - 1 + shown.length) % shown.length);
              } else if (e.key === 'Escape') {
                setOpen(false);
              } else if (e.key === 'Enter') {
                // Enter picks the highlighted suggestion; it must not save the form.
                e.preventDefault();
                void submitSearch();
              }
            }}
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void submitSearch()}
            disabled={loading}
          >
            <Search aria-hidden className="size-4" />
            {loading ? t('searching') : t('search')}
          </Button>
        </div>
        {shown.length > 0 ? (
          <ul
            id="b-suggestions"
            role="listbox"
            className="glass-tile mt-1 overflow-hidden rounded-input"
          >
            {shown.map((p, i) => (
              <li key={`${p.lat},${p.lon},${p.name}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  // Mouse-down, so the choice lands before the box loses focus.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(p.name, p.lat, p.lon);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-start text-sm ${
                    i === active ? 'bg-surface-elevated' : ''
                  }`}
                >
                  <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-secondary" />
                  <span>{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {searchError && !(shown.length > 0) ? (
          <p className="mt-2 text-sm text-warning">{t(`searchError.${searchError}`)}</p>
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
