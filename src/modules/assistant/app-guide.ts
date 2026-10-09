import {
  buildNavigation,
  FEATURE_KEYS,
  type FeatureKey,
  type IconKey,
  type NavLink,
} from '@/modules/tenancy/navigation';
import type { Role } from '@/modules/tenancy/context';

/**
 * What the assistant knows about the app itself: which page does what, so "where do I add a recipe?"
 * gets a real page name and link instead of a guess. The descriptions follow each page's own
 * subtitle; they are read by the model, never shown as UI text. Who may open a page comes from the
 * navigation model, not from this table.
 */
export interface Access {
  slug: string;
  roles: Role[];
  enabled: FeatureKey[];
}

interface Guide {
  /** The page's name as the sidebar shows it (English). */
  name: string;
  what: string;
  /** Words an owner might use when looking for it. */
  words: string[];
}

export const PAGE_GUIDE: Record<IconKey, Guide> = {
  home: {
    name: 'Home',
    what: 'Today at a glance: sales so far against a normal day, estimated profit, best sellers, open money leaks and what is running out.',
    words: ['today', 'dashboard', 'overview', 'home', 'summary', 'aj', 'আজ'],
  },
  chat: {
    name: 'Chat',
    what: 'The full-screen chat with this assistant, with the history of past chats.',
    words: ['chat', 'assistant', 'history', 'ask'],
  },
  stock: {
    name: 'Stock',
    what: 'Three tabs. In stock: what is on the shelf and how many days it lasts. Loss: which ingredients were used more than the recipes need. Waste: food written down as waste. Also guided stock counts and Stock Guard alerts.',
    words: [
      'stock',
      'inventory',
      'ingredient',
      'shelf',
      'count',
      'waste',
      'loss',
      'lose',
      'running out',
      'stok',
      'মজুত',
      'লস',
    ],
  },
  sales: {
    name: 'Sales',
    what: 'Sales explorer: sales by period and branch with charts for busiest hours, days, items, time of day, channel and payment method.',
    words: [
      'sales',
      'sale',
      'revenue',
      'orders',
      'busiest',
      'hour',
      'channel',
      'payment',
      'bikri',
      'বিক্রি',
    ],
  },
  leaks: {
    name: 'Money leaks',
    what: 'Problems found in the till data (voids, discounts, refunds, cash gaps, odd stock use), ranked by taka and confidence, each with its evidence and what to do. Owner and accountant only.',
    words: [
      'leak',
      'losing money',
      'theft',
      'void',
      'discount',
      'refund',
      'fraud',
      'cash',
      'চুরি',
      'লিক',
    ],
  },
  menu: {
    name: 'Menu',
    what: 'Categories, dishes and the printed prices; add or hide an item, photos, import a menu. Owner only.',
    words: ['menu', 'dish', 'item', 'price', 'category', 'add item', 'মেনু', 'দাম'],
  },
  recipes: {
    name: 'Recipes',
    what: 'What goes into each dish so every plate has a cost. AI can draft a recipe; the owner approves it. Needs the Recipes feature switched on.',
    words: ['recipe', 'portion', 'ingredient amount', 'food cost', 'রেসিপি'],
  },
  menuProfit: {
    name: 'Menu profit',
    what: 'Which dishes make money and which lose it (stars, plowhorses, puzzles, dogs), margins, and what a price or portion change would do. Owner and accountant only. Needs the Recipes feature.',
    words: [
      'profit',
      'margin',
      'menu profit',
      'price change',
      'simulate',
      'star',
      'dog',
      'মার্জিন',
    ],
  },
  purchases: {
    name: 'Purchases',
    what: 'The bazar: record what was bought by form, photo of the chit or voice; suppliers and price changes. Needs the Purchasing feature switched on.',
    words: ['purchase', 'bazar', 'buy', 'bought', 'supplier', 'chit', 'bazaar', 'বাজার'],
  },
  plan: {
    name: 'Plan',
    what: 'What tomorrow will sell, what to cook (prep) and what to buy (the bazar list). Needs the Planning feature switched on.',
    words: ['plan', 'forecast', 'tomorrow', 'prep', 'bazar list', 'cook', 'পরিকল্পনা'],
  },
  customers: {
    name: 'Customers',
    what: 'Who comes back, who is slipping away, new and regular customers. Needs the Customers feature switched on.',
    words: ['customer', 'regular', 'loyal', 'retention', 'repeat', 'কাস্টমার'],
  },
  campaigns: {
    name: 'Campaigns',
    what: 'Messages to customers who said yes: drafted, approved by the owner, capped and measured against a holdout group.',
    words: ['campaign', 'offer', 'message', 'whatsapp', 'sms', 'promotion', 'win back'],
  },
  growth: {
    name: 'Growth',
    what: "Content and promotion ideas grounded in the restaurant's own sales data; nothing goes out without approval.",
    words: ['growth', 'marketing', 'content', 'post', 'facebook', 'idea', 'grow'],
  },
  reviews: {
    name: 'Reviews',
    what: 'Every review and after-meal comment in one place, ratings, complaint themes and reply drafts.',
    words: ['review', 'rating', 'complaint', 'feedback', 'google', 'রিভিউ'],
  },
  branches: {
    name: 'Branches',
    what: 'Branch comparison: which branch does best, what the others could match, and what moves between branches. Needs the Branches feature switched on.',
    words: ['branch', 'compare', 'location', 'outlet', 'শাখা'],
  },
  benchmarks: {
    name: 'Benchmarks',
    what: 'Last full month next to similar restaurants. Owner and accountant only.',
    words: ['benchmark', 'peers', 'industry', 'similar restaurants', 'average'],
  },
  compliance: {
    name: 'Compliance',
    what: 'Licences, the VAT return and what to hand the accountant, with reminders before anything lapses.',
    words: [
      'compliance',
      'licence',
      'license',
      'vat',
      'mushak',
      'tax',
      'trade licence',
      'due date',
      'ভ্যাট',
    ],
  },
  staffRecords: {
    name: 'Staff records',
    what: 'Attendance, advances and who sells what.',
    words: ['attendance', 'advance', 'salary', 'staff sales', 'employee', 'হাজিরা'],
  },
  pos: {
    name: 'POS till',
    what: 'The till for cashiers: take orders, payments and cash counts. Works offline. Opens as its own screen.',
    words: ['pos', 'till', 'cashier', 'billing screen', 'order screen', 'counter'],
  },
  kds: {
    name: 'Kitchen screen',
    what: 'The kitchen display: tickets for the cooks, by station. Opens as its own screen.',
    words: ['kitchen', 'kds', 'tickets', 'cook screen', 'station'],
  },
  settings: {
    name: 'Settings',
    what: 'The hub for settings.',
    words: ['settings'],
  },
  general: {
    name: 'Settings (General)',
    what: 'How prices, VAT, service charge and the business day work (the day cutoff), and the loss line.',
    words: [
      'settings',
      'vat rate',
      'service charge',
      'cutoff',
      'business day',
      'loss line',
      'restaurant name',
      'language',
    ],
  },
  features: {
    name: 'Settings → Features',
    what: 'Switch optional sections on or off (Recipes, Purchasing, Planning, Customers, Reviews, Branches, Compliance, Staff records). Switched-on features appear in the sidebar. Owner only.',
    words: ['feature', 'switch on', 'turn on', 'enable', 'module', 'sidebar'],
  },
  assistantRules: {
    name: 'Settings → Assistant',
    what: 'Goals and rules the assistant must respect (for example "never suggest cutting staff"). Owner only.',
    words: ['assistant rules', 'goal', 'rule', 'tell the assistant', 'remember'],
  },
  team: {
    name: 'Team',
    what: 'Invite managers, accountants and others, and choose which branches they can see. Owner only.',
    words: ['team', 'invite', 'manager', 'accountant', 'access', 'role', 'permission', 'user'],
  },
  telegram: {
    name: 'Settings → Telegram',
    what: "Connect the purchaser's Telegram so the bazar can be reported and the list received by chat. Owner only.",
    words: ['telegram', 'bot', 'chat bot', 'bazar by chat'],
  },
  staff: {
    name: 'Staff',
    what: 'The people who sign in with a PIN at the till and kitchen screen: add, remove, reset PINs.',
    words: ['pin', 'cashier', 'add staff', 'cook', 'waiter', 'sign in at till'],
  },
  branchSetup: {
    name: 'Branch setup',
    what: "This branch's own setup.",
    words: ['branch setup', 'add branch', 'new branch', 'tables'],
  },
  costs: {
    name: 'Costs',
    what: 'What the restaurant spends outside food (rent, utilities, gas, internet, labour) so the daily profit estimate is real. Owner only.',
    words: [
      'cost',
      'rent',
      'utilities',
      'gas',
      'salary',
      'expenses',
      'fixed cost',
      'overhead',
      'খরচ',
    ],
  },
  billing: {
    name: 'Billing',
    what: 'The plan, what it includes and what next month costs. Owner and accountant.',
    words: ['billing', 'plan', 'subscription', 'invoice', 'pay xedine', 'upgrade'],
  },
  setup: {
    name: 'Setup',
    what: 'A checklist that ticks itself as data goes in (menu, recipes, first count and so on). Owner only.',
    words: ['setup', 'get started', 'onboarding', 'checklist', 'first steps', 'start'],
  },
};

