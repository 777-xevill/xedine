'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-reads the page's server data when the person comes back to it (another tab, the settings page they
 * just saved, the phone unlocked), and every `everyMs` while it stays open. Setup uses it so the health
 * graph follows what was just changed without a manual reload.
 */
export function AutoRefresh({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = 0;
    const refresh = () => {
      const t = performance.now();
      if (document.visibilityState !== 'visible' || t - last < 3_000) return;
      last = t;
      router.refresh();
    };
    const timer = window.setInterval(refresh, everyMs);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router, everyMs]);
  return null;
}
