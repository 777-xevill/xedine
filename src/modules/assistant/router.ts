/**
 * A deterministic reading of the questions owners ask most (PRODUCT.md M4: "how many kebabs in the
 * last 2 hours / today / last week / this month?"), in English, Banglish and Bangla. It never produces
 * a number: it only decides which metric to call. With no AI key it is the whole assistant; with one,
 * it is the fallback when a model's answer fails the numeric check.
 */
export type Window =
  'last_2h' | 'today' | 'yesterday' | 'last_7d' | 'week_to_date' | 'month_to_date' | 'last_30d';

export interface MenuRef {
  id: string;
  name: string;
  name_bn: string | null;
}

export type Intent =
  | { kind: 'item_qty'; item: MenuRef; window: Window }
  | { kind: 'ambiguous_item'; candidates: MenuRef[]; window: Window }
  | { kind: 'sales'; window: Window }
  | { kind: 'top_items'; window: Window }
  | { kind: 'finding'; findingId: string | null; rank: number; window: Window }
  | { kind: 'stock_low'; window: Window };

// Most specific first: "this week" before "week", "last 7 days" before "today".
const WINDOWS: [Window, RegExp][] = [
  [
    'last_2h',
    /(last|past)\s+(2|two)\s+hours?|(goto|gato|gata|shesh|last)\s*2\s*gh?[oa]nt?a|[২2]\s*ঘণ্টা/i,
  ],
  ['last_30d', /(last|past)\s+(30|thirty)\s+days|(goto|gato|gata)\s*30\s*din|গত\s*[৩3][০0]\s*দিন/i],
  ['week_to_date', /this\s+week|ei\s+s[oa]?[pb]t[ao]h?o?|এই\s*সপ্তাহ/i],
  [
    'last_7d',
    /(last|past)\s+(7|seven)\s+days|last\s+week|past\s+week|(goto|gato|gata)\s+s[oa]?[pb]t[ao]h?o?|(goto|gato|gata)\s*7\s*din|গত\s*[৭7]\s*দিন|গত\s*সপ্তাহ/i,
  ],
  ['month_to_date', /this\s+month|ei\s+ma+sh?e?|এই\s*মাস/i],
  ['yesterday', /yesterday|g[oa]t[oa]kal|গতকাল/i],
  ['today', /today|\baa?j(ke)?\b|আজ/i],
];

const QUANTITY =
  /how\s+many|number\s+of|\bqty\b|\bkoto\b|\bkoi?ta\b|\bkoyta\b|kotogulo|কত|কয়টা|কয়টি|কতগুলো/i;
const TOP =
  /\btop\b|best[\s-]?sell|most\s+sold|sold\s+most|beshi\s+bikri|sera|সবচেয়ে\s*বেশি|সেরা/i;
const SALES = /\bsales?\b|revenue|turnover|\bbikri\b|বিক্রি|\btaka\b|টাকা/i;
const FINDING_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const EXPLAIN_LEAK =
  /(explain|why|biggest|top)\s.*\b(leak|finding|loss)|leak\s*#?\s*\d|(sobcheye|shobche)\s*boro\s*(leak|khoti)|সবচেয়ে\s*বড়\s*(লিক|ক্ষতি)|ক্ষতি(টা)?\s*কেন/i;
const STOCK_LOW =
  /running\s+low|low\s+stock|out\s+of\s+stock|stock\s+(status|level)|furi(ye|e)\s*(ashche|jacche)|stock\s+koto|ফুরিয়ে|স্টক\s*(কত|কম)/i;

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[()[\]{},.!?।:;'"’“”/\\-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 || /[ঀ-৿]/.test(t));

export function detectWindow(question: string): Window | null {
  for (const [window, re] of WINDOWS) if (re.test(question)) return window;
  return null;
}

/** The menu item a question names: every word of its name beats some words; ties are ambiguous. */
export function matchItem(question: string, menu: MenuRef[]): MenuRef | MenuRef[] | null {
  const q = new Set(tokens(question));
  const scored = menu
    .map((item) => {
      const names = [item.name, item.name_bn ?? ''].filter(Boolean).map(tokens);
      let best = { full: false, hits: 0, size: 0 };
      for (const words of names) {
        const hits = words.filter((w) => q.has(w)).length;
        const full = hits > 0 && hits === words.length;
        if (full > best.full || (full === best.full && hits > best.hits))
          best = { full, hits, size: words.length };
      }
      return { item, ...best };
    })
    .filter((s) => s.hits > 0);
  if (scored.length === 0) return null;
  const full = scored.filter((s) => s.full).sort((a, b) => b.size - a.size);
  if (full.length > 0) {
    const top = full.filter((s) => s.size === full[0]!.size);
    return top.length === 1 ? top[0]!.item : top.map((s) => s.item);
  }
  const max = Math.max(...scored.map((s) => s.hits));
  const best = scored.filter((s) => s.hits === max);
  return best.length === 1 ? best[0]!.item : best.map((s) => s.item);
}

export function routeQuestion(question: string, menu: MenuRef[]): Intent | null {
  const window = detectWindow(question) ?? 'today';
  const id = FINDING_ID.exec(question)?.[0] ?? null;
  if (id || EXPLAIN_LEAK.test(question)) {
    const rank = Number(
      /#\s*(\d{1,2})|leak\s+(\d{1,2})/i.exec(question)?.slice(1).find(Boolean) ?? 1,
    );
    return { kind: 'finding', findingId: id, rank, window };
  }
  if (STOCK_LOW.test(question)) return { kind: 'stock_low', window };
  if (TOP.test(question)) return { kind: 'top_items', window };
  const item = matchItem(question, menu);
  if (item && (QUANTITY.test(question) || SALES.test(question) || detectWindow(question))) {
    return Array.isArray(item)
      ? { kind: 'ambiguous_item', candidates: item, window }
      : { kind: 'item_qty', item, window };
  }
  if (SALES.test(question)) return { kind: 'sales', window };
  return null;
}
