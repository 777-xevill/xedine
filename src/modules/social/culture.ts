import { addDays, weekday, type BusinessDate } from '@/lib/time/business-date';
import { type Occasion, OCCASION_THEME, type OccasionTheme } from './video-words';

/**
 * A restaurant's country decides its culture in the videos (ADR 0061, the founder: "this SaaS is not only for
 * Bangladesh"): which special days the autopilot greets and when, the national day, the weekly greeting
 * (Jummah on Fridays only where Friday prayer is the week's rhythm), the timezone its posts keep, the
 * colours of its flag on a national day, and whether prices can be shown (menu prices are Bangladeshi taka
 * only until the app carries a currency). Pure: no clock, no network.
 *
 * Bangladesh keeps its own calendar (BD_CALENDAR, the owner can correct it on the Calendar page); every other
 * country uses the rules below. TODO(verify): every date in the tables, each year. Lunar dates (Ramadan, the
 * Eids) are estimates: a greeting window around them covers a day either way, and the owner can always pick a
 * day by hand or write their own.
 */

type Rgb = readonly [number, number, number];

export interface CountryProfile {
  /** Time zones, the first is the default. */
  tz: readonly string[];
  /** Special days the autopilot may greet here, most important first. */
  festivals: readonly Occasion[];
  /** The national day (its name goes in the greeting: "Happy {name}!"). */
  national?: { name: string; month: number; day: number };
  /** Friday is the week's greeting day (Jummah): Muslim-majority countries. */
  jummah?: boolean;
  /** Where Mother's Day / Father's Day fall when not the default (2nd Sunday of May / 3rd Sunday of June). */
  mothers?: DayRule;
  fathers?: DayRule;
  /** The flag's main colours, for the national-day decorations. */
  flag?: readonly Rgb[];
}

type DayRule =
  | { fixed: readonly [month: number, day: number] }
  | { nth: readonly [month: number, weekday: number, n: number] } // n = -1: the last one
  | { easter: number }
  | null;

const ISLAMIC: Occasion[] = ['eid_fitr', 'eid_adha', 'ramadan', 'iftar'];
const WEST: Occasion[] = [
  'christmas',
  'easter',
  'valentine',
  'mothers_day',
  'fathers_day',
  'new_year',
];

const G = {
  green: [0, 122, 61],
  red: [206, 17, 38],
  white: [255, 255, 255],
} as const satisfies Record<string, Rgb>;

