import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import bn from '@/messages/bn.json';
import { FEATURES } from './features';
import {
  limitOf,
  PARTNER,
  PLAN_ROWS,
  PLANS,
  TRIAL_DAYS,
  YEARLY_OFF_PERCENT,
  yearlyMonthly,
} from './pricing';

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
    // Only the strongest AI (not built yet), delivery apps (a till setting) and the Partner plan's team stand for
    // no A–Z feature.
    expect(PLAN_ROWS.filter((r) => r.features.length === 0).map((r) => r.id)).toEqual([
      'deepAi',
      'deliveryApps',
      'doneForYou',
    ]);
    expect(PLAN_ROWS.filter((r) => r.soon).map((r) => r.id)).toEqual(['deepAi']);
  });

  it('Starter: no QR code system, delivery apps or member card; 10 AI, 3 strongest, 3 posters, 3 videos a week', () => {
    const s = plan('starter');
    const out = PLAN_ROWS.filter((r) => s.without.has(r.id));
    expect(out.map((r) => r.id)).toEqual([
      'tableQr',
      'offers',
      'memberCard',
      'deliveryApps',
      'doneForYou',
    ]);
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
    // Everything but the Partner plan's team.
    expect([...p.without]).toEqual(['doneForYou']);
    expect(limitOf(p, 'assistant')).toBe('unlimited');
    expect(limitOf(p, 'deepAi')).toEqual({ n: 20, per: 'week' });
    expect(limitOf(p, 'posters')).toEqual({ n: 5, per: 'day' });
    expect(limitOf(p, 'videos')).toEqual({ n: 2, per: 'day' });
  });

  it('Partner: $250, the team counted (no unlimited promises), the strongest AI above Pro', () => {
    expect([PARTNER.minor, PARTNER.currency]).toEqual([25000, 'USD']);
    expect([PARTNER.filmsPerMonth, PARTNER.reelsPerMonth]).toEqual([1, 4]);
    const pro = limitOf(plan('pro'), 'deepAi');
    expect(pro !== 'unlimited' && pro && PARTNER.deepAiPerWeek > pro.n).toBe(true);
    expect(PARTNER.services).toEqual([
      'films',
      'ads',
      'visit',
      'website',
      'brand',
      'build',
      'review',
      'deepAi',
    ]);
  });

  it('take 25% off when paid yearly', () => {
    expect(YEARLY_OFF_PERCENT).toBe(25);
    expect([1900, 2700, 25000].map(yearlyMonthly)).toEqual([1425, 2025, 18750]);
    // A year at once: $171, $243, $2,250.
    expect([1900, 2700, 25000].map((m) => yearlyMonthly(m) * 12)).toEqual([17100, 24300, 225000]);
  });

  it('has every line in English and Bangla', () => {
    for (const messages of [en, bn]) {
      const p = messages.landing3d.day.pricing as unknown as Record<string, unknown> & {
        rows: Record<string, string>;
        plans: Record<string, { name: string; body: string }>;
        partner: Record<string, unknown> & { services: Record<string, string> };
      };
      for (const key of [
        'title',
        'perMonthShort',
        'cta',
        'noCard',
        'soon',
        'badge',
        'unlimited',
        'yearly',
        'save',
        'billedMonth',
        'billedYear',
      ]) {
        expect(p[key]).toBeTruthy();
      }
      for (const code of ['starter', 'pro', 'partner']) {
        expect(p.plans[code]?.name).toBeTruthy();
        expect(p.plans[code]?.body).toBeTruthy();
      }
      expect(Object.keys(p.rows).sort()).toEqual(PLAN_ROWS.map((r) => r.id).sort());
      for (const key of ['badge', 'cta', 'mailSubject', 'everything', 'excluded']) {
        expect(p.partner[key]).toBeTruthy();
      }
      expect(Object.keys(p.partner.services).sort()).toEqual([...PARTNER.services].sort());
    }
    // The ad money is the restaurant's, said on the card itself; the team builds a website and an app.
    expect(en.landing3d.day.pricing.partner.excluded).toContain('ad money');
    expect(en.landing3d.day.pricing.partner.services.ads).toContain('the ad money is yours');
    expect(en.landing3d.day.pricing.partner.services.website).toContain('app');
  });
});
