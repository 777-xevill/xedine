import { ORGS } from './config';
import { allDates, generateDay, type DayRows } from './generate';
import { Ledger } from './ledger';
import type { Manifest } from './manifest';

/** Stream the whole dataset, day by day. `onDay` sees every generated day (for loading into a database). */
export async function runSeed(
  onDay?: (orgKey: string, branchKey: string, date: string, rows: DayRows) => Promise<void> | void,
): Promise<Manifest> {
  const ledger = new Ledger();
  for (const date of allDates()) {
    for (const org of ORGS) {
      for (const b of org.branches) {
        const rows = generateDay(org, b, date);
        ledger.add(org, b.key, rows);
        if (onDay) await onDay(org.key, b.key, date, rows);
      }
    }
  }
  return ledger.manifest();
}

export const MANIFEST_PATH = 'supabase/seed/manifest.json';

export function serializeManifest(m: Manifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}
