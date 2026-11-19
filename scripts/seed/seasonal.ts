/**
 * S10 ground truth (ROADMAP Phase 7): the seasonal shape already in the generated orders — Ramadan's
 * iftar surge, Eid closures and the rebound, salary week, rainy days — measured the way a forecast is
 * judged: units per daypart. Fixture data only.
 */
import { addDays } from '../../src/lib/time/business-date';
import { ANCHOR_DATE, CALENDAR, FIRST_DATE, type OrgCfg } from './config';
import type { DayRows } from './generate';
import type { Scenario } from './manifest';
import { makeRng } from './rng';

export const RAMADAN = CALENDAR.find((c) => c.kind === 'ramadan')!;
export const EID_CLOSURES = CALENDAR.filter((c) => c.kind === 'eid').flatMap((c) => {
  const out: string[] = [];
  for (let d: string = c.starts_on; d <= c.ends_on; d = addDays(d, 1)) out.push(d);
  return out;
});
/** The last two weeks of Ramadan, and the two weeks before it began: where the iftar shift shows. */
export const RAMADAN_WINDOW = { from: addDays(RAMADAN.ends_on, -13), to: RAMADAN.ends_on };
export const BEFORE_WINDOW = {
  from: addDays(RAMADAN.starts_on, -14),
  to: addDays(RAMADAN.starts_on, -1),
};
/** The org's default "snacks" daypart, 16:00–19:00 Dhaka — iftar. */
const SNACKS = (hour: number) => hour >= 16 && hour < 19;

/** Days the demo org's weather flag says it rained (the generator uses the same random stream). */
export function rainDays(org: OrgCfg): string[] {
  const out: string[] = [];
  for (let d = FIRST_DATE; d <= ANCHOR_DATE; d = addDays(d, 1))
    if (makeRng('rain', org.key, d).chance(0.08)) out.push(d);
  return out;
}

/** The 84 days the salary-week factor is learned over (m_calendar_factors at the anchor date). */
const SALARY_WINDOW = { from: addDays(ANCHOR_DATE, -84), to: addDays(ANCHOR_DATE, -1) };
const HOLIDAYS = CALENDAR.filter((c) => c.kind === 'holiday').map((c) => c.starts_on as string);

export class Seasonal {
  private units = new Map<string, { snacks: number; all: number }>();
  private closedOrders = 0;
  /** Units sold per org, branch and day over SALARY_WINDOW (completed orders, active lines). */
  private daily = new Map<string, Map<string, number>>();

  add(org: OrgCfg, date: string, rows: DayRows, branchKey?: string): void {
    if (EID_CLOSURES.includes(date)) this.closedOrders += rows.orders.length;
    if (branchKey && date >= SALARY_WINDOW.from && date <= SALARY_WINDOW.to) {
      const done = new Set(
        rows.orders.filter((o) => o.order_status === 'completed').map((o) => String(o.id)),
      );
      let units = 0;
      for (const l of rows.order_items)
        if (l.status === 'active' && done.has(String(l.order_id))) units += Number(l.quantity);
      const key = `${org.key}.${branchKey}`;
      const days = this.daily.get(key) ?? new Map<string, number>();
      days.set(date, (days.get(date) ?? 0) + units);
      this.daily.set(key, days);
    }
    if (org.key !== 'demo_kacchi_house') return;
    const inWindow = (w: { from: string; to: string }) => date >= w.from && date <= w.to;
    const key = inWindow(RAMADAN_WINDOW) ? 'ramadan' : inWindow(BEFORE_WINDOW) ? 'before' : null;
    if (!key) return;
    const placed = new Map(
      rows.orders
        .filter((o) => o.order_status === 'completed')
        .map((o) => [String(o.id), String(o.placed_at)]),
    );
    const acc = this.units.get(key) ?? { snacks: 0, all: 0 };
    for (const l of rows.order_items) {
      const at = placed.get(String(l.order_id));
      if (!at || l.status !== 'active') continue;
      // Asia/Dhaka is UTC+6 all year (no daylight saving).
      const hour = Math.floor(Date.parse(at) / 3_600_000 + 6) % 24;
      acc.all += Number(l.quantity);
      if (SNACKS(hour)) acc.snacks += Number(l.quantity);
    }
    this.units.set(key, acc);
  }

  /**
   * The salary-week lift the generated orders really have, measured as m_calendar_factors does: average
   * units on salary-week days (1st–7th) ÷ other normal days over SALARY_WINDOW, leaving out closed, rainy,
   * holiday and Ramadan days. The planted lift is 8%; the day-to-day noise moves what a branch shows.
   */
  private salaryFactors(orgs: readonly OrgCfg[]): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const org of orgs) {
      const rain = new Set(rainDays(org));
      out[org.key] = {};
      for (const b of org.branches) {
        const days = this.daily.get(`${org.key}.${b.key}`) ?? new Map<string, number>();
        const sal: number[] = [];
        const other: number[] = [];
        for (const [date, units] of days) {
          const ramadan = date >= RAMADAN.starts_on && date <= RAMADAN.ends_on;
          if (rain.has(date) || EID_CLOSURES.includes(date) || HOLIDAYS.includes(date) || ramadan)
            continue;
          (Number(date.slice(8, 10)) <= 7 ? sal : other).push(units);
        }
        const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
        out[org.key]![b.key] =
          sal.length && other.length ? Math.round((avg(sal) / avg(other)) * 1e6) / 1e6 : 1;
      }
    }
    return out;
  }

  scenario(orgs: readonly OrgCfg[]): Scenario {
    const share = (k: string) => {
      const u = this.units.get(k) ?? { snacks: 0, all: 0 };
      return u.all > 0 ? Math.round((u.snacks * 10000) / u.all) : 0;
    };
    return {
      id: 'S10',
      title: 'Ramadan iftar surge, Eid closure + rebound, salary-week lift, rainy-day dine-in dip',
      status: 'planted',
      available_from_phase: 0,
      detected_in_phase: 7,
      org: 'demo_kacchi_house',
      facts: {
        ramadan_from: RAMADAN.starts_on,
        ramadan_to: RAMADAN.ends_on,
        eid_closures: EID_CLOSURES,
        orders_on_closures: this.closedOrders,
        salary_week_lift_bps: 800,
        // What each branch's orders really show (the planted 8% plus the day-to-day noise).
        salary_week_factor_realized: this.salaryFactors(orgs),
        rain_dip_bps: 300,
        rain_days: Object.fromEntries(orgs.map((o) => [o.key, rainDays(o).length])),
        ramadan_window: RAMADAN_WINDOW,
        before_window: BEFORE_WINDOW,
        // Share of Kacchi House units sold 16:00–19:00 (the "snacks" daypart: iftar).
        snacks_share_ramadan_bps: share('ramadan'),
        snacks_share_before_bps: share('before'),
      },
      note: 'Phase 7: closures forecast zero, the salary-week and rain factors are learned, and the Ramadan forecast carries the iftar shift.',
    };
  }
}
