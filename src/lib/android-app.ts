/**
 * The Android app on Google Play (ADR 0065) is a Trusted Web Activity: Chrome showing xedine.org full
 * screen, no browser bar. It always opens `/?source=app` (the web manifest's start_url too).
 *
 * The proxy then remembers "this phone uses the app" in a cookie. Chrome shares cookies with the app,
 * so the same phone's browser counts as the app as well, which is harmless for what the cookie does:
 * leave out the one thing Google Play does not allow inside an app, naming a payment method outside
 * Google Play (the billing page's "pay by bank or bKash" note).
 */
export const APP_SOURCE_PARAM = 'source';
export const APP_SOURCE_VALUE = 'app';
export const APP_COOKIE = 'xedine_app';
export const APP_COOKIE_VALUE = 'android';
/** One year: the cookie is renewed every time the app opens. */
export const APP_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The package name on Google Play. Permanent: it can never change once the app is published. */
export const ANDROID_PACKAGE_ID = 'org.xedine.app';

export function isAppLaunch(pathname: string, searchParams: URLSearchParams): boolean {
  return pathname === '/' && searchParams.get(APP_SOURCE_PARAM) === APP_SOURCE_VALUE;
}

export function isAppCookie(value: string | undefined): boolean {
  return value === APP_COOKIE_VALUE;
}
