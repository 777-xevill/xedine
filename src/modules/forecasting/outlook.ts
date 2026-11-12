/**
 * The outlook (ADR 0051): weather per branch and the Bangladesh calendar, turned into plain facts for the Plan
 * page, the briefs and the "rain soon" alert. Pure functions (no I/O, no clock): the job and the pages pass
 * the weather points and the instant in.
 */
import { addDays, businessDate, DEFAULT_CUTOFF_MINUTES } from '@/lib/time/business-date';

/** One weather reading as stored in `weather_hours`: rain over the period that starts at `at`. */
export interface WeatherPoint {
  at: string;
  periodHours: number;
  tempC: number | null;
  rainMm: number;
  symbol: string | null;
}

export type Sky = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

/**
 * A day with at least this much rain is flagged "weather" on the calendar, so the forecast uses what rainy
 * days did before (ADR 0020 §2). TODO(verify): tune with pilot data; Dhaka drizzle under ~5 mm barely moves
 * sales.
 */
export const RAIN_FLAG_MM = 5;
/** Rain worth an alert in the next few hours: at least this much in one hour. */
export const RAIN_SOON_MM_PER_HOUR = 1;
/** How far ahead the "rain soon" alert looks. */
export const RAIN_SOON_HOURS = 6;
/** A day this hot gets a "very hot" note. TODO(verify). */
export const HOT_C = 36;

const SKY_RANK: Record<Sky, number> = { clear: 0, fog: 1, cloudy: 2, rain: 3, storm: 4 };

/** MET Norway symbol codes (e.g. "lightrainshowers_day", "rainandthunder") reduced to five skies. */
export function skyOf(symbol: string | null, rainMm: number): Sky {
  const s = (symbol ?? '').toLowerCase();
  if (s.includes('thunder')) return 'storm';
  if (s.includes('rain') || s.includes('sleet') || s.includes('snow') || rainMm >= 0.5)
    return 'rain';
  if (s.includes('fog')) return 'fog';
  if (s.includes('cloudy') && !s.includes('partly')) return 'cloudy';
  if (s.includes('partlycloudy') || s.includes('fair')) return 'clear';
  if (s.includes('clearsky')) return 'clear';
  return s ? 'cloudy' : 'clear';
}

