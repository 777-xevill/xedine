'use client';

import { useEffect } from 'react';

/**
 * In the installed app (the Android app on Google Play, or the site installed from Chrome), keep the
 * service worker running on every page, so the app can open with no internet and show the way to the
 * till instead of the browser's error page (ADR 0065). In a normal browser tab nothing changes: the till
 * and the customer QR pages register it themselves, as before.
 */
export function AppServiceWorker() {
  useEffect(() => {
    const installed =
      window.matchMedia('(display-mode: standalone)').matches ||
      document.referrer.startsWith('android-app://');
    if (installed && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }
  }, []);
  return null;
}
