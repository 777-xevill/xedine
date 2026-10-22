import { TOOL_DEFS } from './tools';

/**
 * Which tools a question is offered. Every tool definition is sent with every model call, and a small
 * provider plan (Groq's free tier: 8,000 tokens a minute) cannot carry all of them: so a question gets
 * the two that are always useful (the brief and the app guide) plus the groups its words and its page
 * point at. With a larger plan set AI_TOOLS=all and every question sees every tool.
 */
const ALWAYS = ['get_today_brief', 'find_page'];

interface Group {
  tools: string[];
  /** Pages (`nav.*` keys) whose questions usually belong to the group. */
  pages: string[];
  /** Words, in English, Banglish and Bangla. */
  words: RegExp;
}

export const GROUPS: Record<string, Group> = {
  sales: {
    tools: ['get_sales', 'get_top_items', 'get_item_sales', 'get_channel_mix'],
    pages: ['sales', 'home'],
    words:
      /sale|sell|sold|revenue|turnover|order|busy|best|worst|top|item|dish|channel|foodpanda|pathao|takeaway|dine|bikri|বিক্রি|বিক্রয়|অর্ডার|সেরা|চ্যানেল/i,
  },
  money: {
    tools: ['get_findings', 'explain_finding', 'get_flash_pnl', 'get_staff_exceptions'],
    pages: ['leaks', 'costs', 'staffRecords', 'home'],
    words:
      /leak|loss|lose|losing|profit|money|taka|theft|steal|void|discount|refund|cash|staff|waiter|cashier|fraud|লস|লাভ|টাকা|চুরি|ক্ষতি|ছাড়|লিক|স্টাফ/i,
  },
  stock: {
    tools: [
      'get_stock_status',
      'get_stock_used',
      'get_stock_loss',
      'get_waste',
      'get_food_cost_gap',
      'get_purchases',
    ],
    pages: ['stock', 'purchases'],
    words:
      /stock|ingredient|used|waste|los(s|e|ing)|buy|bought|purchase|bazar|bazaar|supplier|shelf|running (out|low)|inventory|count|food cost|মজুত|স্টক|ওয়েস্ট|লস|ক্ষতি|বাজার|কেনা|ফুরি|নষ্ট|কাঁচামাল|খরচ হ|উপকরণ/i,
  },
  menu: {
    tools: ['get_menu', 'get_recipe', 'get_menu_matrix', 'get_forecast'],
    pages: ['menu', 'recipes', 'menuProfit', 'plan'],
    words:
      /menu|dish|recipe|ingredient|plate|price|margin|cost|forecast|tomorrow|plan|prep|মেনু|দাম|রেসিপি|উপকরণ|প্লেট|লাগে|খরচ|কাল|পরিকল্পনা|মার্জিন/i,
  },
  people: {
    tools: ['get_customers_summary', 'get_reviews_summary'],
    pages: ['customers', 'campaigns', 'growth', 'reviews'],
    words:
      /customer|review|rating|complain|regular|guest|feedback|কাস্টমার|রিভিউ|অভিযোগ|রেটিং|গ্রাহক/i,
  },
  branches: {
    tools: ['compare_branches', 'get_benchmarks'],
    pages: ['branches', 'benchmarks'],
    words: /branch|compare|benchmark|peer|শাখা|ব্রাঞ্চ|তুলনা/i,
  },
  compliance: {
    tools: ['get_compliance'],
    pages: ['compliance'],
    words: /licen[cs]e|vat|tax|compliance|due|expire|mushak|renew|ভ্যাট|লাইসেন্স|ট্যাক্স/i,
  },
};

export function toolNamesFor(question: string, page?: string): string[] {
  const names = new Set(ALWAYS);
  for (const g of Object.values(GROUPS)) {
    // On Home every group's page matches; there the words alone decide.
    if (g.words.test(question) || (page && page !== 'home' && g.pages.includes(page)))
      for (const t of g.tools) names.add(t);
  }
  return [...names];
}

export function selectTools(question: string, page?: string): typeof TOOL_DEFS {
  if (process.env.AI_TOOLS === 'all') return TOOL_DEFS;
  const names = new Set(toolNamesFor(question, page));
  return TOOL_DEFS.filter((t) => names.has(t.name));
}