export const COUNTRIES = {
  BD: {
    tz: ['Asia/Dhaka'],
    festivals: [
      'eid_fitr',
      'eid_adha',
      'iftar',
      'boishakh',
      'victory_day',
      'independence_day',
      'christmas',
      'new_year',
    ],
    jummah: true,
    flag: [[0, 106, 78], [244, 42, 65], G.white],
  },
  IN: {
    tz: ['Asia/Kolkata'],
    festivals: [
      'national_day',
      'diwali',
      'holi',
      'eid_fitr',
      'eid_adha',
      'christmas',
      'new_year',
      'mothers_day',
      'fathers_day',
    ],
    national: { name: 'Independence Day', month: 8, day: 15 },
    flag: [[255, 153, 51], G.white, [19, 136, 8]],
  },
  PK: {
    tz: ['Asia/Karachi'],
    festivals: ['national_day', ...ISLAMIC, 'new_year'],
    national: { name: 'Independence Day', month: 8, day: 14 },
    jummah: true,
    flag: [[1, 65, 28], G.white],
  },
  LK: {
    tz: ['Asia/Colombo'],
    festivals: ['national_day', 'christmas', 'new_year'],
    national: { name: 'Independence Day', month: 2, day: 4 },
    flag: [
      [141, 21, 59],
      [255, 190, 41],
      [0, 83, 78],
    ],
  },
  NP: { tz: ['Asia/Kathmandu'], festivals: ['diwali', 'holi', 'new_year'] },
  MY: {
    tz: ['Asia/Kuala_Lumpur'],
    festivals: ['national_day', ...ISLAMIC, 'lunar_new_year', 'diwali', 'christmas', 'new_year'],
    national: { name: 'National Day', month: 8, day: 31 },
    jummah: true,
    flag: [
      [204, 0, 0],
      [0, 0, 102],
      [255, 204, 0],
    ],
  },
  ID: {
    tz: ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'],
    festivals: ['national_day', ...ISLAMIC, 'christmas', 'new_year'],
    national: { name: 'Independence Day', month: 8, day: 17 },
    jummah: true,
    flag: [[206, 17, 38], G.white],
  },
  SG: {
    tz: ['Asia/Singapore'],
    festivals: ['national_day', 'lunar_new_year', 'eid_fitr', 'diwali', 'christmas', 'new_year'],
    national: { name: 'National Day', month: 8, day: 9 },
    flag: [[237, 41, 57], G.white],
  },
  TH: {
    tz: ['Asia/Bangkok'],
    festivals: ['lunar_new_year', 'new_year', 'valentine', 'christmas'],
    mothers: { fixed: [8, 12] },
    fathers: { fixed: [12, 5] },
  },
  VN: {
    tz: ['Asia/Ho_Chi_Minh'],
    festivals: ['national_day', 'lunar_new_year', 'new_year', 'valentine', 'christmas'],
    national: { name: 'National Day', month: 9, day: 2 },
    flag: [
      [218, 37, 29],
      [255, 255, 0],
    ],
  },
  PH: {
    tz: ['Asia/Manila'],
    festivals: [
      'national_day',
      'christmas',
      'easter',
      'valentine',
      'mothers_day',
      'fathers_day',
      'new_year',
    ],
    national: { name: 'Independence Day', month: 6, day: 12 },
    flag: [
      [0, 56, 168],
      [206, 17, 38],
      [252, 209, 22],
    ],
  },
  CN: {
    tz: ['Asia/Shanghai'],
    festivals: ['national_day', 'lunar_new_year', 'valentine', 'mothers_day', 'new_year'],
    national: { name: 'National Day', month: 10, day: 1 },
    flag: [
      [238, 28, 37],
      [255, 255, 0],
    ],
  },
  JP: {
    tz: ['Asia/Tokyo'],
    festivals: ['new_year', 'valentine', 'christmas', 'mothers_day', 'fathers_day'],
  },
  KR: {
    tz: ['Asia/Seoul'],
    festivals: ['national_day', 'lunar_new_year', 'valentine', 'christmas', 'new_year'],
    national: { name: 'Liberation Day', month: 8, day: 15 },
    mothers: null,
    flag: [[205, 46, 58], [0, 71, 160], G.white],
  },
  AE: {
    tz: ['Asia/Dubai'],
    festivals: [
      'national_day',
      ...ISLAMIC,
      'christmas',
      'diwali',
      'new_year',
      'valentine',
      'mothers_day',
    ],
    national: { name: 'National Day', month: 12, day: 2 },
    jummah: true,
    mothers: { fixed: [3, 21] },
    flag: [[0, 115, 47], [255, 0, 0], G.white],
  },
  SA: {
    tz: ['Asia/Riyadh'],
    festivals: ['national_day', ...ISLAMIC, 'mothers_day'],
    national: { name: 'National Day', month: 9, day: 23 },
    jummah: true,
    mothers: { fixed: [3, 21] },
    flag: [[0, 106, 60], G.white],
  },
  QA: {
    tz: ['Asia/Qatar'],
    festivals: ['national_day', ...ISLAMIC, 'mothers_day'],
    national: { name: 'National Day', month: 12, day: 18 },
    jummah: true,
    mothers: { fixed: [3, 21] },
    flag: [[138, 21, 56], G.white],
  },
  KW: {
    tz: ['Asia/Kuwait'],
    festivals: ['national_day', ...ISLAMIC, 'mothers_day'],
    national: { name: 'National Day', month: 2, day: 25 },
    jummah: true,
    mothers: { fixed: [3, 21] },
    flag: [G.green, G.red, G.white],
  },
  OM: {
    tz: ['Asia/Muscat'],
    festivals: ['national_day', ...ISLAMIC, 'mothers_day'],
    national: { name: 'National Day', month: 11, day: 18 },
    jummah: true,
    mothers: { fixed: [3, 21] },
    flag: [[219, 22, 46], G.green, G.white],
  },
  BH: {
    tz: ['Asia/Bahrain'],
    festivals: ['national_day', ...ISLAMIC, 'mothers_day'],
    national: { name: 'National Day', month: 12, day: 16 },
    jummah: true,
    mothers: { fixed: [3, 21] },
    flag: [G.red, G.white],
  },
  JO: {
    tz: ['Asia/Amman'],
    festivals: ['national_day', ...ISLAMIC, 'christmas', 'new_year', 'mothers_day'],
    national: { name: 'Independence Day', month: 5, day: 25 },
    jummah: true,
    mothers: { fixed: [3, 21] },
    flag: [G.green, G.red, G.white],
  },
  EG: {
    tz: ['Africa/Cairo'],
    festivals: ['national_day', ...ISLAMIC, 'christmas', 'new_year', 'valentine', 'mothers_day'],
    national: { name: 'Revolution Day', month: 7, day: 23 },
    jummah: true,
    mothers: { fixed: [3, 21] },
    flag: [G.red, G.white, [200, 160, 0]],
  },
  TR: {
    tz: ['Europe/Istanbul'],
    festivals: ['national_day', ...ISLAMIC, 'new_year', 'valentine', 'mothers_day'],
    national: { name: 'Republic Day', month: 10, day: 29 },
    jummah: true,
    flag: [[227, 10, 23], G.white],
  },
  IR: { tz: ['Asia/Tehran'], festivals: ['nowruz', ...ISLAMIC], jummah: true },
  MA: {
    tz: ['Africa/Casablanca'],
    festivals: ['national_day', ...ISLAMIC, 'new_year', 'valentine', 'mothers_day'],
    national: { name: 'Throne Day', month: 7, day: 30 },
    jummah: true,
    mothers: { fixed: [3, 21] },
    flag: [
      [193, 39, 45],
      [0, 98, 51],
    ],
  },
  NG: {
    tz: ['Africa/Lagos'],
    festivals: [
      'national_day',
      'christmas',
      'easter',
      'eid_fitr',
      'eid_adha',
      'valentine',
      'mothers_day',
      'fathers_day',
      'new_year',
    ],
    national: { name: 'Independence Day', month: 10, day: 1 },
    flag: [[0, 135, 81], G.white],
  },
  KE: {
    tz: ['Africa/Nairobi'],
    festivals: [
      'national_day',
      'christmas',
      'easter',
      'eid_fitr',
      'valentine',
      'mothers_day',
      'fathers_day',
      'new_year',
    ],
    national: { name: 'Jamhuri Day', month: 12, day: 12 },
    flag: [[187, 10, 30], [0, 102, 0], G.white],
  },
  ZA: {
    tz: ['Africa/Johannesburg'],
    festivals: ['national_day', ...WEST, 'diwali', 'eid_fitr'],
    national: { name: 'Freedom Day', month: 4, day: 27 },
    flag: [
      [0, 119, 73],
      [255, 184, 28],
      [224, 60, 49],
      [0, 35, 149],
    ],
  },
  GB: {
    tz: ['Europe/London'],
    festivals: [...WEST, 'halloween', 'diwali', 'eid_fitr', 'eid_adha'],
    mothers: { easter: -21 },
    flag: [[1, 33, 105], G.white, [200, 16, 46]],
  },
  IE: {
    tz: ['Europe/Dublin'],
    festivals: ['national_day', ...WEST, 'halloween'],
    national: { name: "St Patrick's Day", month: 3, day: 17 },
    mothers: { easter: -21 },
    flag: [[22, 155, 98], G.white, [255, 136, 62]],
  },
  FR: {
    tz: ['Europe/Paris'],
    festivals: ['national_day', ...WEST],
    national: { name: 'Bastille Day', month: 7, day: 14 },
    mothers: { nth: [5, 0, -1] },
    flag: [[0, 85, 164], G.white, [239, 65, 53]],
  },
  DE: {
    tz: ['Europe/Berlin'],
    festivals: ['national_day', ...WEST.filter((o) => o !== 'fathers_day')],
    national: { name: 'German Unity Day', month: 10, day: 3 },
    flag: [[221, 0, 0], [255, 206, 0], G.white],
  },
  ES: {
    tz: ['Europe/Madrid'],
    festivals: WEST,
    mothers: { nth: [5, 0, 1] },
    fathers: { fixed: [3, 19] },
  },
  IT: {
    tz: ['Europe/Rome'],
    festivals: ['national_day', ...WEST],
    national: { name: 'Republic Day', month: 6, day: 2 },
    fathers: { fixed: [3, 19] },
    flag: [[0, 146, 70], G.white, [206, 43, 55]],
  },
  NL: {
    tz: ['Europe/Amsterdam'],
    festivals: ['national_day', ...WEST],
    national: { name: "King's Day", month: 4, day: 27 },
    flag: [[174, 28, 40], G.white, [33, 70, 139]],
  },
  SE: {
    tz: ['Europe/Stockholm'],
    festivals: ['national_day', ...WEST],
    national: { name: 'National Day', month: 6, day: 6 },
    mothers: { nth: [5, 0, -1] },
    fathers: { nth: [11, 0, 2] },
    flag: [
      [0, 106, 167],
      [254, 204, 0],
    ],
  },
  RU: {
    tz: ['Europe/Moscow'],
    festivals: ['national_day', 'new_year', 'valentine', 'mothers_day'],
    national: { name: 'Russia Day', month: 6, day: 12 },
    mothers: { nth: [11, 0, -1] },
    flag: [G.white, [0, 57, 166], [213, 43, 30]],
  },
  US: {
    tz: [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
    ],
    festivals: [
      'national_day',
      'thanksgiving',
      'halloween',
      ...WEST,
      'diwali',
      'lunar_new_year',
      'eid_fitr',
    ],
    national: { name: 'Independence Day', month: 7, day: 4 },
    flag: [[178, 34, 52], G.white, [60, 59, 110]],
  },
  CA: {
    tz: [
      'America/Toronto',
      'America/Winnipeg',
      'America/Edmonton',
      'America/Vancouver',
      'America/Halifax',
    ],
    festivals: [
      'national_day',
      'thanksgiving',
      'halloween',
      ...WEST,
      'diwali',
      'lunar_new_year',
      'eid_fitr',
    ],
    national: { name: 'Canada Day', month: 7, day: 1 },
    flag: [[255, 0, 0], G.white],
  },
  MX: {
    tz: ['America/Mexico_City', 'America/Monterrey', 'America/Tijuana'],
    festivals: [
      'national_day',
      'dia_de_muertos',
      'christmas',
      'easter',
      'valentine',
      'mothers_day',
      'fathers_day',
      'new_year',
    ],
    national: { name: 'Independence Day', month: 9, day: 16 },
    mothers: { fixed: [5, 10] },
    flag: [[0, 104, 71], G.white, [206, 17, 43]],
  },
  BR: {
    tz: ['America/Sao_Paulo', 'America/Manaus'],
    festivals: ['national_day', ...WEST, 'new_year'],
    national: { name: 'Independence Day', month: 9, day: 7 },
    fathers: { nth: [8, 0, 2] },
    flag: [
      [0, 155, 58],
      [254, 223, 0],
      [0, 39, 118],
    ],
  },
  AR: {
    tz: ['America/Argentina/Buenos_Aires'],
    festivals: ['national_day', ...WEST],
    national: { name: 'Independence Day', month: 7, day: 9 },
    mothers: { nth: [10, 0, 3] },
    flag: [[116, 172, 223], G.white, [246, 180, 14]],
  },
  AU: {
    tz: [
      'Australia/Sydney',
      'Australia/Melbourne',
      'Australia/Brisbane',
      'Australia/Adelaide',
      'Australia/Perth',
    ],
    festivals: ['national_day', ...WEST, 'halloween', 'lunar_new_year', 'diwali'],
    national: { name: 'Australia Day', month: 1, day: 26 },
    fathers: { nth: [9, 0, 1] },
    flag: [[1, 33, 105], G.white, [228, 0, 43]],
  },
  NZ: {
    tz: ['Pacific/Auckland'],
    festivals: ['national_day', ...WEST, 'halloween', 'diwali', 'lunar_new_year'],
    national: { name: 'Waitangi Day', month: 2, day: 6 },
    fathers: { nth: [9, 0, 1] },
    flag: [[0, 36, 125], G.white, [204, 20, 43]],
  },
} as const satisfies Record<string, CountryProfile>;

