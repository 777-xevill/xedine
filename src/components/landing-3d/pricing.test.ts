import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import bn from '@/messages/bn.json';
import { FEATURES } from './features';
import { PLAN_PRICE, PLAN_ROWS, TRIAL_DAYS, WEEKLY_LIMITS } from './pricing';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n');

describe('home page plan', () => {
  it('is $19 a month', () => {
    expect(PLAN_PRICE).toEqual({ minor: 1900, currency: 'USD' });
  });

  it('promises the free trial the billing code gives', () => {
    expect(sql).toContain(`interval '${TRIAL_DAYS} days' >= p_now then 'trialing'`);
  });

  it('lists only big features, each standing for features Xedine has', () => {
    const ids = PLAN_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(18);
    const known = new Set<string>(FEATURES.map((f) => f.id));
    for (const r of PLAN_ROWS) for (const f of r.features) expect(known).toContain(f);
    // Only the strongest AI (not built yet) and delivery apps (a till setting) stand for no A–Z feature.
    expect(PLAN_ROWS.filter((r) => r.features.length === 0).map((r) => r.id)).toEqual([
      'deepAi',
      'deliveryApps',
    ]);
  });

  it('leaves out the QR code system, delivery apps and the member card (the founder, 2026-11-18)', () => {
    const out = PLAN_ROWS.filter((r) => !r.included);
    expect(out.map((r) => r.id)).toEqual(['tableQr', 'offers', 'memberCard', 'deliveryApps']);
    // What it leaves out comes last.
    expect(PLAN_ROWS.slice(-out.length)).toEqual(out);
  });

  it('allows 10 AI questions, 3 strongest-AI answers, 3 posters and 3 videos a week', () => {
    expect(WEEKLY_LIMITS.map((l) => [l.id, l.perWeek])).toEqual([
      ['assistant', 10],
      ['deepAi', 3],
      ['posters', 3],
      ['videos', 3],
    ]);
    for (const l of WEEKLY_LIMITS) expect(l.included).toBe(true);
    expect(PLAN_ROWS.filter((r) => r.soon).map((r) => r.id)).toEqual(['deepAi']);
  });

  it('has every line in English and Bangla', () => {
    for (const messages of [en, bn]) {
      const p = messages.landing3d.day.pricing as Record<string, unknown> & {
        limits: Record<string, string>;
        rows: Record<string, string>;
      };
      for (const key of ['title', 'name', 'from', 'perMonth', 'body', 'cta', 'noCard', 'soon']) {
        expect(p[key]).toBeTruthy();
      }
      for (const l of WEEKLY_LIMITS) expect(p.limits[l.id]).toBeTruthy();
      expect(Object.keys(p.rows).sort()).toEqual(PLAN_ROWS.map((r) => r.id).sort());
      for (const r of PLAN_ROWS) expect(p.rows[r.id]).toBeTruthy();
    }
  });
});