export interface DayWeather {
  date: string;
  rainMm: number;
  maxC: number | null;
  minC: number | null;
  sky: Sky;
  /** Enough rain to flag the day on the calendar. */
  rainy: boolean;
  hot: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Weather per business day (the branch's cutoff) for every date from `from` to `to` that has readings. */
export function dailyWeather(
  points: WeatherPoint[],
  from: string,
  to: string,
  cutoffMinutes: number = DEFAULT_CUTOFF_MINUTES,
): DayWeather[] {
  const byDay = new Map<string, WeatherPoint[]>();
  for (const p of points) {
    const d = businessDate(new Date(p.at), cutoffMinutes);
    if (d < from || d > to) continue;
    const list = byDay.get(d) ?? [];
    list.push(p);
    byDay.set(d, list);
  }
  const out: DayWeather[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const list = byDay.get(d);
    if (!list || list.length === 0) continue;
    const rain = round1(list.reduce((s, p) => s + Math.max(0, p.rainMm), 0));
    const temps = list.map((p) => p.tempC).filter((t): t is number => t !== null);
    const maxC = temps.length ? Math.max(...temps) : null;
    let sky: Sky = 'clear';
    for (const p of list) {
      const k = skyOf(p.symbol, p.rainMm);
      if (SKY_RANK[k] > SKY_RANK[sky]) sky = k;
    }
    // Light showers somewhere in the day are not a rainy day for the kitchen.
    if (sky === 'rain' && rain < 1) sky = 'cloudy';
    out.push({
      date: d,
      rainMm: rain,
      maxC: maxC === null ? null : Math.round(maxC),
      minC: temps.length ? Math.round(Math.min(...temps)) : null,
      sky,
      rainy: rain >= RAIN_FLAG_MM,
      hot: maxC !== null && maxC >= HOT_C,
    });
  }
  return out;
}

export interface RainWindow {
  start: string;
  end: string;
  rainMm: number;
}

/**
 * The first stretch of rain in the next `hours` from `nowIso`: consecutive hourly readings with at least
 * RAIN_SOON_MM_PER_HOUR. Only hourly readings count (the six-hour blocks further out are too coarse).
 */
export function rainWindow(
  points: WeatherPoint[],
  nowIso: string,
  hours: number = RAIN_SOON_HOURS,
): RainWindow | null {
  const start = Date.parse(nowIso);
  const end = start + hours * 3_600_000;
  const hourly = points
    .filter((p) => p.periodHours === 1)
    .filter((p) => {
      const t = Date.parse(p.at);
      return t + 3_600_000 > start && t < end;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let first = -1;
  let last = -1;
  for (let i = 0; i < hourly.length; i++) {
    if (hourly[i]!.rainMm >= RAIN_SOON_MM_PER_HOUR) {
      if (first === -1) first = i;
      last = i;
    } else if (first !== -1) break;
  }
  if (first === -1) return null;
  const rain = hourly.slice(first, last + 1).reduce((s, p) => s + p.rainMm, 0);
  return {
    start: new Date(Date.parse(hourly[first]!.at)).toISOString(),
    end: new Date(Date.parse(hourly[last]!.at) + 3_600_000).toISOString(),
    rainMm: round1(rain),
  };
}

/** The next `hours` of hourly readings from `nowIso` (for the "next hours" row on the Plan page). */
export function nextHours(points: WeatherPoint[], nowIso: string, hours = 12): WeatherPoint[] {
  const start = Date.parse(nowIso) - 3_600_000;
  const end = Date.parse(nowIso) + hours * 3_600_000;
  return points
    .filter((p) => p.periodHours === 1)
    .filter((p) => {
      const t = Date.parse(p.at);
      return t > start && t < end;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// ---- MET Norway Locationforecast 2.0 (compact) --------------------------------------------------------

interface MetSeries {
  time?: string;
  data?: {
    instant?: { details?: { air_temperature?: number } };
    next_1_hours?: {
      summary?: { symbol_code?: string };
      details?: { precipitation_amount?: number };
    };
    next_6_hours?: {
      summary?: { symbol_code?: string };
      details?: { precipitation_amount?: number };
    };
  };
}

/**
 * The readings in a Locationforecast response. A reading with a one-hour summary is an hour; one with only a
 * six-hour summary (further out) is a six-hour block. Hourly readings also carry a six-hour summary, which
 * would count the same rain twice, so it is ignored there.
 */
export function parseMetno(json: unknown): WeatherPoint[] {
  const series = (json as { properties?: { timeseries?: MetSeries[] } })?.properties?.timeseries;
  if (!Array.isArray(series)) return [];
  const out: WeatherPoint[] = [];
  for (const s of series) {
    if (!s.time || !s.data) continue;
    const at = Date.parse(s.time);
    if (!Number.isFinite(at)) continue;
    const temp = s.data.instant?.details?.air_temperature;
    const block = s.data.next_1_hours ?? s.data.next_6_hours;
    if (!block) continue;
    const rain = block.details?.precipitation_amount;
    out.push({
      at: new Date(at).toISOString(),
      periodHours: s.data.next_1_hours ? 1 : 6,
      tempC: typeof temp === 'number' && Number.isFinite(temp) ? round1(temp) : null,
      rainMm: typeof rain === 'number' && Number.isFinite(rain) && rain > 0 ? round1(rain) : 0,
      symbol: block.summary?.symbol_code ?? null,
    });
  }
  return out;
}

// ---- Where a branch is ---------------------------------------------------------------------------------

/**
 * Approximate centres for places a branch's area or city may name, used until the owner sets the branch's
 * own location. Coordinates are public map facts, rounded to about a kilometre.
 */
const PLACES: Record<string, [number, number]> = {
  dhaka: [23.8103, 90.4125],
  dhanmondi: [23.7465, 90.376],
  mirpur: [23.8223, 90.3654],
  uttara: [23.8759, 90.3795],
  gulshan: [23.7925, 90.4078],
  banani: [23.7937, 90.4066],
  bashundhara: [23.8193, 90.4526],
  mohammadpur: [23.7662, 90.3589],
  motijheel: [23.733, 90.4172],
  farmgate: [23.7577, 90.3897],
  badda: [23.7806, 90.4265],
  rampura: [23.7613, 90.4209],
  khilgaon: [23.7516, 90.4277],
  wari: [23.7186, 90.4199],
  'old dhaka': [23.7104, 90.4074],
  tejgaon: [23.7639, 90.3925],
  mohakhali: [23.7781, 90.4007],
  savar: [23.8583, 90.2667],
  gazipur: [23.9999, 90.4203],
  narayanganj: [23.6238, 90.5],
  chattogram: [22.3569, 91.7832],
  chittagong: [22.3569, 91.7832],
  sylhet: [24.8949, 91.8687],
  khulna: [22.8456, 89.5403],
  rajshahi: [24.3745, 88.6042],
  barishal: [22.701, 90.3535],
  barisal: [22.701, 90.3535],
  rangpur: [25.7439, 89.2752],
  mymensingh: [24.7471, 90.4203],
  cumilla: [23.4607, 91.1809],
  comilla: [23.4607, 91.1809],
  "cox's bazar": [21.4272, 92.0058],
  coxsbazar: [21.4272, 92.0058],
  bogura: [24.8465, 89.3773],
  jessore: [23.1664, 89.2081],
  jashore: [23.1664, 89.2081],
};

const PLACE_NAMES = Object.keys(PLACES).sort((a, b) => b.length - a.length);

/** The branch's own location, else its area, else its city, else Dhaka. */
export function branchCoords(b: {
  latitude: number | null;
  longitude: number | null;
  area: string | null;
  city: string | null;
}): { lat: number; lon: number; exact: boolean } {
  if (b.latitude !== null && b.longitude !== null)
    return { lat: Number(b.latitude), lon: Number(b.longitude), exact: true };
  for (const name of [b.area, b.city]) {
    const key = (name ?? '').trim().toLowerCase();
    if (!key) continue;
    // "Mirpur 10", "Uttara Sector 7", "Road 5, Dhanmondi": the longest place name found in it wins.
    const words = ` ${key.replace(/[^a-z']+/g, ' ').trim()} `;
    const found = PLACES[key] ? key : PLACE_NAMES.find((p) => words.includes(` ${p} `));
    const at = found ? PLACES[found] : undefined;
    if (at) return { lat: at[0], lon: at[1], exact: false };
  }
  return { lat: PLACES.dhaka![0], lon: PLACES.dhaka![1], exact: false };
}

// ---- The Bangladesh calendar ---------------------------------------------------------------------------

export interface CalendarEstimate {
  key: string;
  name: string;
  name_bn: string;
  kind: 'holiday' | 'eid' | 'ramadan';
  starts_on: string;
  ends_on: string;
}

/**
 * National days and religious festivals that move restaurant sales, added to every organization's calendar
 * so the forecast and the outlook know about them without anyone typing them in. The owner can delete or
 * correct any of them on the Calendar page; a deleted one is not added back.
 * TODO(verify): every date here, each year. Lunar dates (Ramadan, the Eids, Shab-e-Barat, Ashura, Eid-e-
 * Miladunnabi, Buddha Purnima) are estimates until the moon is sighted and the government announces them.
 */
export const BD_CALENDAR: CalendarEstimate[] = [
  {
    key: 'victory-2026',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
    kind: 'holiday',
    starts_on: '2026-12-16',
    ends_on: '2026-12-16',
  },
  {
    key: 'christmas-2026',
    name: 'Christmas',
    name_bn: 'বড়দিন',
    kind: 'holiday',
    starts_on: '2026-12-25',
    ends_on: '2026-12-25',
  },
  {
    key: 'newyear-2027',
    name: "New Year's Eve and Day",
    name_bn: 'ইংরেজি নববর্ষ',
    kind: 'holiday',
    starts_on: '2026-12-31',
    ends_on: '2027-01-01',
  },
  {
    key: 'shabebarat-2027',
    name: 'Shab-e-Barat',
    name_bn: 'শবে বরাত',
    kind: 'holiday',
    starts_on: '2027-01-24',
    ends_on: '2027-01-24',
  },
  {
    key: 'ramadan-2027',
    name: 'Ramadan',
    name_bn: 'রমজান',
    kind: 'ramadan',
    starts_on: '2027-02-08',
    ends_on: '2027-03-09',
  },
  {
    key: 'ekushey-2027',
    name: 'Language Martyrs’ Day',
    name_bn: 'শহীদ দিবস',
    kind: 'holiday',
    starts_on: '2027-02-21',
    ends_on: '2027-02-21',
  },
  {
    key: 'eidulfitr-2027',
    name: 'Eid ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
    kind: 'eid',
    starts_on: '2027-03-10',
    ends_on: '2027-03-12',
  },
  {
    key: 'independence-2027',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
    kind: 'holiday',
    starts_on: '2027-03-26',
    ends_on: '2027-03-26',
  },
  {
    key: 'boishakh-2027',
    name: 'Pohela Boishakh',
    name_bn: 'পহেলা বৈশাখ',
    kind: 'holiday',
    starts_on: '2027-04-14',
    ends_on: '2027-04-14',
  },
  {
    key: 'mayday-2027',
    name: 'May Day',
    name_bn: 'মে দিবস',
    kind: 'holiday',
    starts_on: '2027-05-01',
    ends_on: '2027-05-01',
  },
  {
    key: 'eiduladha-2027',
    name: 'Eid ul-Adha',
    name_bn: 'ঈদুল আজহা',
    kind: 'eid',
    starts_on: '2027-05-17',
    ends_on: '2027-05-19',
  },
  {
    key: 'buddha-2027',
    name: 'Buddha Purnima',
    name_bn: 'বুদ্ধ পূর্ণিমা',
    kind: 'holiday',
    starts_on: '2027-05-20',
    ends_on: '2027-05-20',
  },
  {
    key: 'ashura-2027',
    name: 'Ashura',
    name_bn: 'আশুরা',
    kind: 'holiday',
    starts_on: '2027-06-15',
    ends_on: '2027-06-15',
  },
  {
    key: 'miladunnabi-2027',
    name: 'Eid-e-Miladunnabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
    kind: 'holiday',
    starts_on: '2027-08-15',
    ends_on: '2027-08-15',
  },
  {
    key: 'victory-2027',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
    kind: 'holiday',
    starts_on: '2027-12-16',
    ends_on: '2027-12-16',
  },
  {
    key: 'christmas-2027',
    name: 'Christmas',
    name_bn: 'বড়দিন',
    kind: 'holiday',
    starts_on: '2027-12-25',
    ends_on: '2027-12-25',
  },
];

/** Calendar estimates worth adding now: not over, and starting within `aheadDays`. */
export function calendarToAdd(today: string, aheadDays = 120): CalendarEstimate[] {
  const until = addDays(today, aheadDays);
  return BD_CALENDAR.filter((e) => e.ends_on >= today && e.starts_on <= until);
}