export type CountryCode = keyof typeof COUNTRIES;
export const COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];
export const DEFAULT_COUNTRY: CountryCode = 'BD';

export function isCountry(code: unknown): code is CountryCode {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(COUNTRIES, code);
}

const profile = (code: string): CountryProfile =>
  isCountry(code) ? COUNTRIES[code] : COUNTRIES[DEFAULT_COUNTRY];

/** A valid IANA time zone name (the runtime knows it). */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/.test(tz);
  } catch {
    return false;
  }
}

/** The country's name in a language ("Bangladesh", "বাংলাদেশ"), from the runtime's own list. */
export function countryName(code: string, locale: string = 'en'): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The country a restaurant's saved setting names; Bangladesh when it is missing or unknown. */
export const countryOf = (code: unknown): CountryCode => (isCountry(code) ? code : DEFAULT_COUNTRY);

/** The saved time zone when it is a real one, else the country's first. */
export function timezoneOf(code: unknown, tz: unknown): string {
  return typeof tz === 'string' && isTimeZone(tz) ? tz : defaultTimezone(countryOf(code));
}

export const timezonesOf = (code: string): readonly string[] => profile(code).tz;
export const defaultTimezone = (code: string): string => profile(code).tz[0]!;
export const nationalDayOf = (code: string) => profile(code).national ?? null;

