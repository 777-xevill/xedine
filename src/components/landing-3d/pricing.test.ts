import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import bn from '@/messages/bn.json';
import { FEATURES } from './features';
import { NOT_IN_PLAN, PLAN_PRICE, PLAN_ROWS, TRIAL_DAYS, WEEKLY_LIMITS } from './pricing';

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

  it('lists every feature on the A–Z list once, plus delivery apps and the strongest AI', () => {
    const ids = PLAN_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FEATURES) expect(ids).toContain(f.id);
    expect(ids).toContain('deliveryChannels');
    expect(ids).toContain('deepAi');
    expect(ids).toHaveLength(FEATURES.length + 2);
  });

  it('leaves out the QR code system, delivery apps and the member card (the founder, 2026-11-18)', () => {
    expect([...NOT_IN_PLAN].sort()).toEqual(
      ['deliveryChannels', 'foodFacts', 'games', 'memberCard', 'offers', 'tableQr'].sort(),
    );
    for (const r of PLAN_ROWS) expect(r.included).toBe(!NOT_IN_PLAN.has(r.id));
  });

  it('allows 3 posters, 3 videos, 10 AI questions and 3 strongest-AI answers a week', () => {
    expect(WEEKLY_LIMITS.map((l) => [l.id, l.perWeek])).toEqual([
      ['posters', 3],
      ['videos', 3],
      ['assistant', 10],
      ['deepAi', 3],
    ]);
    // A row with a limit shows it; the strongest AI is not built yet.
    for (const l of WEEKLY_LIMITS) {
      const row = PLAN_ROWS.find((r) => r.id === l.id);
      expect(row?.included).toBe(true);
      expect(row?.perWeek).toBe(l.perWeek);
    }
    expect(PLAN_ROWS.find((r) => r.id === 'deepAi')?.soon).toBe(true);
  });

  it('has every line in English and Bangla', () => {
    for (const messages of [en, bn]) {
      const p = messages.landing3d.day.pricing as Record<string, unknown> & {
        limits: Record<string, string>;
        extra: Record<string, string>;
      };
      for (const key of ['title', 'name', 'from', 'perMonth', 'body', 'cta', 'noCard', 'soon']) {
        expect(p[key]).toBeTruthy();
      }
      for (const l of WEEKLY_LIMITS) expect(p.limits[l.id]).toBeTruthy();
      expect(p.extra.deliveryChannels).toBeTruthy();
      expect(p.extra.deepAi).toBeTruthy();
      const features = messages.landing3d.day.features as Record<string, { name: string }>;
      for (const f of FEATURES) expect(features[f.id]?.name).toBeTruthy();
    }
  });
});
