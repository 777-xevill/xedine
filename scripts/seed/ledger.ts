/**
 * Accumulates ground truth from the generated rows, one day at a time. The validator later recomputes
 * every one of these numbers with independent SQL, so a bug in either side shows up as a mismatch.
 */
import { computeLine, mulBps } from '../../src/lib/money';
import { addDays } from '../../src/lib/time/business-date';
import {
  ANCHOR_DATE,
  CUTOFF_MINUTES,
  DAYS,
  FIRST_DATE,
  FROZEN_NOW,
  ORGS,
  type OrgCfg,
} from './config';
import { ids, type DayRows, type Row } from './generate';
import {
  excessOverBaseline,
  PENDING_SCENARIOS,
  rateRatioX100,
  type Manifest,
  type Scenario,
  type Totals,
} from './manifest';
import { SEED } from './rng';
import { BEEF_SPIKE_FROM, BEEF_SPIKE_TO, COSTING, unitCostOn } from './costing';
import type { Inventory } from './inventory';
import type { Seasonal } from './seasonal';

interface CostAcc {
  qty: number;
  net: number;
  cost: number;
}
const emptyCost = (): CostAcc => ({ qty: 0, net: 0, cost: 0 });

const emptyTotals = (): Totals => ({
  orders_completed: 0,
  orders_cancelled: 0,
  gross_poisha: 0,
  discount_net_poisha: 0,
  net_poisha: 0,
  vat_poisha: 0,
  service_charge_poisha: 0,
  total_poisha: 0,
  payments_poisha: 0,
});

const emptyQty = () => ({
  last_2h: 0,
  today: 0,
  yesterday: 0,
  last_7d: 0,
  month_to_date: 0,
  total: 0,
});

interface BranchAcc {
  totals: Totals;
  byChannel: Map<string, { orders: number; net_poisha: number }>;
  qty: ReturnType<typeof emptyQty>;
}

interface StaffAcc {
  orders: number;
  voidCount: number;
  voidValue: number;
  discountCount: number;
  discountPoisha: number;
  discountNoReason: number;
}

const num = (v: Row[string] | undefined): number => Number(v ?? 0);

export const QTY_ITEM: Record<string, string> = {
  demo_kacchi_house: 'kacchi_mutton',
  demo_cafe: 'cappuccino',
};

export class Ledger {
  private branches = new Map<string, BranchAcc>();
  private staff = new Map<string, StaffAcc>();
  private comboUnits = new Map<string, { foodpanda: number; total: number }>();
  /** Phase 3: sold units, net and recipe cost of completed orders' active lines. */
  private items = new Map<string, CostAcc>();
  private tehari = new Map<string, CostAcc>();
  private comboFoodpanda = new Map<string, CostAcc>();

  private cost(map: Map<string, CostAcc>, key: string): CostAcc {
    let acc = map.get(key);
    if (!acc) map.set(key, (acc = emptyCost()));
    return acc;
  }
  private readonly nowMs = Date.parse(FROZEN_NOW);
  private readonly monthStart = `${ANCHOR_DATE.slice(0, 8)}01`;

  private branch(org: string, branch: string): BranchAcc {
    const key = `${org}/${branch}`;
    let acc = this.branches.get(key);
    if (!acc)
      this.branches.set(
        key,
        (acc = { totals: emptyTotals(), byChannel: new Map(), qty: emptyQty() }),
      );
    return acc;
  }

  private staffAcc(staffId: string): StaffAcc {
    let acc = this.staff.get(staffId);
    if (!acc)
      this.staff.set(
        staffId,
        (acc = {
          orders: 0,
          voidCount: 0,
          voidValue: 0,
          discountCount: 0,
          discountPoisha: 0,
          discountNoReason: 0,
        }),
      );
    return acc;
  }

