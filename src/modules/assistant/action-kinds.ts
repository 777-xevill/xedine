import type Anthropic from '@anthropic-ai/sdk';
import type { Role } from '@/modules/tenancy/context';

/**
 * The changes the assistant may prepare in a chat (ADR 0067). The model calls `propose_<kind>`; nothing
 * changes then. The person who asked sees every prepared change in a list and taps "Do these changes"; only
 * then does the app make them, with that person's own session (ai-actions.ts). Pure: shared by the agent,
 * the server actions and the tests.
 */
export const ACTION_KINDS = [
  'add_category',
  'add_dish',
  'change_price',
  'set_dish_on_menu',
  'add_special_day',
  'add_party_order',
  'record_purchase',
  'log_waste',
  'add_supplier',
  'add_fixed_cost',
  'set_food_cost',
  'remember_rule',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const isActionKind = (k: string): k is ActionKind =>
  (ACTION_KINDS as readonly string[]).includes(k);

/** Who may make each change: the same roles the page and its SQL allow (the SQL still decides). */
export const ACTION_ROLES: Record<ActionKind, Role[]> = {
  add_category: ['owner'],
  add_dish: ['owner'],
  change_price: ['owner'],
  set_dish_on_menu: ['owner'],
  add_special_day: ['owner', 'manager'],
  add_party_order: ['owner', 'manager'],
  record_purchase: ['owner'],
  log_waste: ['owner', 'manager'],
  add_supplier: ['owner'],
  add_fixed_cost: ['owner'],
  set_food_cost: ['owner'],
  remember_rule: ['owner'],
};

export const mayDo = (kind: ActionKind, roles: readonly Role[]) =>
  ACTION_ROLES[kind].some((r) => roles.includes(r));

/** The page each change shows on (a `nav.*` key), refreshed after it is made. */
export const ACTION_PAGES: Record<ActionKind, string> = {
  add_category: 'menu',
  add_dish: 'menu',
  change_price: 'menu',
  set_dish_on_menu: 'menu',
  add_special_day: 'plan',
  add_party_order: 'plan',
  record_purchase: 'purchases',
  log_waste: 'stock',
  add_supplier: 'purchases',
  add_fixed_cost: 'costs',
  set_food_cost: 'costs',
  remember_rule: 'settings',
};

export const BUSY_WORDS = ['much_busier', 'busier', 'quieter', 'much_quieter', 'closed'] as const;
export const DAY_KINDS = ['holiday', 'cricket', 'weather', 'hartal', 'custom'] as const;
export const FIXED_KINDS = ['rent', 'utilities', 'gas', 'fuel', 'internet', 'other'] as const;
export const WASTE_REASONS = ['spoiled', 'overcooked', 'dropped', 'leftover', 'returned'] as const;
export const ACTION_UNITS = [
  'kg',
  'g',
  'l',
  'ml',
  'pcs',
  'dozen',
  'packet',
  'bunch',
  'plates',
] as const;

const DATE_PROP = {
  type: 'string',
  description: 'YYYY-MM-DD, on the restaurant clock. Work it out from today in the context.',
} as const;
const BRANCH_PROP = {
  type: 'string',
  description: 'Branch name. Omit when the restaurant has one branch.',
} as const;
const MONEY = (what: string) =>
  ({
    type: 'number',
    description: `${what}, in whole units of the restaurant's currency (taka for ৳), exactly as the person said it.`,
  }) as const;

const tool = (
  name: ActionKind,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): Anthropic.Tool => ({
  name: `propose_${name}`,
  description: `${description} Prepares the change only: the person sees it in a list and taps to make it.`,
  input_schema: { type: 'object', properties, required, additionalProperties: false },
});

export const ACTION_TOOL_DEFS: Anthropic.Tool[] = [
  tool(
    'add_category',
    'A new menu category (a group such as "Rice", "Drinks").',
    {
      name: { type: 'string' },
      name_bn: { type: 'string', description: 'Bangla name, optional.' },
    },
    ['name'],
  ),
  tool(
    'add_dish',
    'A new dish on the menu with its price. Use the category name; propose_add_category first when it is new.',
    {
      name: { type: 'string' },
      name_bn: { type: 'string', description: 'Bangla name, optional.' },
      price: MONEY('The price'),
      category: { type: 'string', description: 'Category name, optional.' },
    },
    ['name', 'price'],
  ),
  tool(
    'change_price',
    "A dish's menu price (its main price; sizes are changed on the Menu page).",
    { dish: { type: 'string' }, new_price: MONEY('The new price') },
    ['dish', 'new_price'],
  ),
  tool(
    'set_dish_on_menu',
    'Takes a dish off the menu (the till stops offering it) or puts it back.',
    { dish: { type: 'string' }, on_menu: { type: 'boolean' } },
    ['dish', 'on_menu'],
  ),
  tool(
    'add_special_day',
    'Tells Xedine about a special day (a holiday, a big match, rain, a hartal, an event) and how busy it may be, so the forecast and the bazar list use it. Only the owner may mark the restaurant closed.',
    {
      date: DATE_PROP,
      until: { ...DATE_PROP, description: 'Last day when it lasts several days, optional.' },
      name: { type: 'string', description: 'What it is, e.g. "Eid", "Bangladesh vs India".' },
      kind: { type: 'string', enum: [...DAY_KINDS] },
      busy: {
        type: 'string',
        enum: [...BUSY_WORDS],
        description: 'How busy it may be; omit when unknown.',
      },
    },
    ['date', 'name', 'kind'],
  ),
  tool(
    'add_party_order',
    'A party, catering or pre-order for a day: dishes and plates, added on top of the usual day in what to cook and what to buy.',
    {
      date: DATE_PROP,
      ready_at: { type: 'string', description: 'HH:MM, 24-hour, optional.' },
      title: { type: 'string', description: 'Who or what it is for, e.g. "Office lunch".' },
      branch: BRANCH_PROP,
      note: { type: 'string' },
      lines: {
        type: 'array',
        minItems: 1,
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            dish: { type: 'string' },
            size: { type: 'string', description: 'Size name such as "Half", optional.' },
            plates: { type: 'integer', minimum: 1, maximum: 5000 },
          },
          required: ['dish', 'plates'],
          additionalProperties: false,
        },
      },
    },
    ['date', 'title', 'lines'],
  ),
  tool(
    'record_purchase',
    'Records bazar bought (what, how much, what it cost in total per line). An item not in the list yet is added with it.',
    {
      date: { ...DATE_PROP, description: 'The day it was bought; omit for today.' },
      supplier: { type: 'string', description: 'Shop or supplier name, optional.' },
      branch: BRANCH_PROP,
      for_days: {
        type: 'integer',
        minimum: 1,
        maximum: 30,
        description: 'How many days it is for, optional.',
      },
      lines: {
        type: 'array',
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          properties: {
            item: { type: 'string' },
            qty: { type: 'number' },
            unit: { type: 'string', enum: ACTION_UNITS.filter((u) => u !== 'plates') },
            total: MONEY('What this line cost in total'),
          },
          required: ['item', 'qty', 'unit', 'total'],
          additionalProperties: false,
        },
      },
    },
    ['lines'],
  ),
  tool(
    'log_waste',
    'Writes down food thrown away: an ingredient (kg, g, l, ml, pcs) or cooked dishes (plates).',
    {
      item: { type: 'string', description: 'Ingredient or dish name.' },
      qty: { type: 'number' },
      unit: { type: 'string', enum: [...ACTION_UNITS] },
      reason: { type: 'string', enum: [...WASTE_REASONS] },
      branch: BRANCH_PROP,
      note: { type: 'string' },
    },
    ['item', 'qty', 'unit', 'reason'],
  ),
  tool('add_supplier', 'A new supplier or shop to buy from.', { name: { type: 'string' } }, [
    'name',
  ]),
  tool(
    'add_fixed_cost',
    'A monthly fixed cost such as rent, electricity, gas or internet (counts in profit from today).',
    {
      kind: { type: 'string', enum: [...FIXED_KINDS] },
      label: { type: 'string', description: 'Short name, optional.' },
      monthly: MONEY('The amount a month'),
      branch: { ...BRANCH_PROP, description: 'Branch name; omit for the whole restaurant.' },
    },
    ['kind', 'monthly'],
  ),
  tool(
    'set_food_cost',
    'The usual food cost, as a percent of sales, for dishes whose ingredients are not written yet.',
    { percent: { type: 'number', minimum: 0, maximum: 100 } },
    ['percent'],
  ),
  tool(
    'remember_rule',
    'Something the owner wants Xedine to remember and respect in every answer (a goal, a rule, a limit).',
    {
      kind: { type: 'string', enum: ['goal', 'rule', 'constraint'] },
      text: { type: 'string', description: 'In the owner’s words, one sentence.' },
    },
    ['kind', 'text'],
  ),
];