/**
 * Menu prices and offers are Bangladeshi taka only (the app has no other currency yet), so a video in
 * another country shows no price and makes no offer video rather than printing "৳" for someone's dollars.
 */
export const pricesSupported = (code: string): boolean => code === 'BD';

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number): BusinessDate => `${y}-${pad(m)}-${pad(d)}`;

/** Western Easter Sunday (Meeus/Jones/Butcher). */
export function easterOf(year: number): BusinessDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** The nth given weekday (0 = Sunday) of a month; n = -1 is the last one. */
export function nthWeekday(year: number, month: number, dow: number, n: number): BusinessDate {
  if (n > 0) {
    const first = weekday(iso(year, month, 1));
    return iso(year, month, 1 + ((dow - first + 7) % 7) + (n - 1) * 7);
  }
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = weekday(iso(year, month, last));
  return iso(year, month, last - ((lastDow - dow + 7) % 7));
}

const MOTHERS: DayRule = { nth: [5, 0, 2] }; // 2nd Sunday of May
const FATHERS: DayRule = { nth: [6, 0, 3] }; // 3rd Sunday of June

function ruleDate(rule: DayRule, year: number): BusinessDate | null {
  if (!rule) return null;
  if ('fixed' in rule) return iso(year, rule.fixed[0], rule.fixed[1]);
  if ('nth' in rule) return nthWeekday(year, rule.nth[0], rule.nth[1], rule.nth[2]);
  return addDays(easterOf(year), rule.easter);
}