  add(org: OrgCfg, branchKey: string, day: DayRows): void {
    const acc = this.branch(org.key, branchKey);
    const channelKey = new Map(org.channels.map((c) => [ids.channel(org, c.key), c.key]));
    const itemKey = new Map(org.menu.map((m) => [ids.item(org, m), m.key]));
    const orderInfo = new Map<
      string,
      { date: string; placedMs: number; channel: string; completed: boolean }
    >();
    const qtyItem = QTY_ITEM[org.key];

    for (const o of day.orders) {
      const channel = channelKey.get(String(o.channel_id)) ?? 'unknown';
      orderInfo.set(String(o.id), {
        date: String(o.business_date),
        placedMs: Date.parse(String(o.placed_at)),
        channel,
        completed: o.order_status === 'completed',
      });
      this.staffAcc(String(o.staff_id)).orders += 1;
      if (o.order_status === 'cancelled') {
        acc.totals.orders_cancelled += 1;
        continue;
      }
      acc.totals.orders_completed += 1;
      acc.totals.gross_poisha += num(o.net_before_discount_poisha);
      acc.totals.discount_net_poisha += num(o.discount_net_poisha);
      acc.totals.net_poisha += num(o.net_poisha);
      acc.totals.vat_poisha += num(o.vat_poisha);
      acc.totals.service_charge_poisha += num(o.service_charge_poisha);
      acc.totals.total_poisha += num(o.total_poisha);
      const ch = acc.byChannel.get(channel) ?? { orders: 0, net_poisha: 0 };
      ch.orders += 1;
      ch.net_poisha += num(o.net_poisha);
      acc.byChannel.set(channel, ch);
    }

    for (const p of day.payments) acc.totals.payments_poisha += num(p.amount_poisha);

    for (const l of day.order_items) {
      if (l.status !== 'active') continue;
      const info = orderInfo.get(String(l.order_id));
      if (!info) continue;
      const key = itemKey.get(String(l.menu_item_id));
      const qty = num(l.quantity);
      if (key === qtyItem) {
        const q = acc.qty;
        q.total += qty;
        if (info.placedMs > this.nowMs - 2 * 3_600_000 && info.placedMs <= this.nowMs)
          q.last_2h += qty;
        if (info.date === ANCHOR_DATE) q.today += qty;
        if (info.date === addDays(ANCHOR_DATE, -1)) q.yesterday += qty;
        if (info.date >= addDays(ANCHOR_DATE, -6) && info.date <= ANCHOR_DATE) q.last_7d += qty;
        if (info.date >= this.monthStart && info.date <= ANCHOR_DATE) q.month_to_date += qty;
      }
      if (key && info.completed) {
        const cost = unitCostOn(org.key, key, info.date) * qty;
        const net = num(l.net_poisha);
        const add = (acc: CostAcc) => {
          acc.qty += qty;
          acc.net += net;
          acc.cost += cost;
        };
        add(this.cost(this.items, `${org.key}/${key}`));
        if (key === 'tehari') {
          if (info.date >= BEEF_SPIKE_FROM && info.date <= BEEF_SPIKE_TO)
            add(this.cost(this.tehari, `${branchKey}/spike`));
          if (info.date >= addDays(BEEF_SPIKE_FROM, -28) && info.date < BEEF_SPIKE_FROM)
            add(this.cost(this.tehari, `${branchKey}/before`));
        }
        if (key === 'family_combo' && info.channel === 'foodpanda')
          add(this.cost(this.comboFoodpanda, branchKey));
      }
      if (key === 'family_combo') {
        const c = this.comboUnits.get(`${org.key}/${branchKey}`) ?? { foodpanda: 0, total: 0 };
        c.total += qty;
        if (info.channel === 'foodpanda') c.foodpanda += qty;
        this.comboUnits.set(`${org.key}/${branchKey}`, c);
      }
    }

    for (const v of day.voids) {
      if (v.after_kot !== true) continue;
      const s = this.staffAcc(String(v.voided_by_staff_id));
      s.voidCount += 1;
      s.voidValue += num(v.value_poisha);
    }
    for (const d of day.discounts) {
      const s = this.staffAcc(String(d.applied_by_staff_id));
      s.discountCount += 1;
      s.discountPoisha += num(d.amount_poisha);
      if (d.reason_code_id === null) s.discountNoReason += 1;
    }
  }

