import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { config } from '@/proxy';
import { ANDROID_PACKAGE_ID, APP_COOKIE_VALUE, isAppCookie, isAppLaunch } from './android-app';

/**
 * ADR 0065: the Android app on Google Play is xedine.org in Chrome, trusted through
 * /.well-known/assetlinks.json. The web manifest, the asset links and android/twa-manifest.json must
 * agree, or the app opens with a browser bar (or not at all).
 */
const ROOT = join(import.meta.dirname, '..', '..');
const read = (...p: string[]) => JSON.parse(readFileSync(join(ROOT, ...p), 'utf8'));

const web = read('public', 'manifest.webmanifest') as Record<string, unknown>;
const links = read('public', '.well-known', 'assetlinks.json') as {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
}[];
const twa = read('android', 'twa-manifest.json') as Record<string, unknown> & {
  fingerprints: { value: string }[];
  shortcuts: { url: string }[];
};

describe('Android app (ADR 0065)', () => {
  it('the app opens the same start page as the installable web app, and the proxy knows it', () => {
    expect(twa.startUrl).toBe(web.start_url);
    const start = new URL(String(web.start_url), 'https://xedine.org');
    expect(isAppLaunch(start.pathname, start.searchParams)).toBe(true);
    expect(isAppLaunch('/', new URLSearchParams())).toBe(false);
    expect(isAppLaunch('/sign-in', start.searchParams)).toBe(false);
    expect(isAppCookie(APP_COOKIE_VALUE)).toBe(true);
    expect(isAppCookie(undefined)).toBe(false);
  });

  it('one package name everywhere', () => {
    expect(twa.packageId).toBe(ANDROID_PACKAGE_ID);
    expect(links[0]?.target.package_name).toBe(ANDROID_PACKAGE_ID);
    const related = web.related_applications as { platform: string; id: string }[];
    expect(related).toContainEqual(
      expect.objectContaining({ platform: 'play', id: ANDROID_PACKAGE_ID }),
    );
  });

  it('asset links trust every signing key the app is built with', () => {
    expect(links[0]?.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(links[0]?.target.namespace).toBe('android_app');
    const trusted = links[0]?.target.sha256_cert_fingerprints ?? [];
    for (const fp of trusted) expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    for (const { value } of twa.fingerprints) expect(trusted).toContain(value);
  });

  it('the app stays on xedine.org and wears the founder grey (ADR 0063)', () => {
    expect(twa.host).toBe('xedine.org');
    expect(twa.fullScopeUrl).toBe('https://xedine.org/');
    const css = readFileSync(join(ROOT, 'src', 'app', 'globals.css'), 'utf8').toLowerCase();
    const grey = css.match(/--brand-grey: (#[0-9a-f]{6});/)?.[1];
    expect(grey).toBe('#2b2d31');
    for (const key of ['theme_color', 'background_color']) expect(web[key]).toBe(grey);
    for (const key of ['themeColor', 'navigationColor', 'backgroundColor'])
      expect(String(twa[key]).toLowerCase()).toBe(grey);
    for (const s of twa.shortcuts) expect(new URL(s.url).host).toBe('xedine.org');
  });

  it('Chrome and Google Play can read the manifest and asset links while signed out', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test('/.well-known/assetlinks.json')).toBe(false);
    expect(matcher.test('/manifest.webmanifest')).toBe(false);
    // The service worker stores the offline page at install; a sign-in redirect must never replace it.
    expect(matcher.test('/offline.html')).toBe(false);
    // ...while pages still go through the proxy.
    expect(matcher.test('/')).toBe(true);
    expect(matcher.test('/demo-kacchi-house/billing')).toBe(true);
  });
});
