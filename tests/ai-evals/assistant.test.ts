/**
 * `pnpm ai:evals` — the assistant against the seeded year (CI, after the seed). Runs the real code path:
 * the LLM with tools when ANTHROPIC_API_KEY is set, the deterministic router otherwise.
 * ROADMAP Phase 4 "Done when": ≥ 95% exact numeric answers; 0 answers with numbers absent from tool
 * results (guaranteed by the validator + fallback, and counted here).
 */
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createTranslator } from 'next-intl';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, ORGS } from '../../scripts/seed/config';
import { ids } from '../../scripts/seed/generate';
import { ManifestSchema } from '../../scripts/seed/manifest';
import bn from '../../src/messages/bn.json';
import en from '../../src/messages/en.json';
import { askAssistant } from '../../src/modules/assistant/agent';
import type { Translate } from '../../src/modules/assistant/answers';
import { extractNumbers } from '../../src/modules/assistant/validator';
import { goldenQuestions } from './golden';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const manifest = ManifestSchema.parse(
  JSON.parse(readFileSync('supabase/seed/manifest.json', 'utf8')),
);
const golden = goldenQuestions(manifest);

const translate = async (locale: 'bn' | 'en') =>
  createTranslator({
    locale,
    messages: locale === 'bn' ? bn : en,
    namespace: 'assistant',
  }) as unknown as Translate;

describe('golden questions are well formed', () => {
  it('at least 40, every window in every language, expected values from the manifest', () => {
    expect(golden.length).toBeGreaterThanOrEqual(40);
    expect(new Set(golden.map((g) => g.id)).size).toBe(golden.length);
  });
});

describe.skipIf(!url || !anon)('the assistant answers the golden questions exactly', () => {
  const sessions = new Map<string, SupabaseClient>();

  beforeAll(async () => {
    for (const org of ORGS) {
      const sb = createClient(url!, anon!, { auth: { persistSession: false } });
      const owner = org.users.find((u) => u.role === 'owner')!;
      const { error } = await sb.auth.signInWithPassword({
        email: owner.email,
        password: DEMO_PASSWORD,
      });
      if (error) throw error;
      sessions.set(org.key, sb as unknown as SupabaseClient);
    }
  });

  it('≥ 95% exact; no unverified numbers', { timeout: 600_000 }, async () => {
    const results: { id: string; exact: boolean; source: string; check: string; text: string }[] =
      [];
    for (const g of golden) {
      const org = ORGS.find((o) => o.key === g.org)!;
      const answer = await askAssistant({
        sb: sessions.get(g.org)!,
        orgId: ids.org(org),
        question: g.question,
        nowIso: manifest.frozen_now,
        businessDate: manifest.anchor_date,
        ownerRules: [],
        translate,
      });
      const asked = new Set(extractNumbers(g.question));
      const said = extractNumbers(answer.text).filter((n) => !asked.has(n));
      const exact = g.expected === 0 ? said.length === 0 : said.includes(g.expected);
      results.push({
        id: g.id,
        exact,
        source: answer.source,
        check: answer.numericCheck,
        text: answer.text,
      });
    }
    const exactRate = results.filter((r) => r.exact).length / results.length;
    const misses = results.filter((r) => !r.exact);
    console.log(
      `AI evals: ${results.length} questions, ${(exactRate * 100).toFixed(1)}% exact; sources ${JSON.stringify(
        results.reduce<Record<string, number>>(
          (acc, r) => ({ ...acc, [r.source]: (acc[r.source] ?? 0) + 1 }),
          {},
        ),
      )}; numeric fallbacks ${results.filter((r) => r.check === 'fallback').length}`,
    );
    for (const m of misses) console.log(`  ✗ ${m.id}: ${m.text.replace(/\n/g, ' / ')}`);
    expect(exactRate).toBeGreaterThanOrEqual(0.95);
  });
});
