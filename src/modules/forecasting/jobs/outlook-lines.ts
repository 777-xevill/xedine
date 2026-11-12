import 'server-only';
import { createTranslator } from 'next-intl';
import { createServiceRoleClient } from '@/lib/db/service-role';
import { formatDhakaDay, formatNumber, type Locale } from '@/lib/i18n/format';
import { addDays, DEFAULT_CUTOFF_MINUTES } from '@/lib/time/business-date';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { dailyWeather, type DayWeather, type WeatherPoint } from '@/modules/forecasting/outlook';

/**
 * The outlook lines of the briefs (ADR 0051): the morning brief says today's weather and what the next seven
 * days hold (rain, holidays, Eid…); the evening close says tomorrow's. Read from what the weather job stored,
 * for one explicit org (service role).
 */
type Supabase = ReturnType<typeof createServiceRoleClient>;

const noonDhaka = (date: string) => new Date(`${date}T06:00:00Z`);

export async function outlookLines(
  sb: Supabase,
  orgId: string,
  today: string,
  at: Date,
  locale: Locale,
  kind: 'morning' | 'evening',
): Promise<string[]> {
  const t = createTranslator({ locale, messages: locale === 'bn' ? bn : en, namespace: 'outlook' });
  const tk = createTranslator({
    locale,
    messages: locale === 'bn' ? bn : en,
    namespace: 'calendar',
  });
  const last = addDays(today, 7);
  const [{ data: branches }, { data: pts }, { data: events }] = await Promise.all([
    sb
      .from('branches')
      .select('id, name, cutoff_minutes')
      .eq('org_id', orgId)
      .eq('is_active', true),
    sb
      .from('weather_hours')
      .select('branch_id, at, period_hours, temp_c, rain_mm, symbol')
      .eq('org_id', orgId)
      .gte('at', new Date(at.getTime() - 30 * 3_600_000).toISOString())
      .lte('at', new Date(at.getTime() + 9 * 86_400_000).toISOString()),
    sb
      .from('calendar_events')
      .select('name, kind, starts_on, ends_on, closed')
      .eq('org_id', orgId)
      .neq('kind', 'weather')
      .lte('starts_on', last)
      .gte('ends_on', kind === 'morning' ? today : addDays(today, 1))
      .order('starts_on'),
  ]);
  const byBranch = new Map<string, WeatherPoint[]>();
  for (const p of pts ?? []) {
    const list = byBranch.get(p.branch_id as string) ?? [];
    list.push({
      at: p.at as string,
      periodHours: Number(p.period_hours),
      tempC: p.temp_c === null ? null : Number(p.temp_c),
      rainMm: Number(p.rain_mm),
      symbol: (p.symbol as string | null) ?? null,
    });
    byBranch.set(p.branch_id as string, list);
  }
  const days = new Map<string, { name: string; day: DayWeather }[]>();
  for (const b of branches ?? []) {
    const list = byBranch.get(b.id as string);
    if (!list) continue;
    const cutoff = (b.cutoff_minutes as number | null) ?? DEFAULT_CUTOFF_MINUTES;
    for (const d of dailyWeather(list, today, last, cutoff))
      days.set(d.date, [...(days.get(d.date) ?? []), { name: b.name as string, day: d }]);
  }
  const n = (v: number) => formatNumber(v, locale);
  const label = (d: string) => formatDhakaDay(noonDhaka(d), locale);
  const rainyAt = (d: string) =>
    (days.get(d) ?? [])
      .filter((x) => x.day.rainy)
      .map((x) => x.name)
      .join(', ');
  // One line for the day's weather: the hottest branch's figures stand for the city.
  const weatherLine = (d: string, which: 'today' | 'tomorrow'): string | null => {
    const list = days.get(d) ?? [];
    if (list.length === 0) return null;
    const rainy = rainyAt(d);
    if (rainy)
      return which === 'today'
        ? t('briefRainToday', { branches: rainy })
        : t('briefTomorrowRain', { branches: rainy });
    const top = [...list].sort((a, b) => (b.day.maxC ?? -99) - (a.day.maxC ?? -99))[0]!.day;
    if (top.maxC === null) return null;
    if (which === 'today' && top.hot) return t('briefHotToday', { max: n(top.maxC) });
    return which === 'today'
      ? t('briefWeatherToday', { sky: t(`sky.${top.sky}`), max: n(top.maxC) })
      : t('briefTomorrow', { sky: t(`sky.${top.sky}`), max: n(top.maxC) });
  };
  const eventText = (e: { name: string; kind: string; closed: boolean; starts_on: string }) => {
    const what = e.name || tk(`kinds.${e.kind as 'holiday'}`);
    return e.closed ? `${what} (${tk('closed')})` : what;
  };

  const lines: string[] = [];
  if (kind === 'morning') {
    const w = weatherLine(today, 'today');
    if (w) lines.push(w);
    const rainyDays: string[] = [];
    for (let d = addDays(today, 1); d <= last; d = addDays(d, 1))
      if (rainyAt(d)) rainyDays.push(label(d));
    if (rainyDays.length > 0) lines.push(t('briefRainDays', { days: rainyDays.join(', ') }));
    const coming = (events ?? []).map((e) => ({
      name: String(e.name),
      kind: String(e.kind),
      closed: e.closed === true,
      starts_on: e.starts_on as string,
    }));
    if (coming.length > 0)
      lines.push(
        t('briefComingUp', {
          events: coming
            .slice(0, 4)
            .map((e) => `${label(e.starts_on < today ? today : e.starts_on)} ${eventText(e)}`)
            .join('; '),
        }),
      );
  } else {
    const tomorrow = addDays(today, 1);
    const w = weatherLine(tomorrow, 'tomorrow');
    if (w) lines.push(w);
    const tomorrowEvents = (events ?? [])
      .filter((e) => (e.starts_on as string) <= tomorrow && (e.ends_on as string) >= tomorrow)
      .map((e) =>
        eventText({
          name: String(e.name),
          kind: String(e.kind),
          closed: e.closed === true,
          starts_on: e.starts_on as string,
        }),
      );
    if (tomorrowEvents.length > 0)
      lines.push(t('briefTomorrowEvents', { events: tomorrowEvents.join(', ') }));
  }
  return lines;
}