  manifest(inventory: Inventory, seasonal: Seasonal): Manifest {
    const orgs: Manifest['orgs'] = {};
    for (const org of ORGS) {
      const total = emptyTotals();
      const branches: Manifest['orgs'][string]['branches'] = {};
      for (const b of org.branches) {
        const acc = this.branch(org.key, b.key);
        for (const k of Object.keys(total) as (keyof Totals)[]) total[k] += acc.totals[k];
        branches[b.key] = {
          ...acc.totals,
          by_channel: Object.fromEntries(
            [...acc.byChannel.entries()].sort(([a], [c]) => a.localeCompare(c)),
          ),
          item_qty: acc.qty,
        };
      }
      orgs[org.key] = {
        slug: org.slug,
        price_includes_vat: org.priceIncludesVat,
        vat_rate_bps: org.vatRateBps,
        service_charge_bps: org.serviceChargeBps,
        qty_item_key: QTY_ITEM[org.key]!,
        branches,
        totals: total,
      };
    }
    return {
      version: 1,
      seed: SEED,
      anchor_date: ANCHOR_DATE,
      first_date: FIRST_DATE,
      days: DAYS,
      frozen_now: FROZEN_NOW,
      cutoff_minutes: CUTOFF_MINUTES,
      orgs,
      tolerances: {
        sums: 'exact',
        finding_impact_pct: 10,
        max_false_positives_per_branch_week_on_clean_org: 1,
      },
      scenarios: [
        ...this.plantedScenarios(),
        ...inventory.scenarios(ORGS),
        seasonal.scenario(ORGS),
        ...PENDING_SCENARIOS,
      ],
      inventory: inventory.facts(ORGS),
    };
  }