export interface PageHit {
  page: string;
  key: IconKey;
  path: string;
  what: string;
  /** open = the person can open it now; the other two say why not and what to do. */
  status: 'open' | 'switched_off' | 'not_for_your_role';
  how_to_get_it?: string;
}

const href = (link: NavLink | undefined, access: Access, key: IconKey): string =>
  link?.href ?? `/${access.slug}${key === 'home' ? '' : `/${key}`}`;

/** The pages a person's navigation links to, by key. */
export function reachable(access: Access): Map<IconKey, NavLink> {
  const nav = buildNavigation(access);
  return new Map<IconKey, NavLink>(
    [...nav.core, ...nav.more, ...nav.settings, ...nav.apps].map((l) => [l.key, l]),
  );
}

/**
 * Pages for a topic, best match first (an empty topic lists every page this person can open). A page
 * the person cannot open yet is still returned with the reason, so the assistant can say "switch on
 * Reviews in Settings → Features" instead of pretending it is not there.
 */
export function findPages(topic: string, access: Access, limit = 4): PageHit[] {
  const open = reachable(access);
  const everything = reachable({ ...access, enabled: [...FEATURE_KEYS] });
  const q = topic.toLowerCase().trim();
  const words = q.split(/[^\p{L}\p{N}\p{M}]+/u).filter((w) => w.length > 1);
  const keys = (Object.keys(PAGE_GUIDE) as IconKey[]).filter(
    (k) => k !== 'settings' && k !== 'chat',
  );
  const scored = keys
    .map((key) => {
      const g = PAGE_GUIDE[key];
      const hay = `${g.name} ${g.what}`.toLowerCase();
      let score = 0;
      for (const w of g.words) if (q && (q.includes(w) || w.includes(q))) score += 3;
      for (const w of words) {
        if (g.words.some((x) => x.includes(w))) score += 2;
        else if (hay.includes(w)) score += 1;
      }
      return { key, score };
    })
    .filter((s) => (q ? s.score > 0 : true))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, q ? limit : scored.length).map(({ key }) => {
    const g = PAGE_GUIDE[key];
    const link = open.get(key);
    const status: PageHit['status'] = link
      ? 'open'
      : everything.has(key)
        ? 'switched_off'
        : 'not_for_your_role';
    return {
      page: g.name,
      key,
      path: href(link ?? everything.get(key), access, key),
      what: g.what,
      status,
      ...(status === 'switched_off'
        ? { how_to_get_it: 'The owner can switch it on in Settings → Features.' }
        : status === 'not_for_your_role'
          ? { how_to_get_it: 'This role cannot open it; ask the owner.' }
          : {}),
    };
  });
}