/** The day itself of each festival that moves with the moon or its own calendar (TODO(verify) yearly). */
const MOVING: Partial<Record<Occasion, readonly BusinessDate[]>> = {
  eid_fitr: ['2026-03-20', '2027-03-10', '2028-02-26', '2029-02-14', '2030-02-05'],
  eid_adha: ['2026-05-27', '2027-05-17', '2028-05-05', '2029-04-24', '2030-04-14'],
  diwali: ['2026-11-08', '2027-10-29', '2028-10-17', '2029-11-05', '2030-10-26'],
  holi: ['2027-03-22', '2028-03-11', '2029-03-01', '2030-03-20'],
  lunar_new_year: ['2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03'],
};
/** Ramadan from the first fast to the last (iftar every evening in between). */
const RAMADAN: readonly (readonly [BusinessDate, BusinessDate])[] = [
  ['2027-02-08', '2027-03-09'],
  ['2028-01-28', '2028-02-25'],
  ['2029-01-16', '2029-02-13'],
  ['2030-01-06', '2030-02-04'],
  ['2030-12-26', '2031-01-24'],
];
/** The last year the moving dates above cover: a test fails when the clock reaches the year after. */
export const MOVING_DATES_UNTIL = 2030;

/** Days around a moving festival that are greeted (a day either way for a moon-sighted Eid). */
const WINDOW: Partial<Record<Occasion, readonly [before: number, after: number]>> = {
  eid_fitr: [1, 1],
  eid_adha: [1, 1],
  diwali: [1, 0],
  lunar_new_year: [1, 1],
};

