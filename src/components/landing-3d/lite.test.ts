import { describe, expect, it } from 'vitest';
import { isLiteSignals, liteScript, type LiteSignals } from './lite';

/** Runs the inline script against a pretend phone and reports what it did. */
function runScript(nav: LiteSignals) {
  const links: Record<string, string>[] = [];
  const doc = {
    documentElement: { dataset: {} as Record<string, string> },
    createElement: () => ({}) as Record<string, string>,
    head: { appendChild: (l: Record<string, string>) => links.push(l) },
  };
  new Function('navigator', 'document', liteScript(['/a.glb', '/b.glb']))(nav, doc);
  return { lite: doc.documentElement.dataset.lite === '1', links };
}

const cases: [string, LiteSignals, boolean][] = [
  ['no Network Information API (Safari)', {}, false],
  ['fast 4G', { connection: { effectiveType: '4g', downlink: 10 } }, false],
  ['the founder video: 3G', { connection: { effectiveType: '3g', downlink: 0.4 } }, true],
  ['2G', { connection: { effectiveType: '2g' } }, true],
  ['slow-2g', { connection: { effectiveType: 'slow-2g' } }, true],
  ['4G label but 1 Mbit/s', { connection: { effectiveType: '4g', downlink: 1 } }, true],
  [
    'Data Saver on a fast link',
    { connection: { effectiveType: '4g', downlink: 10, saveData: true } },
    true,
  ],
  ['2 GB phone', { connection: { effectiveType: '4g', downlink: 10 }, deviceMemory: 2 }, true],
  ['4 GB phone', { connection: { effectiveType: '4g', downlink: 10 }, deviceMemory: 4 }, false],
];

describe('light visit', () => {
  it.each(cases)('%s', (_name, nav, lite) => {
    expect(isLiteSignals(nav)).toBe(lite);
    const run = runScript(nav);
    // The inline script and the page's code agree, and a light visit downloads no 3D.
    expect(run.lite).toBe(lite);
    expect(run.links.map((l) => l.href)).toEqual(lite ? [] : ['/a.glb', '/b.glb']);
    for (const l of run.links)
      expect(l).toMatchObject({ rel: 'preload', as: 'fetch', fetchPriority: 'low' });
  });
});
