import 'server-only';
import { createTranslator } from 'next-intl';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { formatDhakaTime, formatNumber, type Locale } from '@/lib/i18n/format';
import { addDays, businessDate, DEFAULT_CUTOFF_MINUTES } from '@/lib/time/business-date';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { briefLocale, notifyOwnerOnce } from '@/modules/briefs/jobs/briefs';
import {
  branchCoords,
  calendarToAdd,
  dailyWeather,
  parseMetno,
  rainWindow,
  type WeatherPoint,
} from '@/modules/forecasting/outlook';

/**
 * The weather job (ADR 0051), every three hours: fetch MET Norway's forecast for every active branch, store
 * it, keep the calendar's automatic rain flags in step with it, add the Bangladesh calendar's coming days, and
 * tell the owner when rain is about to start at a branch. Service role, every statement scoped by org_id.
 */
type Supabase = ReturnType<typeof createServiceRoleClient>;

const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
/** MET Norway's terms ask every client to name itself (https://api.met.no/doc/TermsOfService). */
const USER_AGENT = 'Xedine/1.0 (+https://xedine.org)';
const WEATHER_SOURCE = 'weather forecast';
const CALENDAR_SOURCE = 'bd calendar (estimate)';
const DAYS_AHEAD = 7;

export async function fetchMetno(lat: number, lon: number): Promise<WeatherPoint[]> {
  const url = `${MET_URL}?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`met.no ${res.status}`);
  return parseMetno(await res.json());
}

interface BranchRow {
  id: string;
  org_id: string;
  name: string;
  area: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  cutoff_minutes: number | null;
}

export interface WeatherRunResult {
  branches: number;
  fetched: number;
  failed: number;
  flaggedDays: number;
  calendarAdded: number;
  alerts: number;
}

export async function runWeather(
  sb: Supabase,
  at: Date,
  fetchPoints: (lat: number, lon: number) => Promise<WeatherPoint[]> = fetchMetno,
): Promise<WeatherRunResult> {
  const [{ data: branches, error }, { data: settings }] = await Promise.all([
    sb
      .from('branches')
      .select('id, org_id, name, area, city, latitude, longitude, cutoff_minutes')
      .eq('is_active', true),
    sb.from('org_settings').select('org_id, default_cutoff_minutes'),
  ]);
  if (error) throw error;
  const cutoffOf = new Map(
    (settings ?? []).map((s) => [s.org_id as string, Number(s.default_cutoff_minutes)]),
  );
  const result: WeatherRunResult = {
    branches: 0,
    fetched: 0,
    failed: 0,
    flaggedDays: 0,
    calendarAdded: 0,
    alerts: 0,
  };
  const list = (branches ?? []) as BranchRow[];
  result.branches = list.length;

  // One call per place (rounded to ~1 km): branches in the same area share it.
  // The places are fetched together, not one after another: the whole job has to fit in a short run.
  const placeOf = new Map(
    list.map((b) => {
      const c = branchCoords(b);
      return [b.id, { key: `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`, lat: c.lat, lon: c.lon }];
    }),
  );
  const places = new Map([...placeOf.values()].map((p) => [p.key, p]));
  const cache = new Map<string, WeatherPoint[] | null>(
    await Promise.all(
      [...places.values()].map(async (p): Promise<[string, WeatherPoint[] | null]> => {
        try {
          const pts = await fetchPoints(p.lat, p.lon);
          result.fetched += 1;
          return [p.key, pts];
        } catch (e) {
          console.error('weather fetch', e instanceof Error ? e.message.slice(0, 120) : 'error');
          result.failed += 1;
          return [p.key, null];
        }
      }),
    ),
  );
  const pointsOf = new Map<string, WeatherPoint[]>();
  const fetchedAt = at.toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const b of list) {
    const pts = cache.get(placeOf.get(b.id)!.key);
    if (!pts || pts.length === 0) continue;
    pointsOf.set(b.id, pts);
    for (const p of pts)
      rows.push({
        org_id: b.org_id,
        branch_id: b.id,
        at: p.at,
        period_hours: p.periodHours,
        temp_c: p.tempC,
        rain_mm: p.rainMm,
        symbol: p.symbol,
        fetched_at: fetchedAt,
      });
  }
  for (let i = 0; i < rows.length; i += 2000) {
    const { error: upErr } = await sb
      .from('weather_hours')
      .upsert(rows.slice(i, i + 2000), { onConflict: 'org_id,branch_id,at' });
    if (upErr) throw upErr;
  }
  // Keep two weeks of readings: enough to show what the weather was, small enough to stay cheap.
  await sb
    .from('weather_hours')
    .delete()
    .lt('at', new Date(at.getTime() - 14 * 86_400_000).toISOString());

  const byOrg = new Map<string, BranchRow[]>();
  for (const b of list) byOrg.set(b.org_id, [...(byOrg.get(b.org_id) ?? []), b]);

  // Each org on its own, all at once; one org failing does not stop the others.
  const outcomes = await Promise.allSettled(
    [...byOrg].map(async ([orgId, orgBranches]) => {
      const orgCutoff = cutoffOf.get(orgId) ?? DEFAULT_CUTOFF_MINUTES;
      const today = businessDate(at, orgCutoff);
      const last = addDays(today, DAYS_AHEAD);

      // 1. Rainy days on the calendar: the forecast scales a flagged day by what rainy days did before.
      const rainy = new Set<string>();
      let haveWeather = false;
      for (const b of orgBranches) {
        const pts = pointsOf.get(b.id);
        if (!pts) continue;
        haveWeather = true;
        for (const d of dailyWeather(pts, today, last, b.cutoff_minutes ?? orgCutoff))
          if (d.rainy) rainy.add(d.date);
      }
      if (haveWeather) result.flaggedDays += await syncRainFlags(sb, orgId, today, last, rainy);

      // 2. The national calendar's coming days, once each.
      result.calendarAdded += await addCalendar(sb, orgId, today);

      // 3. Rain about to start at a branch: one alert per branch per business day.
      for (const b of orgBranches) {
        const pts = pointsOf.get(b.id);
        const w = pts ? rainWindow(pts, at.toISOString()) : null;
        if (!w) continue;
        const sent = await notifyOwnerOnce(sb, orgId, `rain_soon:${b.id}:${today}`, (locale) => {
          const t = translator(locale);
          return t('rainSoonAlert', {
            branch: b.name,
            start: formatDhakaTime(new Date(w.start), locale),
            end: formatDhakaTime(new Date(w.end), locale),
            mm: formatNumber(w.rainMm, locale, {
              fractionDigits: Number.isInteger(w.rainMm) ? 0 : 1,
            }),
          });
        });
        if (sent) result.alerts += 1;
      }
    }),
  );
  for (const o of outcomes)
    if (o.status === 'rejected')
      console.error(
        'weather org',
        o.reason instanceof Error ? o.reason.message.slice(0, 120) : 'error',
      );
  return result;
}

function translator(locale: Locale) {
  return createTranslator({ locale, messages: locale === 'bn' ? bn : en, namespace: 'outlook' });
}

/** Make the automatic rain flags for today…last match `rainy`; flags a person set are never touched. */
async function syncRainFlags(
  sb: Supabase,
  orgId: string,
  today: string,
  last: string,
  rainy: Set<string>,
): Promise<number> {
  const { data: existing, error } = await sb
    .from('calendar_events')
    .select('id, starts_on, ends_on, source')
    .eq('org_id', orgId)
    .eq('kind', 'weather')
    .lte('starts_on', last)
    .gte('ends_on', today);
  if (error) throw error;
  const auto = (existing ?? []).filter((e) => e.source === WEATHER_SOURCE);
  const covered = new Set<string>();
  for (const e of existing ?? [])
    for (let d = e.starts_on as string; d <= (e.ends_on as string); d = addDays(d, 1))
      covered.add(d);
  const stale = auto.filter((e) => !rainy.has(e.starts_on as string)).map((e) => e.id as string);
  if (stale.length > 0) {
    const { error: delErr } = await sb
      .from('calendar_events')
      .delete()
      .eq('org_id', orgId)
      .in('id', stale);
    if (delErr) throw delErr;
  }
  const add = [...rainy].filter((d) => !covered.has(d)).sort();
  if (add.length > 0) {
    const locale = await briefLocale(sb, orgId);
    const name = translator(locale)('rainFlagName');
    const { error: insErr } = await sb.from('calendar_events').insert(
      add.map((d) => ({
        org_id: orgId,
        name,
        kind: 'weather',
        starts_on: d,
        ends_on: d,
        source: WEATHER_SOURCE,
      })),
    );
    if (insErr) throw insErr;
  }
  return rainy.size;
}

/** Add the coming national days the org does not have yet; each is added once, so a deleted one stays gone. */
async function addCalendar(sb: Supabase, orgId: string, today: string): Promise<number> {
  const coming = calendarToAdd(today);
  if (coming.length === 0) return 0;
  const { data: marks, error } = await sb
    .from('org_job_marks')
    .select('key')
    .eq('org_id', orgId)
    .in(
      'key',
      coming.map((e) => `calendar:${e.key}`),
    );
  if (error) throw error;
  const done = new Set((marks ?? []).map((m) => m.key as string));
  const todo = coming.filter((e) => !done.has(`calendar:${e.key}`));
  if (todo.length === 0) return 0;
  const [locale, { data: existing, error: exErr }] = await Promise.all([
    briefLocale(sb, orgId),
    sb
      .from('calendar_events')
      .select('kind, starts_on')
      .eq('org_id', orgId)
      .in(
        'starts_on',
        todo.map((e) => e.starts_on),
      ),
  ]);
  if (exErr) throw exErr;
  // The same day already on the calendar (typed by the owner) is left alone.
  const have = new Set((existing ?? []).map((e) => `${e.kind as string}|${e.starts_on as string}`));
  const add = todo.filter((e) => !have.has(`${e.kind}|${e.starts_on}`));
  if (add.length > 0) {
    const { error: insErr } = await sb.from('calendar_events').insert(
      add.map((e) => ({
        org_id: orgId,
        name: locale === 'bn' ? e.name_bn : e.name,
        kind: e.kind,
        starts_on: e.starts_on,
        ends_on: e.ends_on,
        source: CALENDAR_SOURCE,
      })),
    );
    if (insErr) throw insErr;
  }
  const { error: markErr } = await sb.from('org_job_marks').upsert(
    todo.map((e) => ({ org_id: orgId, key: `calendar:${e.key}` })),
    { onConflict: 'org_id,key', ignoreDuplicates: true },
  );
  if (markErr) throw markErr;
  return add.length;
}