function inYears(date: BusinessDate): number[] {
  const y = Number(date.slice(0, 4));
  return [y - 1, y, y + 1];
}

/** Whether `date` is on the festival in this country (the country's own rule for it). */
function onFestival(code: CountryCode, occasion: Occasion, date: BusinessDate): boolean {
  const p = profile(code);
  const md = date.slice(5);
  switch (occasion) {
    case 'national_day':
      return Boolean(p.national) && md === `${pad(p.national!.month)}-${pad(p.national!.day)}`;
    case 'new_year':
      return md === '01-01' || md === '12-31';
    case 'christmas':
      return md === '12-25' || md === '12-24';
    case 'valentine':
      return md === '02-14';
    case 'halloween':
      return md === '10-31';
    case 'nowruz':
      return md === '03-21' || md === '03-20';
    case 'dia_de_muertos':
      return md === '11-02' || md === '11-01';
    case 'boishakh':
      return md === '04-14';
    case 'victory_day':
      return md === '12-16';
    case 'independence_day':
      return md === '03-26';
    case 'easter':
      return inYears(date).some((y) => {
        const e = easterOf(y);
        return date === e || date === addDays(e, -1);
      });
    case 'thanksgiving':
      return inYears(date).some(
        (y) => date === (code === 'CA' ? nthWeekday(y, 10, 1, 2) : nthWeekday(y, 11, 4, 4)),
      );
    case 'mothers_day':
      return inYears(date).some(
        (y) => date === ruleDate(p.mothers === undefined ? MOTHERS : p.mothers, y),
      );
    case 'fathers_day':
      return inYears(date).some(
        (y) => date === ruleDate(p.fathers === undefined ? FATHERS : p.fathers, y),
      );
    case 'ramadan':
    case 'iftar':
      return RAMADAN.some(([from, to]) => date >= from && date <= to);
    default: {
      const days = MOVING[occasion];
      if (!days) return false;
      const [before, after] = WINDOW[occasion] ?? [0, 0];
      return days.some((d) => date >= addDays(d, -before) && date <= addDays(d, after));
    }
  }
}