  private plantedScenarios(): Scenario[] {
    const kacchi = ORGS.find((o) => o.key === 'demo_kacchi_house')!;
    const cafe = ORGS.find((o) => o.key === 'demo_cafe')!;
    const branch = (o: OrgCfg, key: string) => o.branches.find((b) => b.key === key)!;
    const staffOf = (o: OrgCfg, bKey: string, sKey: string) => {
      const b = branch(o, bKey);
      return this.staffAcc(
        ids.staff(
          o,
          b,
          b.staff.find((s) => s.key === sKey)!,
        ),
      );
    };
    const peersOf = (o: OrgCfg, bKey: string, exceptKey: string): StaffAcc => {
      const b = branch(o, bKey);
      const sum: StaffAcc = {
        orders: 0,
        voidCount: 0,
        voidValue: 0,
        discountCount: 0,
        discountPoisha: 0,
        discountNoReason: 0,
      };
      for (const s of b.staff) {
        if (s.key === exceptKey) continue;
        const a = this.staffAcc(ids.staff(o, b, s));
        for (const k of Object.keys(sum) as (keyof StaffAcc)[]) sum[k] += a[k];
      }
      return sum;
    };

    // S1 — Mirpur cashier voids after KOT.
    const rafiq = staffOf(kacchi, 'mirpur', 'rafiq');
    const s1Peers = peersOf(kacchi, 'mirpur', 'rafiq');
    const s1: Scenario = {
      id: 'S1',
      title: 'Mirpur cashier voids after KOT on cash orders at ~6× baseline',
      status: 'planted',
      available_from_phase: 0,
      detected_in_phase: 2,
      org: kacchi.key,
      branch: 'mirpur',
      facts: {
        staff: 'rafiq',
        staff_orders: rafiq.orders,
        staff_void_count: rafiq.voidCount,
        staff_void_value_poisha: rafiq.voidValue,
        peer_orders: s1Peers.orders,
        peer_void_count: s1Peers.voidCount,
        peer_void_value_poisha: s1Peers.voidValue,
        void_rate_ratio_x100: rateRatioX100(
          rafiq.voidCount,
          rafiq.orders,
          s1Peers.voidCount,
          s1Peers.orders,
        ),
        excess_void_value_poisha: excessOverBaseline(
          rafiq.voidValue,
          rafiq.orders,
          s1Peers.voidValue,
          s1Peers.orders,
        ),
      },
    };

    // S2 — Uttara manager discounts on Thursdays.
    const habib = staffOf(kacchi, 'uttara', 'habib');
    const s2Peers = peersOf(kacchi, 'uttara', 'habib');
    const s2: Scenario = {
      id: 'S2',
      title: 'Uttara manager gives ~3× normal discounts on Thursdays',
      status: 'planted',
      available_from_phase: 0,
      detected_in_phase: 2,
      org: kacchi.key,
      branch: 'uttara',
      facts: {
        staff: 'habib',
        weekday: 'thursday',
        staff_orders: habib.orders,
        staff_discount_count: habib.discountCount,
        staff_discount_poisha: habib.discountPoisha,
        staff_discounts_without_reason: habib.discountNoReason,
        peer_orders: s2Peers.orders,
        peer_discount_count: s2Peers.discountCount,
        peer_discount_poisha: s2Peers.discountPoisha,
        peer_discounts_without_reason: s2Peers.discountNoReason,
        discount_rate_ratio_x100: rateRatioX100(
          habib.discountCount,
          habib.orders,
          s2Peers.discountCount,
          s2Peers.orders,
        ),
        excess_discount_poisha: excessOverBaseline(
          habib.discountPoisha,
          habib.orders,
          s2Peers.discountPoisha,
          s2Peers.orders,
        ),
      },
    };

    // S3 — foodpanda commission drag. The negative-margin half needs recipe costs (Phase 3).
    const fp = kacchi.channels.find((c) => c.key === 'foodpanda')!;
    const combo = kacchi.menu.find((m) => m.key === 'family_combo')!;
    const comboNet = computeLine(
      { unitPricePoisha: combo.pricePoisha, quantity: 1 },
      {
        priceIncludesVat: kacchi.priceIncludesVat,
        vatRateBps: kacchi.vatRateBps,
        serviceChargeBps: 0,
        vatOnServiceCharge: false,
      },
    ).netPoisha;
    const perBranch: Record<string, unknown> = {};
    for (const b of kacchi.branches) {
      const ch = this.branch(kacchi.key, b.key).byChannel.get('foodpanda') ?? {
        orders: 0,
        net_poisha: 0,
      };
      const units = this.comboUnits.get(`${kacchi.key}/${b.key}`) ?? { foodpanda: 0, total: 0 };
      perBranch[b.key] = {
        foodpanda_orders: ch.orders,
        foodpanda_net_poisha: ch.net_poisha,
        foodpanda_commission_poisha: mulBps(ch.net_poisha, fp.commissionBps),
        combo_units_via_foodpanda: units.foodpanda,
        combo_units_total: units.total,
      };
    }
    const s3: Scenario = {
      id: 'S3',
      title: 'A delivery combo is negative-margin after foodpanda commission',
      status: 'planted',
      available_from_phase: 0,
      detected_in_phase: 2,
      org: kacchi.key,
      facts: {
        combo_key: 'family_combo',
        combo_printed_price_poisha: combo.pricePoisha,
        combo_net_unit_poisha: comboNet,
        foodpanda_commission_bps: fp.commissionBps,
        combo_commission_per_unit_poisha: mulBps(comboNet, fp.commissionBps),
        branches: perBranch,
        // Phase 3: with its recipe cost, the combo loses money on foodpanda (commission rounded once per period).
        full_margin: {
          combo_unit_cost_poisha: unitCostOn(kacchi.key, 'family_combo', FIRST_DATE),
          branches: Object.fromEntries(
            kacchi.branches.map((b) => {
              const a = this.comboFoodpanda.get(b.key) ?? emptyCost();
              const commission = mulBps(a.net, fp.commissionBps);
              return [
                b.key,
                {
                  units: a.qty,
                  net_poisha: a.net,
                  cost_poisha: a.cost,
                  commission_poisha: commission,
                  loss_poisha: a.cost + commission - a.net,
                },
              ];
            }),
          ),
        },
      },
      note: 'Commission drag is detectable in Phase 2; with recipe costs (Phase 3) the combo is negative-margin on foodpanda.',
    };

    // S4 — the beef spike pushes Beef Tehari above the food-cost target.
    const target = COSTING[kacchi.key]!.targetFoodCostBps;
    const window = (a: CostAcc) => ({
      units: a.qty,
      net_poisha: a.net,
      cost_poisha: a.cost,
      food_cost_bps: a.net > 0 ? Math.round((a.cost * 10000) / a.net) : 0,
      excess_over_target_poisha: a.cost - mulBps(a.net, target),
    });
    const s4: Scenario = {
      id: 'S4',
      title: 'Beef price spike (week 20) pushes Beef Tehari below target margin',
      status: 'planted',
      available_from_phase: 3,
      detected_in_phase: 3,
      org: kacchi.key,
      facts: {
        item_key: 'tehari',
        ingredient_key: 'beef',
        spike_from: BEEF_SPIKE_FROM,
        spike_to: BEEF_SPIKE_TO,
        target_food_cost_bps: target,
        unit_cost_before_poisha: unitCostOn(kacchi.key, 'tehari', addDays(BEEF_SPIKE_FROM, -1)),
        unit_cost_during_poisha: unitCostOn(kacchi.key, 'tehari', BEEF_SPIKE_FROM),
        branches: Object.fromEntries(
          kacchi.branches.map((b) => [
            b.key,
            {
              before: window(this.tehari.get(`${b.key}/before`) ?? emptyCost()),
              spike: window(this.tehari.get(`${b.key}/spike`) ?? emptyCost()),
            },
          ]),
        ),
      },
      note: 'Detected by margin.below_target over the spike window; the 28 days before it stay quiet.',
    };

    // S5 — the menu engineering matrix over the whole year, all branches (Kasavana–Smith, METRICS.md).
    const sold = kacchi.menu
      .map((m) => ({ key: m.key, ...(this.items.get(`${kacchi.key}/${m.key}`) ?? emptyCost()) }))
      .filter((i) => i.qty > 0);
    const n = sold.length;
    const units = sold.reduce((s, i) => s + i.qty, 0);
    const cmAll = sold.reduce((s, i) => s + (i.net - i.cost), 0);
    const matrix = Object.fromEntries(
      sold.map((i) => {
        const popular = i.qty * n * 10 >= 7 * units;
        // cm per unit ≥ weighted average, compared without dividing: (net − cost) × units ≥ cmAll × qty.
        const profitable = (i.net - i.cost) * units >= cmAll * i.qty;
        return [
          i.key,
          popular ? (profitable ? 'star' : 'plowhorse') : profitable ? 'puzzle' : 'dog',
        ];
      }),
    );
    const s5: Scenario = {
      id: 'S5',
      title: 'One Dog and one Puzzle item on the menu (Shahi Tukra, Kala Bhuna)',
      status: 'planted',
      available_from_phase: 3,
      detected_in_phase: 3,
      org: kacchi.key,
      facts: {
        dog: 'shahi_tukra',
        puzzle: 'kala_bhuna',
        items_sold: n,
        units_sold: units,
        matrix,
      },
      note: 'Classes over the whole seeded year, all branches. Every demo item has a recipe.',
    };

    // S13 — the clean control.
    const cafeBranch = cafe.branches[0]!;
    let orders = 0,
      voids = 0,
      discounts = 0,
      voidValue = 0,
      discountPoisha = 0;
    for (const s of cafeBranch.staff) {
      const a = this.staffAcc(ids.staff(cafe, cafeBranch, s));
      orders += a.orders;
      voids += a.voidCount;
      discounts += a.discountCount;
      voidValue += a.voidValue;
      discountPoisha += a.discountPoisha;
    }
    const s13: Scenario = {
      id: 'S13',
      title: 'Demo Café is clean (false-positive control)',
      status: 'planted',
      available_from_phase: 0,
      detected_in_phase: 2,
      org: cafe.key,
      facts: {
        planted_anomalies: 0,
        orders,
        void_after_kot_count: voids,
        void_value_poisha: voidValue,
        discount_count: discounts,
        discount_poisha: discountPoisha,
      },
      note: 'Only baseline noise. Detectors must raise at most one finding per branch-week here.',
    };
    return [s1, s2, s3, s4, s5, s13];
  }
}
