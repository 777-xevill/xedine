import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale, type Locale } from './format';

export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Cookie → Accept-Language → Bangla. No locale in the URL: staff screens stay on stable paths. */
export async function resolveLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const accept = (await headers()).get('accept-language') ?? '';
  const first = accept.split(',')[0]?.trim().toLowerCase() ?? '';
  if (first.startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    timeZone: 'Asia/Dhaka',
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