/**
 * The special day the autopilot greets in this country on this date, or null. The country's list is in order
 * of importance; Ramadan's first day says Ramadan, the other days iftar; on a Friday in a Muslim-majority
 * country the week's greeting is Jummah. Bangladesh keeps its own calendar and is not answered here.
 */
export function occasionOnDate(code: string, date: BusinessDate): Occasion | null {
  const p = profile(code);
  for (const o of p.festivals) {
    if (o === 'ramadan') continue; // Ramadan's days are 'iftar' below, its first day 'ramadan'
    if (o === 'iftar') {
      const start = RAMADAN.find(([from, to]) => date >= from && date <= to);
      if (start) return date === start[0] ? 'ramadan' : 'iftar';
      continue;
    }
    if (onFestival(code as CountryCode, o, date)) return o;
  }
  return p.jummah && weekday(date) === 5 ? 'jummah' : null;
}

// ---------------------------------------------------------------------------------------------
// Look and lists
// ---------------------------------------------------------------------------------------------

/** How a special day dresses the video (theme and colours) in this country. */
export function occasionLook(
  occasion: Occasion,
  code: string,
): { theme: OccasionTheme; palette?: readonly Rgb[]; lanterns?: 'red' | 'gold' } {
  const flag = profile(code).flag;
  switch (occasion) {
    case 'national_day':
    case 'victory_day':
    case 'independence_day':
      return { theme: 'national', palette: occasion === 'national_day' ? flag : COUNTRIES.BD.flag };
    case 'diwali':
      return {
        theme: 'festive',
        palette: [
          [255, 153, 28],
          [255, 214, 90],
          [255, 255, 255],
        ],
        lanterns: 'gold',
      };
    case 'holi':
      return {
        theme: 'festive',
        palette: [
          [233, 30, 99],
          [255, 193, 7],
          [3, 169, 244],
          [76, 175, 80],
        ],
      };
    case 'lunar_new_year':
      return {
        theme: 'festive',
        palette: [
          [214, 38, 38],
          [255, 200, 40],
          [255, 255, 255],
        ],
        lanterns: 'red',
      };
    case 'halloween':
      return {
        theme: 'festive',
        palette: [
          [255, 117, 24],
          [112, 48, 160],
          [255, 255, 255],
        ],
      };
    case 'christmas':
      return {
        theme: 'festive',
        palette: [
          [200, 30, 40],
          [30, 130, 70],
          [255, 255, 255],
        ],
      };
    case 'thanksgiving':
      return {
        theme: 'festive',
        palette: [
          [217, 119, 6],
          [146, 64, 14],
          [250, 204, 21],
        ],
      };
    case 'dia_de_muertos':
      return {
        theme: 'festive',
        palette: [
          [255, 140, 0],
          [190, 60, 160],
          [255, 255, 255],
        ],
      };
    case 'nowruz':
      return {
        theme: 'festive',
        palette: [
          [22, 163, 74],
          [250, 204, 21],
          [255, 255, 255],
        ],
      };
    default:
      return { theme: OCCASION_THEME[occasion] };
  }
}

/**
 * The special days for the studio's list: this country's own first (in the autopilot's order, with Jummah
 * where it applies), then every other day anyone may still pick (a Bangladeshi restaurant abroad greets
 * Boishakh, a London restaurant Diwali), then "write your own" last.
 */
export function occasionsFor(
  code: string,
  all: readonly Occasion[],
): { own: Occasion[]; other: Occasion[] } {
  const p = profile(code);
  const own: Occasion[] = [
    ...p.festivals.filter((o) => o !== 'custom'),
    ...(p.jummah ? (['jummah'] as Occasion[]) : []),
    'weekend',
  ];
  const seen = new Set<Occasion>(own);
  const other = all.filter((o) => !seen.has(o) && o !== 'custom');
  return { own: [...new Set(own)], other };
}
