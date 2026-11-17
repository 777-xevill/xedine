import { describe, expect, it } from 'vitest';
import {
  bazarList,
  cashExpected,
  cashShort,
  cheeseLoss,
  cheeseOverGrams,
  dailyCosts,
  daysOfCover,
  DEMO_CURRENCIES,
  DEMO_ORDER,
  demoBill,
  demoCurrency,
  demoOrderTotal,
  DISHES,
  dishProfits,
  foodCost,
  leaks,
  leaksTotal,
  lunchStock,
  MENU_PRICES,
  plateCost,
  sales,
  SOLD_TODAY,
  trueProfit,
  wasteTotal,
} from './story-ledger';

describe('the demo café ledger (ADR 0064)', () => {
  it('prices every dish in whole minor units in every market', () => {
    for (const cur of DEMO_CURRENCIES) {
      for (const d of DISHES) {
        expect(Number.isSafeInteger(MENU_PRICES[cur][d])).toBe(true);
        expect(MENU_PRICES[cur][d]).toBeGreaterThan(0);
      }
    }
  });

  it('falls back to dollars for a currency outside the ten markets', () => {
    expect(demoCurrency('BDT')).toBe('BDT');
    expect(demoCurrency('EUR')).toBe('USD');
    expect(demoCurrency(undefined)).toBe('USD');
  });

  it('keeps the lunch order the till has always shown', () => {
    expect(demoOrderTotal(DEMO_ORDER)).toBe(91000);
  });

  it('adds the bill up: discount, tax, total, cash plus card', () => {
    for (const cur of DEMO_CURRENCIES) {
      const b = demoBill(cur);
      expect(b.subtotal - b.discount + b.tax).toBe(b.total);
      expect(b.cash + b.card).toBe(b.total);
      expect(b.cash % 100).toBe(0);
      expect(b.points).toBeGreaterThan(0);
      for (const v of Object.values(b)) expect(Number.isSafeInteger(v)).toBe(true);
    }
    expect(demoBill('BDT')).toMatchObject({
      subtotal: 91000,
      discount: 9100,
      tax: 4095,
      total: 85995,
    });
  });

  it('sells every plate for more than its ingredients cost', () => {
    for (const cur of DEMO_CURRENCIES) {
      for (const d of DISHES) expect(plateCost(d, cur)).toBeLessThan(MENU_PRICES[cur][d]);
    }
  });

  it('counts the extra cheese as a loss: 15 g over on 30 burgers', () => {
    expect(cheeseOverGrams()).toBe(450);
    expect(cheeseLoss('BDT')).toBe(54000);
  });

  it('never takes the lunch stock below zero', () => {
    for (const bar of lunchStock()) {
      expect(bar.to).toBeGreaterThanOrEqual(0);
      expect(bar.to).toBeLessThan(bar.from);
      expect(bar.full).toBeGreaterThan(bar.from);
    }
  });

  it('writes a bazar list of whole, positive amounts', () => {
    const list = bazarList();
    expect(list.length).toBeGreaterThan(0);
    for (const l of list) {
      expect(Number.isInteger(l.qty)).toBe(true);
      expect(l.qty).toBeGreaterThan(0);
    }
  });

  it('ranks the leaks and adds them up', () => {
    for (const cur of DEMO_CURRENCIES) {
      const rows = leaks(cur);
      expect(rows.map((r) => r.amount)).toEqual(
        [...rows.map((r) => r.amount)].sort((a, b) => b - a),
      );
      expect(leaksTotal(cur)).toBe(cheeseLoss(cur) + wasteTotal(cur) + cashShort(cur));
      expect(cashExpected(cur)).toBeGreaterThan(cashShort(cur));
    }
  });

  it('makes the true profit sales less food and every other cost', () => {
    for (const cur of DEMO_CURRENCIES) {
      expect(trueProfit(cur)).toBe(sales(SOLD_TODAY, cur) - foodCost(cur) - dailyCosts(cur));
      expect(trueProfit(cur)).toBeGreaterThan(0);
    }
  });

  it('ranks dishes by the profit they made', () => {
    const p = dishProfits('BDT');
    expect(p[0]!.profit).toBeGreaterThanOrEqual(p[p.length - 1]!.profit);
    expect(p).toHaveLength(DISHES.length);
  });

  it('says how many days the morning bazar lasts', () => {
    expect(daysOfCover('milk')).toBeGreaterThan(1);
    expect(daysOfCover('bun')).toBeGreaterThan(1);
  });
});
