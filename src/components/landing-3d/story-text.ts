'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import {
  DEFAULT_LOCALE,
  formatMoney,
  formatNumber,
  isLocale,
  type Locale,
} from '@/lib/i18n/format';
import type { ScreenText } from './screens';
import {
  BILLS_BY_HOUR,
  BILLS_TODAY,
  bazarLineCost,
  bazarList,
  bestSellers,
  branchSales,
  cashExpected,
  cashShort,
  changeOnLastWeek,
  CHEESE_USED_G,
  cheeseLoss,
  cheeseLossMonth,
  cheeseOverGrams,
  dailyCost,
  daysOfCover,
  type DemoCurrency,
  DEMO_ORDER,
  demoBill,
  DISCOUNT_CODE,
  DISCOUNT_PCT,
  DISHES,
  dishProfits,
  foodCost,
  foodCostPct,
  FORECAST_TOMORROW,
  type Ingredient,
  KCAL,
  leaks,
  leaksTotal,
  LUNCH_BURGERS,
  lunchShare,
  lunchStock,
  MEMBER_POINTS_BEFORE,
  MENU_PRICES,
  MORNING_BAZAR,
  NEW_ITEM_PRICE_BDT,
  NEW_ITEM_QTY_ML,
  OFFER_HOLDOUT,
  OFFER_PCT,
  OFFER_PHONES,
  PEER_FOOD_COST_PCT,
  priceLevel,
  PROTEIN_G,
  RAIN_MM,
  RECIPES,
  sales,
  SOLD_LAST_WEEK,
  SOLD_TODAY,
  STAFF_PRESENT,
  STAFF_TOTAL,
  STOCK_LAST_NIGHT,
  TAX_PCT,
  trueProfit,
  UNIT,
  WASTE_TODAY,
  wasteCost,
  wasteTotal,
} from './story-ledger';

export const DISH_ICON = {
  burger: '🍔',
  latte: '☕',
  croissant: '🥐',
  pizza: '🍕',
  fries: '🍟',
} as const;
const ITEM_ICON: Partial<Record<Ingredient, string>> = {
  bun: '🍞',
  patty: '🥩',
  cheese: '🧀',
  milk: '🥛',
  coffee: '🫘',
  potato: '🥔',
};

/** Bills from 7:00 to 12:30, for "today so far" at the manager's moment. */
const BILLS_BY_LUNCH =
  BILLS_BY_HOUR.slice(0, 6).reduce((s, n) => s + n, 0) + Math.round(BILLS_BY_HOUR[6] / 2);

export type StoryContext = { currency: DemoCurrency; taxName: string };

