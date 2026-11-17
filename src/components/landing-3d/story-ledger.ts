/**
 * The demo café's day (ADR 0064): every figure the 3D story shows comes from a function here, so a number
 * on a screen, in a sentence and in an answer always agree (CLAUDE.md #1: numbers are deterministic). This is
 * landing-page demo data only, never a production path. Money is in minor units (hundredths) of the visitor's
 * currency; quantities in base units (g, ml, pieces).
 */

export type DemoDish = 'burger' | 'latte' | 'croissant' | 'pizza' | 'fries';
export const DISHES: readonly DemoDish[] = ['burger', 'latte', 'croissant', 'pizza', 'fries'];

/** The currencies of the ten markets Xedine is pitched to first (ADR 0062). Anything else is shown in USD. */
export const DEMO_CURRENCIES = [
  'BDT',
  'INR',
  'PKR',
  'AED',
  'SAR',
  'QAR',
  'MYR',
  'SGD',
  'GBP',
  'USD',
] as const;
export type DemoCurrency = (typeof DEMO_CURRENCIES)[number];

export function demoCurrency(currency: string | null | undefined): DemoCurrency {
  return (DEMO_CURRENCIES as readonly string[]).includes(currency ?? '')
    ? (currency as DemoCurrency)
    : 'USD';
}

/** What a neighbourhood café charges in each market, in minor units. */
export const MENU_PRICES: Record<DemoCurrency, Record<DemoDish, number>> = {
  BDT: { burger: 45000, latte: 28000, croissant: 18000, pizza: 65000, fries: 15000 },
  INR: { burger: 24900, latte: 19900, croissant: 12900, pizza: 39900, fries: 9900 },
  PKR: { burger: 95000, latte: 65000, croissant: 45000, pizza: 145000, fries: 35000 },
  AED: { burger: 3800, latte: 2200, croissant: 1400, pizza: 4800, fries: 1500 },
  SAR: { burger: 3600, latte: 2100, croissant: 1300, pizza: 4600, fries: 1400 },
  QAR: { burger: 3800, latte: 2200, croissant: 1400, pizza: 4800, fries: 1500 },
  MYR: { burger: 2600, latte: 1400, croissant: 900, pizza: 3200, fries: 900 },
  SGD: { burger: 1600, latte: 650, croissant: 450, pizza: 2200, fries: 550 },
  GBP: { burger: 1150, latte: 360, croissant: 290, pizza: 1300, fries: 380 },
  USD: { burger: 1300, latte: 500, croissant: 400, pizza: 1600, fries: 450 },
};

/** How far prices in this market sit from Dhaka's: ingredient costs and overheads scale by it. */
export function priceLevel(cur: DemoCurrency): number {
  return MENU_PRICES[cur].burger / MENU_PRICES.BDT.burger;
}

const scaled = (bdtMinor: number, cur: DemoCurrency) => Math.round(bdtMinor * priceLevel(cur));

export type Ingredient =
  | 'bun'
  | 'patty'
  | 'cheese'
  | 'lettuce'
  | 'tomato'
  | 'milk'
  | 'coffee'
  | 'croissant'
  | 'dough'
  | 'sauce'
  | 'potato'
  | 'oil';

export type BaseUnit = 'pcs' | 'g' | 'ml';

export const UNIT: Record<Ingredient, BaseUnit> = {
  bun: 'pcs',
  patty: 'g',
  cheese: 'g',
  lettuce: 'g',
  tomato: 'g',
  milk: 'ml',
  coffee: 'g',
  croissant: 'pcs',
  dough: 'g',
  sauce: 'g',
  potato: 'g',
  oil: 'ml',
};

/** Dhaka cost of one base unit, in poisha (৳1 = 100). */
const COST_BDT: Record<Ingredient, number> = {
  bun: 2500,
  patty: 100,
  cheese: 120,
  lettuce: 20,
  tomato: 12,
  milk: 11,
  coffee: 200,
  croissant: 7000,
  dough: 8,
  sauce: 25,
  potato: 6,
  oil: 20,
};

/** Dish ingredients (ADR 0037): what goes into one plate. Every order takes these out of stock. */
export const RECIPES: Record<DemoDish, Partial<Record<Ingredient, number>>> = {
  burger: { bun: 1, patty: 150, cheese: 20, lettuce: 15, tomato: 20 },
  latte: { milk: 200, coffee: 18 },
  croissant: { croissant: 1 },
  pizza: { dough: 250, cheese: 120, sauce: 80 },
  fries: { potato: 200, oil: 15 },
};

