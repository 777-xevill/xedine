/**
 * The assistant's golden questions (ROADMAP Phase 4: "≥ 40 golden questions incl. how many kebabs sold
 * in the last 2 hours / today / last week / this month"). Expected answers come from the seed manifest,
 * never typed in by hand: org-wide item counts at the frozen now, for each demo org.
 */
import type { Manifest } from '../../scripts/seed/manifest';

export interface GoldenQuestion {
  id: string;
  org: 'demo_kacchi_house' | 'demo_cafe';
  question: string;
  expected: number;
}

type ManifestWindow = 'last_2h' | 'today' | 'yesterday' | 'last_7d' | 'month_to_date';

const PHRASES: Record<ManifestWindow, { en: string; bl: string; bn: string }> = {
  last_2h: { en: 'in the last 2 hours', bl: 'gato 2 ghonta', bn: 'গত ২ ঘণ্টায়' },
  today: { en: 'today', bl: 'ajke', bn: 'আজ' },
  yesterday: { en: 'yesterday', bl: 'gotokal', bn: 'গতকাল' },
  last_7d: { en: 'in the last 7 days', bl: 'goto 7 din', bn: 'গত ৭ দিনে' },
  month_to_date: { en: 'this month', bl: 'ei mashe', bn: 'এই মাসে' },
};

const ITEMS = {
  demo_kacchi_house: {
    en: 'Kacchi Biryani (Mutton)',
    bl: 'mutton kacchi',
    bn: 'কাচ্চি বিরিয়ানি (মটন)',
  },
  demo_cafe: { en: 'Cappuccino', bl: 'cappuccino', bn: 'cappuccino' },
} as const;

export function goldenQuestions(manifest: Manifest): GoldenQuestion[] {
  const out: GoldenQuestion[] = [];
  for (const org of ['demo_kacchi_house', 'demo_cafe'] as const) {
    const branches = Object.values(manifest.orgs[org]!.branches);
    const item = ITEMS[org];
    for (const window of Object.keys(PHRASES) as ManifestWindow[]) {
      const expected = branches.reduce((s, b) => s + b.item_qty[window], 0);
      const p = PHRASES[window];
      const q = (lang: string, question: string) =>
        out.push({ id: `${org}/${window}/${lang}`, org, question, expected });
      q('en', `How many ${item.en} did we sell ${p.en}?`);
      q('en2', `${p.en.charAt(0).toUpperCase()}${p.en.slice(1)}, how many ${item.en} were sold?`);
      q('banglish', `${p.bl} koto ta ${item.bl} bikri hoyeche?`);
      q('bn', `${p.bn} কয়টা ${item.bn} বিক্রি হয়েছে?`);
    }
  }
  return out;
}
