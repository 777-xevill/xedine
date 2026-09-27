/**
 * S11 and S12 ground truth (ROADMAP Phase 8), accumulated from the generated rows with the detectors'
 * own definitions (ADR 0021), so the golden check can hold them to ±10%.
 *   S11 — Dhanmondi's Friday 20:00–22:00 slot over the four weeks to the anchor: orders, their net sales
 *         (the finding's impact), the median ticket time against the branch's, and the complaints.
 *   S12 — regulars (≥ 4 visits in the 90 days before the eight-week period) per branch, how many lapsed,
 *         and Uttara's impact: lapsed regulars' 90-day spend ÷ 3 × the period in months.
 */
import { addDays } from '../../src/lib/time/business-date';
import { ANCHOR_DATE, BRANCH_PRICE_CHANGES, ORGS, type BranchCfg, type OrgCfg } from './config';
import { inSlowSlot, LAPSE, S11_SLOT } from './customers';
import type { DayRows } from './generate';
import type { Scenario } from './manifest';
import { roundHalfAway } from './inventory';

export const SERVICE_PERIOD = { from: addDays(ANCHOR_DATE, -27), to: ANCHOR_DATE };
export const LAPSE_PERIOD = { from: addDays(ANCHOR_DATE, -55), to: ANCHOR_DATE };
const SLOW_WORDS =
  /(slow|late|took (too )?long|waited|waiting|delay|দেরি|দেরী|অপেক্ষা|deri|opekkha)/i;

/** percentile_cont(0.5): the middle value, or the mean of the two middle values. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export class Retention {
  private branchTickets = new Map<string, number[]>();
  private slot = { orders: 0, net: 0, tickets: [] as number[], feedbackSlow: 0, feedbackLow: 0 };
  /** Per customer: branch, visits and spend before the lapse period, and whether they came in it. */
  private visits = new Map<
    string,
    { branch: string; before: number; spend: number; during: boolean }
  >();

  add(org: OrgCfg, b: BranchCfg, date: string, rows: DayRows): void {
    const completed = rows.orders.filter((o) => o.order_status === 'completed');
    if (date >= addDays(LAPSE_PERIOD.from, -90) && date <= LAPSE_PERIOD.to) {
      for (const o of completed) {
        if (!o.customer_id) continue;
        const key = `${org.key}/${String(o.customer_id)}`;
        const v = this.visits.get(key) ?? {
          branch: `${org.key}/${b.key}`,
          before: 0,
          spend: 0,
          during: false,
        };
        if (date < LAPSE_PERIOD.from) {
          v.before += 1;
          v.spend += Number(o.net_poisha);
        } else v.during = true;
        this.visits.set(key, v);
      }
    }
    if (org.key !== S11_SLOT.org || b.key !== S11_SLOT.branch) return;
    if (date < SERVICE_PERIOD.from || date > SERVICE_PERIOD.to) return;
    const at = new Map<string, { sent?: number; ready?: number }>();
    for (const e of rows.order_events) {
      const x = at.get(String(e.order_id)) ?? {};
      const ms = Date.parse(String(e.occurred_at));
      if (e.event_type === 'sent_to_kitchen') x.sent = Math.min(x.sent ?? ms, ms);
      if (e.event_type === 'ready') x.ready = Math.min(x.ready ?? ms, ms);
      at.set(String(e.order_id), x);
    }
    const slowOrders = new Set<string>();
    const tickets = this.branchTickets.get(b.key) ?? [];
    for (const o of completed) {
      const x = at.get(String(o.id));
      if (!x?.sent || !x.ready || x.ready <= x.sent) continue;
      const seconds = (x.ready - x.sent) / 1000;
      tickets.push(seconds);
      if (inSlowSlot(org, b, Date.parse(String(o.placed_at)))) {
        this.slot.orders += 1;
        this.slot.net += Number(o.net_poisha);
        this.slot.tickets.push(seconds);
        slowOrders.add(String(o.id));
      }
    }
    this.branchTickets.set(b.key, tickets);
    for (const f of rows.feedback) {
      if (!slowOrders.has(String(f.order_id))) continue;
      if (Number(f.rating) <= 6) this.slot.feedbackLow += 1;
      if (f.comment && SLOW_WORDS.test(String(f.comment))) this.slot.feedbackSlow += 1;
    }
  }

  scenarios(): Scenario[] {
    const kacchi = ORGS.find((o) => o.key === 'demo_kacchi_house')!;
    const lapse: Record<
      string,
      { regulars: number; lapsed: number; lapsed_spend_90d_poisha: number }
    > = {};
    for (const v of this.visits.values()) {
      if (v.before < 4) continue;
      const x = (lapse[v.branch] ??= { regulars: 0, lapsed: 0, lapsed_spend_90d_poisha: 0 });
      x.regulars += 1;
      if (!v.during) {
        x.lapsed += 1;
        x.lapsed_spend_90d_poisha += v.spend;
      }
    }
    const days =
      Date.parse(`${LAPSE_PERIOD.to}T00:00:00Z`) / 86_400_000 -
      Date.parse(`${LAPSE_PERIOD.from}T00:00:00Z`) / 86_400_000 +
      1;
    const uttara = lapse[`${kacchi.key}/${LAPSE.branch}`] ?? {
      regulars: 0,
      lapsed: 0,
      lapsed_spend_90d_poisha: 0,
    };
    return [
      {
        id: 'S11',
        title: 'Dhanmondi Friday 20:00–22:00 ticket times double; "slow" complaints',
        status: 'planted',
        available_from_phase: 8,
        detected_in_phase: 8,
        org: kacchi.key,
        branch: S11_SLOT.branch,
        facts: {
          period_from: SERVICE_PERIOD.from,
          period_to: SERVICE_PERIOD.to,
          weekday: S11_SLOT.weekday,
          from_hour: S11_SLOT.fromHour,
          orders: this.slot.orders,
          net_poisha: this.slot.net,
          median_seconds: Math.round(median(this.slot.tickets)),
          branch_median_seconds: Math.round(median(this.branchTickets.get(S11_SLOT.branch) ?? [0])),
          feedback_slow: this.slot.feedbackSlow,
          feedback_low: this.slot.feedbackLow,
        },
        note: 'Detected by service.slow_slot over the four weeks to the anchor; impact = the slot’s net sales.',
      },
      {
        id: 'S12',
        title: 'Uttara regulars lapse after a price increase',
        status: 'planted',
        available_from_phase: 8,
        detected_in_phase: 8,
        org: kacchi.key,
        branch: LAPSE.branch,
        facts: {
          period_from: LAPSE_PERIOD.from,
          period_to: LAPSE_PERIOD.to,
          lapse_from: LAPSE.from,
          price_changes: BRANCH_PRICE_CHANGES.filter((c) => c.org === kacchi.key).map((c) => ({
            item: c.item,
            from: c.from,
            price_poisha: c.pricePoisha,
          })),
          branches: Object.fromEntries(
            kacchi.branches.map((b) => {
              const x = lapse[`${kacchi.key}/${b.key}`] ?? {
                regulars: 0,
                lapsed: 0,
                lapsed_spend_90d_poisha: 0,
              };
              return [b.key, { regulars: x.regulars, lapsed: x.lapsed }];
            }),
          ),
          impact_poisha: roundHalfAway(uttara.lapsed_spend_90d_poisha * days, 90),
        },
        note: 'Detected by customers.lapse over the eight weeks to the anchor, with the 1 July price change as evidence.',
      },
    ];
  }
}
