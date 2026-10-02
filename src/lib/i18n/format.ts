/**
 * Shared formatters (CLAUDE.md non-negotiable #6). BDT with lakh grouping (1,23,456), Bangla
 * digits when the locale is `bn`, times in Asia/Dhaka. UI never formats money or dates by hand.
 */
import { DHAKA_TZ } from '@/lib/time/business-date';

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

/**
 * Format integer poisha as taka. 'auto' shows poisha only when non-zero; 'always' always shows
 * two decimals; 'never' rounds half-up to whole taka. Negative values use a leading minus sign
 * (BRAND.md: negative money is also drawn in the danger colour by the component).
 */
export function formatBDT(
  poisha: number,
  locale: Locale,
  opts: { poisha?: PoishaDisplay; symbol?: boolean } = {},
): string {
  if (!Number.isSafeInteger(poisha)) throw new RangeError('formatBDT needs integer poisha');
  const mode = opts.poisha ?? 'auto';
  const negative = poisha < 0;
  const abs = Math.abs(poisha);

  let taka = Math.floor(abs / 100);
  let paisa = abs % 100;
  if (mode === 'never') {
    if (paisa >= 50) taka += 1;
    paisa = 0;
  }
  const showPaisa = mode === 'always' || (mode === 'auto' && paisa !== 0);
  const body = `${groupLakh(String(taka))}${showPaisa ? `.${String(paisa).padStart(2, '0')}` : ''}`;
  const isZero = taka === 0 && paisa === 0;
  const sign = negative && !isZero ? '-' : '';
  const symbol = opts.symbol === false ? '' : '৳';
  return localizeDigits(`${sign}${symbol}${body}`, locale);
}

/** basis points → percent text, e.g. 500 → "5%", 1250 → "12.5%". */
export function formatBps(bps: number, locale: Locale): string {
  const pct = bps / 100;
  const text = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, '');
  return localizeDigits(`${text}%`, locale);
}

const intlLocale = (locale: Locale) => (locale === 'bn' ? 'bn-BD' : 'en-GB');

export function formatDhakaDate(instant: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: DHAKA_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(instant);
}

/** A day in a list, with its weekday: "Sat, 28 Sept" / "শনি, ২৮ সেপ"; a business date as noon Dhaka. */
export function formatDhakaDay(instant: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: DHAKA_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(instant);
}

export function formatDhakaTime(instant: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: DHAKA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

export function formatDhakaDateTime(instant: Date, locale: Locale): string {
  return `${formatDhakaDate(instant, locale)}, ${formatDhakaTime(instant, locale)}`;
}
