import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import bn from '@/messages/bn.json';
import { PRICING_PLANS, TRIAL_DAYS } from './pricing';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'));

describe('home page pricing', () => {
  it('shows the prices the plans table charges', () => {
    const seed = sql.join('\n');
    for (const plan of PRICING_PLANS) {
      expect(seed).toMatch(new RegExp(`\\('${plan.code}',\\s*'\\w+',\\s*${plan.minor},`));
    }
    // A later migration that changes a price must change the home page too.
    expect(sql.some((s) => /update\s+public\.plans\s+set\s+price/i.test(s))).toBe(false);
  });

  it('promises the free trial the billing code gives', () => {
    expect(sql.join('\n')).toContain(`interval '${TRIAL_DAYS} days' >= p_now then 'trialing'`);
  });

  it('has every line in English and Bangla', () => {
    for (const messages of [en, bn]) {
      const plans = messages.landing3d.day.pricing.plans as Record<string, Record<string, string>>;
      for (const plan of PRICING_PLANS) {
        for (let i = 1; i <= plan.points; i++) expect(plans[plan.code]?.[`p${i}`]).toBeTruthy();
        expect(plans[plan.code]?.[`p${plan.points + 1}`]).toBeUndefined();
      }
    }
  });
});
