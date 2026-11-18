import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import bn from '@/messages/bn.json';
import { FEATURES } from './features';
import { limitOf, PLAN_ROWS, PLANS, TRIAL_DAYS } from './pricing';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n');

const plan = (code: string) => {
  const p = PLANS.find((x) => x.code === code);
  if (!p) throw new Error(code);
  return p;
};

describe('home page plans', () => {
  it('are Starter at $19 and Pro at $27, Pro the one the page points to', () => {
    expect(PLANS.map((p) => [p.code, p.minor, p.currency])).toEqual([
      ['starter', 1900, 'USD'],
      ['pro', 2700, 'USD'],
    ]);
    expect(PLANS.filter((p) => p.featured).map((p) => p.code)).toEqual(['pro']);
  });

  it('promise the free trial the billing code gives', () => {
    expect(sql).toContain(`interval '${TRIAL_DAYS} days' >= p_now then 'trialing'`);
  });

  it('list only big features, each standing for features Xedine has', () => {
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
    expect(PLAN_ROWS.filter((r) => r.soon).map((r) => r.id)).toEqual(['deepAi']);
  });

  it('Starter: no QR code system, delivery apps or member card; 10 AI, 3 strongest, 3 posters, 3 videos a week', () => {
    const s = plan('starter');
    const out = PLAN_ROWS.filter((r) => s.without.has(r.id));
    expect(out.map((r) => r.id)).toEqual(['tableQr', 'offers', 'memberCard', 'deliveryApps']);
    // What it leaves out comes last.
    expect(PLAN_ROWS.slice(-out.length)).toEqual(out);
    expect(s.limits).toEqual([
      { id: 'assistant', limit: { n: 10, per: 'week' } },
      { id: 'deepAi', limit: { n: 3, per: 'week' } },
      { id: 'posters', limit: { n: 3, per: 'week' } },
      { id: 'videos', limit: { n: 3, per: 'week' } },
    ]);
  });

  it('Pro: everything; everyday AI unlimited, strongest 20 a week, 5 posters and 2 videos a day', () => {
    const p = plan('pro');
    expect(p.without.size).toBe(0);
    expect(limitOf(p, 'assistant')).toBe('unlimited');
    expect(limitOf(p, 'deepAi')).toEqual({ n: 20, per: 'week' });
    expect(limitOf(p, 'posters')).toEqual({ n: 5, per: 'day' });
    expect(limitOf(p, 'videos')).toEqual({ n: 2, per: 'day' });
  });

  it('has every line in English and Bangla', () => {
    for (const messages of [en, bn]) {
      const p = messages.landing3d.day.pricing as Record<string, unknown> & {
        limits: Record<string, string>;
        rows: Record<string, string>;
        plans: Record<string, { name: string; body: string }>;
      };
      for (const key of ['title', 'perMonth', 'cta', 'noCard', 'soon', 'badge', 'unlimited']) {
        expect(p[key]).toBeTruthy();
      }
      for (const pl of PLANS) {
        expect(p.plans[pl.code]?.name).toBeTruthy();
        expect(p.plans[pl.code]?.body).toBeTruthy();
        for (const l of pl.limits) expect(p.limits[l.id]).toBeTruthy();
      }
      expect(Object.keys(p.rows).sort()).toEqual(PLAN_ROWS.map((r) => r.id).sort());
    }
  });
});
