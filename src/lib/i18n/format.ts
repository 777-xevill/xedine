/**
 * Shared formatters (CLAUDE.md non-negotiable #6). Money in the restaurant's own currency (taka with lakh
 * grouping, 1,23,456; ADR 0062), Bangla digits when the locale is `bn`, times in the restaurant's own time
 * zone. UI never formats money or dates by hand.
 */

export const LOCALES = ['bn', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'bn';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

export function toBanglaDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => BN_DIGITS.charAt(Number(d)));
}

const localizeDigits = (text: string, locale: Locale) =>
  locale === 'bn' ? toBanglaDigits(text) : text;

/** Indian/Bangladeshi grouping: last three digits, then pairs. "1234567" → "12,34,567". */
export function groupLakh(integerDigits: string): string {
  if (integerDigits.length <= 3) return integerDigits;
  const head = integerDigits.slice(0, -3);
  const tail = integerDigits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

export function formatNumber(
  value: number,
  locale: Locale,
  opts: { fractionDigits?: number } = {},
): string {
  if (!Number.isFinite(value)) throw new RangeError('formatNumber needs a finite number');
  const fixed = Math.abs(value).toFixed(opts.fractionDigits ?? 0);
  const [int = '0', frac] = fixed.split('.');
  const sign = value < 0 && Number(fixed) !== 0 ? '-' : '';
  return localizeDigits(`${sign}${groupLakh(int)}${frac ? `.${frac}` : ''}`, locale);
}

export type PoishaDisplay = 'auto' | 'always' | 'never';

/** Currencies grouped the South Asian way (1,23,456); every other currency in thousands (123,456). */
const LAKH_CURRENCIES = new Set(['BDT', 'INR', 'PKR', 'NPR', 'LKR']);

/**
 * The sign before an amount: the familiar symbol where one is unambiguous, else the currency's code and a
 * space ("AED 1,250"). TODO(verify) the symbols with owners in each market.
 */
const CURRENCY_SIGN: Record<string, string> = {
  BDT: '৳',
  INR: '₹',
  PKR: 'Rs ',
  LKR: 'Rs ',
  NPR: 'Rs ',
  USD: '$',
  CAD: 'CA$',
  AUD: 'A$',
  NZD: 'NZ$',
  SGD: 'S$',
  GBP: '£',
  EUR: '€',
  MYR: 'RM',
  PHP: '₱',
  THB: '฿',
  CNY: '¥',
  TRY: '₺',
  NGN: '₦',
  ZAR: 'R',
  BRL: 'R$',
  MXN: 'MX$',
};

export const currencySign = (currency: string): string => CURRENCY_SIGN[currency] ?? `${currency} `;

const groupThousands = (integerDigits: string) =>
  integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Format an amount in its minor unit (poisha for taka, cents for dollars: every stored amount is hundredths,
 * ADR 0005, 0062) in the restaurant's currency. 'auto' shows the hundredths only when non-zero; 'always'
 * always shows two decimals; 'never' rounds half-up to whole units. Negative values use a leading minus sign
 * (BRAND.md: negative money is also drawn in the danger colour by the component).
 */
export function formatMoney(
  minor: number,
  locale: Locale,
  currency: string,
  opts: { poisha?: PoishaDisplay; symbol?: boolean } = {},
): string {
  if (!Number.isSafeInteger(minor))
    throw new RangeError('formatMoney needs an integer minor amount');
  const mode = opts.poisha ?? 'auto';
  const negative = minor < 0;
  const abs = Math.abs(minor);

  let whole = Math.floor(abs / 100);
  let cents = abs % 100;
  if (mode === 'never') {
    if (cents >= 50) whole += 1;
    cents = 0;
  }
  const showCents = mode === 'always' || (mode === 'auto' && cents !== 0);
  const group = LAKH_CURRENCIES.has(currency) ? groupLakh : groupThousands;
  const body = `${group(String(whole))}${showCents ? `.${String(cents).padStart(2, '0')}` : ''}`;
  const isZero = whole === 0 && cents === 0;
  const sign = negative && !isZero ? '-' : '';
  const symbol = opts.symbol === false ? '' : currencySign(currency);
  return localizeDigits(`${sign}${symbol}${body}`, locale);
}

/** basis points → percent text, e.g. 500 → "5%", 1250 → "12.5%". */
export function formatBps(bps: number, locale: Locale): string {
  const pct = bps / 100;
  const text = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, '');
  return localizeDigits(`${text}%`, locale);
}

const intlLocale = (locale: Locale) => (locale === 'bn' ? 'bn-BD' : 'en-GB');

/** A date: "16 Nov 2026" / "১৬ নভে, ২০২৬", in the restaurant's time zone. */
export function formatDate(instant: Date, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(instant);
}

/** A day in a list, with its weekday: "Sat, 28 Sept" / "শনি, ২৮ সেপ"; a business date as its noon. */
export function formatDay(instant: Date, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(instant);
}

/** A short chart-axis day: "8 Oct" / "৮ অক্টো"; a business date as its noon. */
export function formatDayMonth(instant: Date, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
  }).format(instant);
}

export function formatTime(instant: Date, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

export function formatDateTime(instant: Date, locale: Locale, tz: string): string {
  return `${formatDate(instant, locale, tz)}, ${formatTime(instant, locale, tz)}`;
}

/** A month as its name: "November 2026" / "নভেম্বর ২০২৬"; pass any instant inside the month. */
export function formatMonth(instant: Date, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: tz,
    month: 'long',
    year: 'numeric',
  }).format(instant);
}