export function ingredientCost(ing: Ingredient, qty: number, cur: DemoCurrency): number {
  return Math.round(COST_BDT[ing] * qty * priceLevel(cur));
}

/** The cost of one plate, from its ingredients. */
export function plateCost(dish: DemoDish, cur: DemoCurrency): number {
  const parts = Object.entries(RECIPES[dish]) as [Ingredient, number][];
  return Math.round(
    parts.reduce((sum, [ing, qty]) => sum + COST_BDT[ing] * qty, 0) * priceLevel(cur),
  );
}

export type Sold = Record<DemoDish, number>;

/** One day of the café: what sold today and on the same day last week. */
export const SOLD_TODAY: Sold = { burger: 42, latte: 64, croissant: 38, pizza: 18, fries: 40 };
export const SOLD_LAST_WEEK: Sold = { burger: 38, latte: 58, croissant: 35, pizza: 15, fries: 33 };
export const BILLS_TODAY = 118;
/** Bills per hour from 7:00 to 22:00 (the closing chart's shape). */
export const BILLS_BY_HOUR = [3, 6, 5, 4, 5, 9, 18, 20, 12, 5, 4, 6, 8, 7, 4, 2] as const;

export function sales(sold: Sold, cur: DemoCurrency): number {
  return DISHES.reduce((sum, d) => sum + sold[d] * MENU_PRICES[cur][d], 0);
}

/** Today's sales against the same day last week, in whole percent (rounded). */
export function changeOnLastWeek(cur: DemoCurrency): number {
  const now = sales(SOLD_TODAY, cur);
  const before = sales(SOLD_LAST_WEEK, cur);
  return Math.round(((now - before) / before) * 100);
}

/** Best sellers by plates sold, most first. */
export function bestSellers(sold: Sold = SOLD_TODAY): DemoDish[] {
  return [...DISHES].sort((a, b) => sold[b] - sold[a]);
}

/** What each dish earned over its ingredients today, most first (menu profit). */
export function dishProfits(cur: DemoCurrency): { dish: DemoDish; profit: number }[] {
  return DISHES.map((dish) => ({
    dish,
    profit: SOLD_TODAY[dish] * (MENU_PRICES[cur][dish] - plateCost(dish, cur)),
  })).sort((a, b) => b.profit - a.profit);
}

/** Share of the bills that came in the lunch rush (12:00–15:00), whole percent. */
export function lunchShare(): number {
  const all = BILLS_BY_HOUR.reduce((s, n) => s + n, 0);
  const lunch = BILLS_BY_HOUR.slice(5, 8).reduce((s, n) => s + n, 0);
  return Math.round((lunch / all) * 100);
}

// ---------------------------------------------------------------- the till (12:35)

export const DEMO_ORDER: readonly DemoDish[] = ['burger', 'latte', 'croissant'];
export const DISCOUNT_CODE = 'EID10';
export const DISCOUNT_PCT = 10;
/** The owner's own tax rate in this example (ADR 0005: the rate is always the owner's; only its name changes). */
export const TAX_PCT = 5;

export function demoOrderTotal(order: readonly DemoDish[], cur: DemoCurrency = 'BDT'): number {
  return order.reduce((s, d) => s + MENU_PRICES[cur][d], 0);
}

export type DemoBill = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  cash: number;
  card: number;
  points: number;
};

/** The lunch bill at the till: a member, a discount code, the tax, paid part cash, part card. */
export function demoBill(cur: DemoCurrency): DemoBill {
  const subtotal = demoOrderTotal(DEMO_ORDER, cur);
  const discount = Math.round((subtotal * DISCOUNT_PCT) / 100);
  const tax = Math.round(((subtotal - discount) * TAX_PCT) / 100);
  const total = subtotal - discount + tax;
  const unit = 100; // whole units of the currency
  const cash = Math.floor(total / 2 / unit) * unit;
  // Member card: 1 point for every ৳100 spent, the same spend in other currencies.
  const pointUnit = scaled(10000, cur);
  return {
    subtotal,
    discount,
    tax,
    total,
    cash,
    card: total - cash,
    points: Math.floor(total / pointUnit),
  };
}

export const MEMBER_POINTS_BEFORE = 240;

// ---------------------------------------------------------------- stock

/** On the shelf the evening before; the morning's bazar; what the lunch rush took. */
export const STOCK_LAST_NIGHT: Partial<Record<Ingredient, number>> = {
  bun: 12,
  patty: 2100,
  cheese: 1400,
  milk: 3000,
  coffee: 900,
  potato: 4000,
};

