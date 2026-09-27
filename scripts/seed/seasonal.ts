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

export class Seasonal {
  private units = new Map<string, { snacks: number; all: number }>();
  private closedOrders = 0;

  add(org: OrgCfg, date: string, rows: DayRows): void {
    if (EID_CLOSURES.includes(date)) this.closedOrders += rows.orders.length;
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