export function useStoryNumbers({ currency }: StoryContext) {
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = useTranslations('landing3d.day');
  return useMemo(() => {
    const money = (minor: number) => formatMoney(minor, locale, currency);
    const num = (n: number, fractionDigits = 0) => formatNumber(n, locale, { fractionDigits });
    const qty = (ing: Ingredient | 'oat', base: number) => {
      const unit = ing === 'oat' ? 'ml' : UNIT[ing];
      if (unit === 'pcs') return t('units.pcs', { n: num(base) });
      if (base >= 1000)
        return t(unit === 'g' ? 'units.kg' : 'units.l', {
          n: num(base / 1000, base % 1000 ? 1 : 0),
        });
      return t(unit === 'g' ? 'units.g' : 'units.ml', { n: num(base) });
    };
    const item = (ing: Ingredient) => t(`items.${ing}`);
    const dish = (d: (typeof DISHES)[number]) => t(`dishes.${d}`);
    const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n))}%`;
    return { locale, money, num, qty, item, dish, pct };
  }, [locale, currency, t]);
}

/** Every word and number the screens draw, ready (ScreenText). */
export function useScreenText(ctx: StoryContext): ScreenText {
  const t = useTranslations('landing3d.day');
  const appName = useTranslations('common')('appName');
  const n = useStoryNumbers(ctx);
  return useMemo(() => {
    const { money, num, qty, item, dish } = n;
    const cur = ctx.currency;
    const s = (key: string, values?: Record<string, string | number>) =>
      t(`screens.${key}`, values);
    const w: Record<string, string> = {};
    for (const key of [
      'brief',
      'goodMorning',
      'askAnything',
      'telegram',
      'stock',
      'bought',
      'guardOk',
      'foodSafety',
      'checks',
      'team',
      'privateNote',
      'plan',
      'rainMoves',
      'buyList',
      'sendList',
      'holiday',
      'table',
      'menu',
      'dontEat',
      'nuts',
      'beef',
      'joinMember',
      'notifyMe',
      'play',
      'quiz',
      'newOrder',
      'total',
      'cash',
      'card',
      'placeOrder',
      'sent',
      'offline',
      'quickOrder',
      'approval',
      'approved',
      'profitLocked',
      'kds',
      'ready',
      'used',
      'poster',
      'posterHead',
      'posterCut',
      'posted',
      'video',
      'suggests',
      'approve',
      'deleted',
      'notifyTitle',
      'notifyHead',
      'notifyWhat',
      'notifyHow',
      'notifyWhy',
      'notifyNoSms',
      'notifyOpen',
      'howWasIt',
      'thanks',
      'openGoogle',
      'complaint',
      'complaintText',
      'why',
      'whyText',
      'gave',
      'gaveText',
      'fixed',
      'fixedText',
      'closed',
      'closeDay',
      'expected',
      'counted',
      'short',
      'best',
      'leaks',
      'trueProfit',
      'ownerOnly',
      'home',
      'tomorrowBest',
      'checkout',
      'paid',
      'late',
      'newTicket',
      'readyDone',
      'approvalTitle',
      'approvalPin',
      'askTitle',
      'friesLabel',
    ]) {
      w[key] = s(key);
    }
    const bill = demoBill(cur);
    const staffNames = ['rahim', 'mitu', 'sajid', 'nadia', 'karim', 'lima', 'babu'] as const;
    const stock = lunchStock();
    const days = s('days').split(',');
    const leakRows = leaks(cur);
    const top = bestSellers();
    const quietBills = (BILLS_BY_HOUR[9]! + BILLS_BY_HOUR[10]!) / 2;
    const lunchBills = (BILLS_BY_HOUR[5]! + BILLS_BY_HOUR[6]! + BILLS_BY_HOUR[7]!) / 3;
    const quietPct = Math.round((1 - quietBills / lunchBills) * 100);
    const shopperLines = [
      ...MORNING_BAZAR.map(
        (l) => `${item(l.ing)} ${qty(l.ing, l.qty)} ${money(bazarLineCost(l, cur))}`,
      ),
      `${t('items.oatMilk')} ${qty('oat', NEW_ITEM_QTY_ML)} ${money(Math.round(NEW_ITEM_PRICE_BDT * priceLevel(cur)))}`,
    ];
    const bazarTotal =
      MORNING_BAZAR.reduce((sum, l) => sum + bazarLineCost(l, cur), 0) +
      Math.round(NEW_ITEM_PRICE_BDT * priceLevel(cur));
    return {
      brand: appName,
      w,
      brief: [
        // Which dishes will likely sell best, never a count of dishes (the founder, 2026-11-17).
        s('todayBest', { dishes: bestSellers().slice(0, 2).map(dish).join(', ') }),
        s('rainAt', { mm: num(RAIN_MM) }),
        s('runningOut', { n: num(STOCK_LAST_NIGHT.bun ?? 0) }),
        s('licence', { n: num(12) }),
      ],
      telegram: {
        lines: shopperLines,
        ask: s('newItemQ', { item: t('items.oatMilk') }),
        yes: s('yesNew'),
        no: s('sameItem'),
        saved: s('savedDraft', { count: num(shopperLines.length), total: money(bazarTotal) }),
        lasts: (['milk', 'bun'] as const).map((ing) =>
          s('lastsFor', { item: item(ing), days: num(daysOfCover(ing), 1) }),
        ),
      },
      stockUp: MORNING_BAZAR.map((l) => {
        const before = STOCK_LAST_NIGHT[l.ing] ?? 0;
        const after = before + l.qty;
        const full = after * 1.15;
        return {
          name: `${ITEM_ICON[l.ing] ?? ''} ${item(l.ing)}`,
          from: before / full,
          to: after / full,
          label: qty(l.ing, after),
          note: s('lasts', { days: num(daysOfCover(l.ing), 1) }),
        };
      }),
      safety: {
        lots: [
          { name: `🥛 ${item('milk')}`, value: s('expired'), tone: 'off' },
          { name: `🥛 ${item('milk')}`, value: s('useBy', { n: num(3) }), tone: 'ok' },
          {
            name: `🍶 ${t('items.cream')}`,
            value: s('held', { dish: t('items.icedCoffee') }),
            tone: 'warn',
          },
          { name: `🧀 ${item('cheese')}`, value: s('useBy', { n: num(4) }), tone: 'ok' },
          { name: `🥩 ${item('patty')}`, value: s('useBy', { n: num(2) }), tone: 'ok' },
        ],
        checks: [
          { name: s('checkFridge'), tone: 'ok' },
          { name: s('checkHands'), tone: 'ok' },
          { name: s('checkPest'), tone: 'warn' },
        ],
        licence: s('licence', { n: num(12) }),
      },
      staff: {
        rows: staffNames.map((k, i) => ({
          name: t(`staff.${k}`),
          tone: i < STAFF_PRESENT ? 'ok' : 'off',
        })),
        present: s('present', { n: num(STAFF_PRESENT), total: num(STAFF_TOTAL) }),
      },
      plan: {
        days: days.map((label, i) => ({
          label,
          icon: i === 1 ? '🌧️' : i === 4 ? '⛅' : '☀️',
          mm: i === 1 ? `${num(RAIN_MM)} mm` : '',
          holiday: i === 5,
        })),
        best: bestSellers(FORECAST_TOMORROW)
          .slice(0, 3)
          .map((d) => ({ icon: DISH_ICON[d], name: dish(d) })),
        buy: bazarList().map((l) => ({
          name: `${ITEM_ICON[l.ing] ?? ''} ${item(l.ing)}`,
          value: qty(l.ing, l.qty),
        })),
      },
      table: {
        dishes: (['burger', 'latte', 'croissant', 'pizza'] as const).map((d) => ({
          icon: DISH_ICON[d],
          name: dish(d),
          note: `${s('kcal', { n: num(KCAL[d]) })} · ${s('protein', { n: num(PROTEIN_G[d]) })}`,
          value: money(MENU_PRICES[cur][d]),
        })),
        points: s('memberPoints', { n: num(MEMBER_POINTS_BEFORE) }),
      },
      till: {
        tiles: (['burger', 'latte', 'croissant', 'pizza'] as const).map((d) => ({
          icon: DISH_ICON[d],
          name: dish(d),
        })),
        lines: DEMO_ORDER.map((d) => ({
          icon: DISH_ICON[d],
          name: dish(d),
          value: money(MENU_PRICES[cur][d]),
        })),
        member: s('member', { name: t('staff.rina'), points: num(MEMBER_POINTS_BEFORE) }),
        code: `${s('code', { code: DISCOUNT_CODE })} · ${num(DISCOUNT_PCT)}%`,
        subtotal: money(bill.subtotal),
        discount: `−${money(bill.discount)}`,
        tax: money(bill.tax),
        taxName: `${ctx.taxName} ${num(TAX_PCT)}%`,
        total: money(bill.total),
        cash: money(bill.cash),
        card: money(bill.card),
        points: s('pointsEarned', { n: num(bill.points) }),
      },
      approval: {
        ask: s('approvalAsk', {
          name: t('staff.mitu'),
          pct: num(30),
          table: s('tableN', { n: num(2) }),
        }),
        pct: `${num(30)}%`,
        recorded: s('recorded', { who: t('staff.mitu'), by: t('staff.nadia') }),
        soFar: s('salesSoFar', {
          amount: money(Math.round((sales(SOLD_TODAY, cur) * BILLS_BY_LUNCH) / BILLS_TODAY)),
          bills: num(BILLS_BY_LUNCH),
        }),
      },
      kds: {
        signedIn: s('signedIn', { name: t('staff.rahim') }),
        // Each ticket says which table, what to cook and how long it has waited (no order numbers).
        tickets: [
          { where: s('tableN', { n: num(7) }), lines: [`2× ${dish('pizza')}`], mins: 6 },
          {
            where: s('takeaway'),
            lines: [`2× ${dish('latte')}`, `1× ${dish('croissant')}`],
            mins: 11,
          },
          {
            where: s('tableN', { n: num(2) }),
            lines: [`2× ${dish('burger')}`, `1× ${dish('fries')}`],
            mins: 3,
          },
        ].map((tk) => ({ ...tk, wait: s('minsWaiting', { n: num(tk.mins) }) })),
        next: {
          where: s('tableN', { n: num(4) }),
          lines: DEMO_ORDER.map((d) => `1× ${dish(d)}`),
          mins: 0,
          wait: s('minsWaiting', { n: num(0) }),
        },
      },
      scale: {
        grams: `${num(CHEESE_USED_G)} g`,
        recipe: s('scaleRecipe', { n: num(RECIPES.burger.cheese ?? 0) }),
      },
      stockDown: {
        bars: stock.map((b) => ({
          name: `${ITEM_ICON[b.ing] ?? ''} ${item(b.ing)}`,
          from: b.from / b.full,
          to: b.to / b.full,
          label: qty(b.ing, b.to),
        })),
        loss: s('lossLine', {
          grams: qty('cheese', cheeseOverGrams()),
          amount: money(cheeseLoss(cur)),
        }),
        waste: s('wasteLine', { amount: money(wasteCost(WASTE_TODAY[2]!, cur)) }),
        left: s('leftNoCount', { qty: qty('cheese', stock[2]!.to) }),
      },
      poster: { price: money(MENU_PRICES[cur].latte), dish: dish('latte') },
      offer: {
        quiet: s('quietHours', { pct: num(quietPct) }),
        line: s('offerLine', { pct: num(OFFER_PCT) }),
        sendTo: s('sendTo', { n: num(OFFER_PHONES), hold: num(OFFER_HOLDOUT) }),
        sent: s('sentTo', { n: num(OFFER_PHONES - OFFER_HOLDOUT) }),
        regulars: s('regulars', { a: num(31), b: num(6) }),
      },
      notify: {
        body: s('notifyBody', { pct: num(OFFER_PCT) }),
        pct: s('notifyPct', { pct: num(OFFER_PCT) }),
      },
      closing: {
        expected: money(cashExpected(cur)),
        counted: money(cashExpected(cur) - cashShort(cur)),
        short: money(cashShort(cur)),
        sales: money(sales(SOLD_TODAY, cur)),
        bills: s('bills', { n: num(BILLS_TODAY) }),
        best: top
          .slice(0, 3)
          .map((d) => ({ icon: DISH_ICON[d], name: dish(d), value: num(SOLD_TODAY[d]) })),
        lunch: s('lunchShare', { pct: num(lunchShare()) }),
        hours: [...BILLS_BY_HOUR],
      },
      leaks: {
        rows: leakRows.map((l) => {
          if (l.kind === 'cheese')
            return {
              name: s('leakCheese'),
              value: money(l.amount),
              note: s('cheeseProof', {
                burgers: num(LUNCH_BURGERS),
                extra: num(CHEESE_USED_G - (RECIPES.burger.cheese ?? 0)),
              }),
              icon: s('cheeseDo', { recipe: num(RECIPES.burger.cheese ?? 0) }),
            };
          if (l.kind === 'waste')
            return {
              name: s('leakWaste'),
              value: money(l.amount),
              note: s('wasteProof'),
              icon: s('wasteDo'),
            };
          return {
            name: s('leakCash'),
            value: money(l.amount),
            note: s('cashProof'),
            icon: s('cashDo'),
          };
        }),
        total: `= ${money(leaksTotal(cur))}`,
        profit: [
          { name: s('salesLine'), value: money(sales(SOLD_TODAY, cur)) },
          { name: s('foodLine'), value: `−${money(foodCost(cur))}` },
          {
            name: s('costsLine'),
            value: `−${money(dailyCost('rent', cur) + dailyCost('salaries', cur) + dailyCost('bills', cur) + dailyCost('other', cur))}`,
          },
        ],
        profitTotal: money(trueProfit(cur)),
        star: s('menuStar', { dish: dish(dishProfits(cur)[0]!.dish) }),
      },
      ask: {
        q: t('ask.q.money'),
        a: s('askReply', {
          total: money(leaksTotal(cur)),
          recipe: num(RECIPES.burger.cheese ?? 0),
        }),
        placeholder: t('ask.placeholder'),
      },
    } satisfies ScreenText;
  }, [t, n, ctx.currency, ctx.taxName, appName]);
}

/** The answers in the ending's chat, each built from the ledger (never typed by hand). */
export function useAnswers(ctx: StoryContext) {
  const t = useTranslations('landing3d.day');
  const n = useStoryNumbers(ctx);
  return useMemo(() => {
    const { money, num, qty, item, dish, pct } = n;
    const cur = ctx.currency;
    const profits = dishProfits(cur);
    const best = bestSellers()[0]!;
    const wasteOf = (what: 'milk' | 'patty' | 'fries') =>
      money(
        wasteCost(
          WASTE_TODAY.find((l) => l.what === what)!,
          cur,
        ),
      );
    const list = bazarList()
      .map((l) => `• ${item(l.ing)}: ${qty(l.ing, l.qty)}`)
      .join('\n');
    return {
      money: t('ask.a.money', {
        total: money(leaksTotal(cur)),
        cheese: money(cheeseLoss(cur)),
        grams: qty('cheese', cheeseOverGrams()),
        burgers: num(LUNCH_BURGERS),
        month: money(cheeseLossMonth(cur)),
        waste: money(wasteTotal(cur)),
        cash: money(cashShort(cur)),
        recipe: num(RECIPES.burger.cheese ?? 0),
      }),
      waste: t('ask.a.waste', {
        waste: money(wasteTotal(cur)),
        milk: wasteOf('milk'),
        patty: wasteOf('patty'),
        fries: wasteOf('fries'),
        grams: qty('cheese', cheeseOverGrams()),
        cheese: money(cheeseLoss(cur)),
      }),
      buy: t('ask.a.buy', {
        best: bestSellers(FORECAST_TOMORROW).slice(0, 3).map(dish).join(', '),
        list,
      }),
      profit: t('ask.a.profit', {
        dish1: dish(profits[0]!.dish),
        p1: money(profits[0]!.profit),
        dish2: dish(profits[1]!.dish),
        p2: money(profits[1]!.profit),
        dish3: dish(profits[2]!.dish),
        p3: money(profits[2]!.profit),
      }),
      week: t('ask.a.week', {
        today: money(sales(SOLD_TODAY, cur)),
        change: pct(changeOnLastWeek(cur)),
        before: money(sales(SOLD_LAST_WEEK, cur)),
        bills: num(BILLS_TODAY),
        best: dish(best),
        lunch: num(lunchShare()),
      }),
    } as const;
  }, [t, n, ctx.currency]);
}

/** Labels over the city and the globe. */
export function useCityText(ctx: StoryContext) {
  const t = useTranslations('landing3d.day');
  const n = useStoryNumbers(ctx);
  return useMemo(() => {
    const [here, riverside, oldTown] = branchSales(ctx.currency);
    return {
      branches: [
        { name: t('branches.riverside'), value: n.money(riverside), rank: 1 },
        { name: t('branches.here'), value: n.money(here), rank: 2 },
        { name: t('branches.oldTown'), value: n.money(oldTown), rank: 3 },
      ],
      waiting: `${t('branches.lakeRoad')} · ${t('screens.awaiting')}`,
      peers: t('screens.peers', {
        ours: n.num(foodCostPct(ctx.currency)),
        peers: n.num(PEER_FOOD_COST_PCT),
      }),
      title: t('screens.branches'),
      countries: t('screens.countries'),
    };
  }, [t, n, ctx.currency]);
}