export type BazarLine = { ing: Ingredient; qty: number; isNew?: boolean };
/** The shopper's message on Telegram at 7:30 (the oat milk is new: the bot asks). */
export const MORNING_BAZAR: BazarLine[] = [
  { ing: 'milk', qty: 20000 },
  { ing: 'bun', qty: 60 },
  { ing: 'cheese', qty: 2000 },
  { ing: 'patty', qty: 6000 },
];
export const NEW_ITEM_QTY_ML = 5000; // 5 L oat milk
export const NEW_ITEM_PRICE_BDT = 175000; // ৳1,750

export function bazarLineCost(line: BazarLine, cur: DemoCurrency): number {
  return ingredientCost(line.ing, line.qty, cur);
}

/** How much one day uses, from today's plates and the recipes. */
export function usedPerDay(ing: Ingredient, sold: Sold = SOLD_TODAY): number {
  return DISHES.reduce((sum, d) => sum + sold[d] * (RECIPES[d][ing] ?? 0), 0);
}

/** Days the shelf lasts after the morning's bazar, one decimal (ADR 0029: bought for N days). */
export function daysOfCover(ing: Ingredient): number {
  const bought = MORNING_BAZAR.find((l) => l.ing === ing)?.qty ?? 0;
  const have = (STOCK_LAST_NIGHT[ing] ?? 0) + bought;
  return Math.round((have / usedPerDay(ing)) * 10) / 10;
}

/** The cook's hand at lunch: 35 g of cheese on a burger whose recipe says 20 g (ADR 0027). */
export const CHEESE_USED_G = 35;
export const LUNCH_BURGERS = 30;

export function cheeseOverGrams(): number {
  return (CHEESE_USED_G - (RECIPES.burger.cheese ?? 0)) * LUNCH_BURGERS;
}

export function cheeseLoss(cur: DemoCurrency): number {
  return ingredientCost('cheese', cheeseOverGrams(), cur);
}

/** If the same hand goes on every lunch for a month (26 open days). */
export function cheeseLossMonth(cur: DemoCurrency): number {
  return cheeseLoss(cur) * 26;
}

/** The stock bars at the start and the end of the lunch rush (12:00 → 15:00). */
export type StockBar = { ing: Ingredient; from: number; to: number; full: number };
export function lunchStock(): StockBar[] {
  const lattes = 44;
  const start: Partial<Record<Ingredient, number>> = {
    bun: 64,
    patty: 7200,
    cheese: 3000,
    milk: 20000,
  };
  const used: Partial<Record<Ingredient, number>> = {
    bun: LUNCH_BURGERS,
    patty: LUNCH_BURGERS * (RECIPES.burger.patty ?? 0),
    cheese: LUNCH_BURGERS * CHEESE_USED_G,
    milk: lattes * (RECIPES.latte.milk ?? 0),
  };
  return (['bun', 'patty', 'cheese', 'milk'] as const).map((ing) => ({
    ing,
    from: start[ing] ?? 0,
    to: (start[ing] ?? 0) - (used[ing] ?? 0),
    full: Math.round((start[ing] ?? 0) * 1.25),
  }));
}

export type WasteLine = {
  what: 'milk' | 'patty' | 'fries';
  qty: number;
  reason: 'expired' | 'burnt' | 'dropped';
};
/** Written down today, with reasons (from the kitchen screen's waste button). */
export const WASTE_TODAY: WasteLine[] = [
  { what: 'milk', qty: 2000, reason: 'expired' },
  { what: 'patty', qty: 150, reason: 'burnt' },
  { what: 'fries', qty: 1, reason: 'dropped' },
];

export function wasteCost(line: WasteLine, cur: DemoCurrency): number {
  return line.what === 'fries'
    ? plateCost('fries', cur) * line.qty
    : ingredientCost(line.what, line.qty, cur);
}

export function wasteTotal(cur: DemoCurrency): number {
  return WASTE_TODAY.reduce((s, l) => s + wasteCost(l, cur), 0);
}

// ---------------------------------------------------------------- closing and money

/** Cash: the drawer should hold the opening float plus the cash sales; the count is ৳200 short. */
export function cashExpected(cur: DemoCurrency): number {
  return scaled(500000, cur) + Math.round(sales(SOLD_TODAY, cur) * 0.55);
}
export function cashShort(cur: DemoCurrency): number {
  return scaled(20000, cur);
}

/** The month's costs outside food (Settings → Costs), Dhaka poisha, scaled to the market. */
const MONTH_COSTS_BDT = {
  rent: 18000000,
  salaries: 54000000,
  bills: 6200000,
  other: 1800000,
} as const;
export type CostKind = keyof typeof MONTH_COSTS_BDT;

