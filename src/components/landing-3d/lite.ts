/**
 * A light visit: a slow connection, Data Saver or a small phone. The story then runs over the first view's
 * picture and the 3D is never downloaded (the founder's phone video, 2026-11-19: at 10–90 KB/s the 3.5 MB
 * the café needs never arrived, the page stood still for half a minute and taps did nothing). The visitor
 * can still ask for the 3D. Browsers without the Network Information API (Safari, Firefox) get the 3D.
 */
export interface LiteSignals {
  connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
  deviceMemory?: number;
}

/** Below this (Mbit/s), the café's first 4.5 MB would take more than about 25 seconds. */
export const LITE_DOWNLINK_MBPS = 1.5;

export function isLiteSignals(n: LiteSignals): boolean {
  const c = n.connection;
  if (c?.saveData) return true;
  if (c && /2g|3g/.test(c.effectiveType ?? '')) return true;
  if (c?.downlink && c.downlink < LITE_DOWNLINK_MBPS) return true;
  return (n.deviceMemory ?? 8) <= 2;
}

/**
 * The same test as an inline script in the page's HTML, run while the page is still being read: it marks a
 * light visit on `<html data-lite="1">` and otherwise starts the first 3D files at low priority, so the
 * page's own code (the buttons, the scroll) arrives first. `lite.test.ts` keeps it equal to isLiteSignals.
 */
export function liteScript(preload: string[]): string {
  return `(function(){try{var n=navigator,c=n.connection,l=!!(c&&(c.saveData||/2g|3g/.test(c.effectiveType||'')||(c.downlink&&c.downlink<${LITE_DOWNLINK_MBPS})))||(n.deviceMemory||8)<=2;if(l){document.documentElement.dataset.lite='1';return}${JSON.stringify(preload)}.forEach(function(h){var k=document.createElement('link');k.rel='preload';k.as='fetch';k.crossOrigin='anonymous';k.fetchPriority='low';k.href=h;document.head.appendChild(k)})}catch(e){}})()`;
}

let lite: boolean | undefined;
/** Is this a light visit? Asked once, so the answer never changes mid-story. */
export function isLiteVisit(): boolean {
  if (lite === undefined) {
    lite =
      document.documentElement.dataset.lite === '1' ||
      isLiteSignals(navigator as Navigator & LiteSignals);
  }
  return lite;
}