/** Words that ask for a change, in English, Banglish and Bangla. */
const DO_WORDS =
  /\b(add|create|make|new|set|change|raise|increase|lower|reduce|put|remove|take off|hide|show|record|log|write|note|plan|book|schedule|remember|mark|update|bought|buy|threw|thrown|wasted|spoiled|close|closed)\b|koro|kore|dao|daw|likho|jog|baran|komao|bondho|kinlam|kinechi|felechi|নতুন|যোগ|যুক্ত|বানাও|করো|করে দাও|দাও|লিখ|বাড়া|কমা|বদল|সরাও|বন্ধ|মনে রাখ|কিনেছি|কিনলাম|ফেলে|নষ্ট|পার্টি|অর্ডার/i;

/** The change tools by what a request is about, in English, Banglish and Bangla. */
const ACTION_GROUPS: { words: RegExp; kinds: ActionKind[] }[] = [
  {
    words:
      /menu|dish|item|price|category|group|plate|sell|serve|tehari|biryani|kacchi|dam|মেনু|দাম|আইটেম|খাবার|প্লেট|গ্রুপ/i,
    kinds: ['add_category', 'add_dish', 'change_price', 'set_dish_on_menu'],
  },
  {
    words:
      /party|order|catering|event|wedding|holiday|eid|match|cricket|rain|hartal|special day|busy|closed|close|tomorrow|friday|saturday|sunday|monday|tuesday|wednesday|thursday|পার্টি|অর্ডার|বিয়ে|ছুটি|ঈদ|খেলা|বৃষ্টি|হরতাল|বন্ধ|ভিড়|কাল|শুক্রবার|শনিবার/i,
    kinds: ['add_special_day', 'add_party_order'],
  },
  {
    words:
      /bought|buy|bazar|bazaar|purchase|supplier|shop|kinlam|kinechi|বাজার|কিনেছি|কিনলাম|কেনা|সাপ্লায়ার|দোকান/i,
    kinds: ['record_purchase', 'add_supplier'],
  },
  {
    words: /waste|threw|thrown|spoil|burnt|burned|dropped|leftover|felechi|নষ্ট|ফেলে|পুড়ে|পচে/i,
    kinds: ['log_waste'],
  },
  {
    words:
      /rent|bill|electric|gas|fuel|internet|cost|expense|food cost|ভাড়া|বিল|বিদ্যুৎ|গ্যাস|খরচ/i,
    kinds: ['add_fixed_cost', 'set_food_cost'],
  },
  {
    words: /remember|rule|goal|never|always|policy|মনে রাখ|নিয়ম|লক্ষ্য|কখনো|সবসময়/i,
    kinds: ['remember_rule'],
  },
];

/**
 * Which change tools a question is offered. The everyday model's provider allows few tokens a minute, so it
 * gets only the groups the request is about (all of them when none can be told); X7 gets every one.
 */
export function actionToolsFor(question: string, roles: readonly Role[]): Anthropic.Tool[] {
  if (!DO_WORDS.test(question)) return [];
  const kinds = new Set(
    ACTION_GROUPS.filter((g) => g.words.test(question)).flatMap((g) => g.kinds),
  );
  return ACTION_TOOL_DEFS.filter((t) => {
    const k = t.name.replace(/^propose_/, '') as ActionKind;
    return mayDo(k, roles) && (kinds.size === 0 || kinds.has(k));
  });
}

export const actionKindOfTool = (name: string): ActionKind | null => {
  const k = name.startsWith('propose_') ? name.slice('propose_'.length) : '';
  return isActionKind(k) ? k : null;
};