export function dailyCost(kind: CostKind, cur: DemoCurrency): number {
  return Math.round((MONTH_COSTS_BDT[kind] * priceLevel(cur)) / 30);
}

export function dailyCosts(cur: DemoCurrency): number {
  return (Object.keys(MONTH_COSTS_BDT) as CostKind[]).reduce((s, k) => s + dailyCost(k, cur), 0);
}

/** Food cost of what sold, the extra cheese and the waste. */
export function foodCost(cur: DemoCurrency): number {
  const plates = DISHES.reduce((s, d) => s + SOLD_TODAY[d] * plateCost(d, cur), 0);
  return plates + cheeseLoss(cur) + wasteTotal(cur);
}

/** Today's true profit: sales less food (with its losses) and the day's share of every other cost. */
export function trueProfit(cur: DemoCurrency): number {
  return sales(SOLD_TODAY, cur) - foodCost(cur) - dailyCosts(cur);
}

/** Food cost as a share of sales, whole percent; peers in the same segment for the benchmark. */
export function foodCostPct(cur: DemoCurrency): number {
  return Math.round((foodCost(cur) / sales(SOLD_TODAY, cur)) * 100);
}
export const PEER_FOOD_COST_PCT = 28;

/** Today's leaks, biggest first: the extra cheese, the waste, the cash gap. */
export function leaks(cur: DemoCurrency): { kind: 'cheese' | 'waste' | 'cash'; amount: number }[] {
  return [
    { kind: 'cheese' as const, amount: cheeseLoss(cur) },
    { kind: 'waste' as const, amount: wasteTotal(cur) },
    { kind: 'cash' as const, amount: cashShort(cur) },
  ].sort((a, b) => b.amount - a.amount);
}

export function leaksTotal(cur: DemoCurrency): number {
  return leaks(cur).reduce((s, l) => s + l.amount, 0);
}

// ---------------------------------------------------------------- tomorrow

/** The plan for tomorrow: rain after 2 pm moves it (fewer burgers, more hot coffee). */
export const RAIN_MM = 8;
export const FORECAST_TOMORROW: Sold = {
  burger: 39,
  latte: 72,
  croissant: 36,
  pizza: 17,
  fries: 37,
};

export function forecastDishes(): number {
  return DISHES.reduce((s, d) => s + FORECAST_TOMORROW[d], 0);
}
export function lastWeekDishes(): number {
  return DISHES.reduce((s, d) => s + SOLD_LAST_WEEK[d], 0);
}

/** On the shelf tonight, after the day (ADR 0030: estimated, no count). */
export function stockTonight(ing: Ingredient): number {
  const bought = MORNING_BAZAR.find((l) => l.ing === ing)?.qty ?? 0;
  const extra = ing === 'cheese' ? cheeseOverGrams() : 0;
  const wasted = ing === 'milk' ? 2000 : ing === 'patty' ? 150 : 0;
  return Math.max(0, (STOCK_LAST_NIGHT[ing] ?? 0) + bought - usedPerDay(ing) - extra - wasted);
}

export type BuyLine = { ing: Ingredient; qty: number };
/** Tomorrow's bazar list: what the plan needs, plus a tenth to spare, less what is on the shelf. */
export function bazarList(): BuyLine[] {
  const ings: Ingredient[] = ['bun', 'patty', 'cheese', 'milk', 'coffee', 'potato'];
  return ings
    .map((ing) => {
      const need = usedPerDay(ing, FORECAST_TOMORROW) * 1.1;
      return { ing, qty: Math.max(0, Math.ceil(need - stockTonight(ing))) };
    })
    .filter((l) => l.qty > 0);
}

// ---------------------------------------------------------------- customers and branches

export const OFFER_PCT = 15;
export const OFFER_PHONES = 86; // members who allowed offer notifications
export const OFFER_HOLDOUT = 9; // kept out to measure what the offer really adds
export const STAFF_TOTAL = 7;
export const STAFF_PRESENT = 6;
export const KCAL = { burger: 610, latte: 190, croissant: 270, pizza: 820, fries: 360 } as const;
export const PROTEIN_G = { burger: 32, latte: 10, croissant: 5, pizza: 34, fries: 4 } as const;

/** Three branches today: this one and two others (their sales in proportion to this one's). */
export function branchSales(cur: DemoCurrency): [number, number, number] {
  const here = sales(SOLD_TODAY, cur);
  return [here, Math.round(here * 1.14), Math.round(here * 0.82)];
}
