/**
 * The demo orgs' stock ledger (ROADMAP Phase 5–6 test oracle). Fixture data only.
 *
 * For the last twelve weeks it simulates each branch's *physical* stock day by day — what the kitchen
 * really used, threw away and moved — and writes only what people record: purchases, waste they
 * bothered to log, recorded transfers and a closing count every Sunday. The difference between the two
 * is exactly the planted leaks, so the Phase 5–6 variance maths must find them:
 *
 *   S6 — 4 kg of chicken leaves Dhanmondi for Mirpur every Tuesday and Saturday, never recorded:
 *        Dhanmondi's chicken usage looks too high, Mirpur's too low (phantom variance).
 *   S7 — Mirpur's kitchen puts 12% more mutton into every kacchi than the recipe says.
 *   S8 — Dhanmondi's purchaser pays 9–12% over the market for beef on about a third of days.
 *   S9 — Uttara throws away about 4 kg of cooked rice a day and never logs it.
 *
 * Normal kitchens are not perfect either: every branch loses 1% of what it uses (trimming, tasting,
 * spills), voided dishes that were already cooked still used their ingredients, and Mirpur never logs
 * waste on Fridays and Saturdays. Onion costs every branch 15% more for two weeks in August (a market
 * move, not a leak). Uttara misses the count on 13 September. The café has only the normal 1%.
 *
 * Everything here uses its own random streams, so the order data stays byte-identical.
 */
import { addDays, weekday } from '../../src/lib/time/business-date';
import { ANCHOR_DATE, type BranchCfg, type OrgCfg } from './config';
import { COSTING, priceOn } from './costing';
import { ids, type DayRows, type Row } from './generate';
import type { BranchInventory, InventoryFacts, Scenario } from './manifest';
import { detId, makeRng } from './rng';

/** A Sunday: the first (full) count, twelve weeks before the last Sunday count. */
export const INVENTORY_FROM = '2026-06-28';
export const COUNT_WEEKDAY = 0;
/** Phase 6's detection window: four weeks between two Sunday counts every branch did. */
export const PERIOD_FROM = '2026-08-23';
export const PERIOD_TO = '2026-09-20';
export const DISCIPLINE_FROM = addDays(ANCHOR_DATE, -14);
export const DISCIPLINE_TO = addDays(ANCHOR_DATE, -1);

export const NORMAL_LOSS_BPS = 100;
export const S6 = {
  from: 'dhanmondi',
  to: 'mirpur',
  ing: 'chicken',
  grams: 4000,
  weekdays: [2, 6],
};
export const S7 = { branch: 'mirpur', ing: 'mutton', extraBps: 1200 };
export const S8 = { branch: 'dhanmondi', ing: 'beef', chance: 0.35, minBps: 900, maxBps: 1200 };
export const S9 = { branch: 'uttara', ing: 'rice', grams: 4000 };
export const MISSED_COUNT = { branch: 'uttara', date: '2026-09-13' };
export const NO_WASTE_LOG = { branch: 'mirpur', weekdays: [5, 6] };
export const RECORDED_TRANSFER = {
  from: 'dhanmondi',
  to: 'uttara',
  ing: 'spices',
  grams: 2000,
  weekday: 3,
};
/** The last recorded transfer before the anchor is sent but not yet confirmed by Uttara. */
export const UNRECEIVED_TRANSFER_ON = '2026-09-16';
export const ONION_MARKET = { from: '2026-08-10', to: '2026-08-23', pct: 115 };

interface Supply {
  supplier: string;
  /** Bought every morning (up to two days' need) or when below four days (up to ten). */
  daily: boolean;
  /** Purchase pack in base units. */
  pack: number;
}

interface OrgInventory {
  suppliers: string[];
  supply: Record<string, Supply>;
}

const g = (supplier: string, daily: boolean, pack = 1000): Supply => ({ supplier, daily, pack });

export const INVENTORY: Record<string, OrgInventory> = {
  demo_kacchi_house: {
    suppliers: [
      'Kaptan Bazar Meat',
      'Karwan Bazar Kacha Bazar',
      'Chinigura Rice Traders',
      'Meena Wholesale',
    ],
    supply: {
      mutton: g('Kaptan Bazar Meat', true),
      beef: g('Kaptan Bazar Meat', true),
      chicken: g('Kaptan Bazar Meat', true),
      egg: g('Kaptan Bazar Meat', true, 30),
      potato: g('Karwan Bazar Kacha Bazar', true),
      onion: g('Karwan Bazar Kacha Bazar', true),
      cucumber: g('Karwan Bazar Kacha Bazar', true),
      mint: g('Karwan Bazar Kacha Bazar', true),
      yogurt: g('Karwan Bazar Kacha Bazar', true),
      milk: g('Karwan Bazar Kacha Bazar', true),
      bread: g('Meena Wholesale', true, 20),
      rice: g('Chinigura Rice Traders', false),
      oil: g('Meena Wholesale', false),
      ghee: g('Meena Wholesale', false),
      spices: g('Meena Wholesale', false),
      sugar: g('Meena Wholesale', false),
      nuts: g('Meena Wholesale', false),
      soft: g('Meena Wholesale', false, 24),
      water: g('Meena Wholesale', false, 24),
    },
  },
  demo_cafe: {
    suppliers: ['Gulshan Dairy', 'Bean Roasters', 'Gulshan Kacha Bazar', 'Unimart Wholesale'],
    supply: {
      milk: g('Gulshan Dairy', true),
      cream: g('Gulshan Dairy', true),
      egg: g('Gulshan Dairy', true, 30),
      chicken: g('Gulshan Kacha Bazar', true),
      lettuce: g('Gulshan Kacha Bazar', true),
      potato: g('Gulshan Kacha Bazar', true),
      bread: g('Unimart Wholesale', true, 20),
      beans: g('Bean Roasters', false),
      tea: g('Bean Roasters', false),
      icecream: g('Gulshan Dairy', false),
      butter: g('Gulshan Dairy', false),
      cheese: g('Gulshan Dairy', false),
      lemon: g('Gulshan Kacha Bazar', false, 12),
      sugar: g('Unimart Wholesale', false),
      mayo: g('Unimart Wholesale', false),
      pasta: g('Unimart Wholesale', false),
      oil: g('Unimart Wholesale', false),
      flour: g('Unimart Wholesale', false),
      chocolate: g('Unimart Wholesale', false),
      biscuit: g('Unimart Wholesale', false),
    },
  },
};

/** Days-of-cover bands for ingredients bought every day: one day's stock is healthy for fresh meat. */
export const DAILY_COVER = { green: 1, red: 0.5 };

export const invIds = {
  supplier: (org: OrgCfg, name: string) => detId('supplier', org.key, name),
  ingredient: (org: OrgCfg, key: string) => detId('ingredient', org.key, key),
};

type Qty = Map<string, number>;
const add = (m: Qty, k: string, v: number) => {
  if (v !== 0) m.set(k, (m.get(k) ?? 0) + v);
};

/** What people recorded for one branch on one day, per ingredient: the observable side. */
interface DayObs {
  purchaseQty: Qty;
  purchasePoisha: Qty;
  tIn: Qty;
  tOut: Qty;
  usage: Qty;
  waste: Qty;
  count: Qty | null;
  wasteLogged: boolean;
  bought: boolean;
  cashClosed: boolean;
}

/** What really happened on top of the recorded usage, for the scenario facts. */
interface DayTruth {
  s6Moved: number;
  s7Extra: number;
  s8Overpaid: number;
  s8Days: { date: string; qty: number; paid: number; standard: number; bps: number }[];
  s9Wasted: number;
  normalLoss: Qty;
  voidUse: Qty;
  unloggedWaste: Qty;
}

const emptyObs = (): DayObs => ({
  purchaseQty: new Map(),
  purchasePoisha: new Map(),
  tIn: new Map(),
  tOut: new Map(),
  usage: new Map(),
  waste: new Map(),
  count: null,
  wasteLogged: false,
  bought: false,
  cashClosed: false,
});

const dhaka = (date: string, time: string) => new Date(`${date}T${time}:00+06:00`).toISOString();

/** Round half away from zero, the rule SQL's numeric round() uses. */
export function roundHalfAway(num: number, den: number): number {
  const sign = Math.sign(num) * Math.sign(den);
  const a = Math.abs(num);
  const b = Math.abs(den);
  return sign * Math.floor((2 * a + b) / (2 * b));
}

export class Inventory {
  /** Physical stock per org → branch → ingredient. */
  private physical = new Map<string, Map<string, Qty>>();
  /** Goods that left one branch today and arrive at another today (recorded or not). */
  private arriving = new Map<string, Qty>();
  private obs = new Map<string, Map<string, DayObs>>();
  private truth = new Map<string, Map<string, DayTruth>>();
  private gross = new Map<string, Map<string, Map<string, number>>>();

  /** Bought quantity of each ingredient in one portion of each item (recipe qty ÷ yield). */
  private recipeGross(org: OrgCfg): Map<string, Map<string, number>> {
    let m = this.gross.get(org.key);
    if (m) return m;
    m = new Map();
    for (const [item, lines] of Object.entries(COSTING[org.key]!.recipes)) {
      const per = new Map<string, number>();
      for (const l of lines) add(per, l.ing, (l.qty * 100) / (l.yieldPct ?? 100));
      m.set(item, per);
    }
    this.gross.set(org.key, m);
    return m;
  }

  private stock(org: OrgCfg, b: BranchCfg): Qty {
    let o = this.physical.get(org.key);
    if (!o) this.physical.set(org.key, (o = new Map()));
    let s = o.get(b.key);
    if (!s) o.set(b.key, (s = new Map()));
    return s;
  }

  private key = (org: OrgCfg, b: BranchCfg | string) =>
    `${org.key}/${typeof b === 'string' ? b : b.key}`;

  private record<T>(map: Map<string, Map<string, T>>, k: string, date: string, v: T) {
    let m = map.get(k);
    if (!m) map.set(k, (m = new Map()));
    m.set(date, v);
  }

  /** Append the day's stock rows to `rows` and remember what was recorded and what really happened. */
  day(org: OrgCfg, b: BranchCfg, date: string, rows: DayRows): void {
    const inv = INVENTORY[org.key];
    if (!inv || date < INVENTORY_FROM) return;
    const orgId = ids.org(org);
    const branchId = ids.branch(org, b);
    const gross = this.recipeGross(org);
    const itemKey = new Map(org.menu.map((m) => [ids.item(org, m), m.key]));
    const completed = new Set(
      rows.orders.filter((o) => o.order_status === 'completed').map((o) => String(o.id)),
    );
    const obs = emptyObs();
    const truth: DayTruth = {
      s6Moved: 0,
      s7Extra: 0,
      s8Overpaid: 0,
      s8Days: [],
      s9Wasted: 0,
      normalLoss: new Map(),
      voidUse: new Map(),
      unloggedWaste: new Map(),
    };
    const k = this.key(org, b);
    const phys = this.stock(org, b);

    // Recorded (theoretical) usage from sold lines; voided lines were cooked before they were voided.
    for (const l of rows.order_items) {
      const item = itemKey.get(String(l.menu_item_id));
      const per = item ? gross.get(item) : undefined;
      if (!per) continue;
      const qty = Number(l.quantity);
      const sold = l.status === 'active' && completed.has(String(l.order_id));
      for (const [ing, q] of per) add(sold ? obs.usage : truth.voidUse, ing, qty * q);
    }
    obs.cashClosed = rows.shifts.length > 0 && rows.shifts.every((s) => s.status === 'closed');

    if (date === INVENTORY_FROM) {
      // Opening stock: a day's worth of fresh goods, a week of dry goods; the first count is a full one.
      for (const ing of Object.keys(inv.supply)) {
        const use = obs.usage.get(ing) ?? 0;
        phys.set(ing, inv.supply[ing]!.daily ? use : 7 * use);
      }
      obs.usage = new Map();
      this.count(org, b, date, 'full', rows, obs);
      this.record(this.obs, k, date, obs);
      this.record(this.truth, k, date, truth);
      return;
    }

    const rng = makeRng('inventory', org.key, b.key, date);
    const dow = weekday(date);
    const physUse = new Map(obs.usage);
    for (const [ing, q] of truth.voidUse) add(physUse, ing, q);
    for (const [ing, q] of obs.usage) {
      const loss = Math.round((q * NORMAL_LOSS_BPS) / 10000);
      add(truth.normalLoss, ing, loss);
      add(physUse, ing, loss);
    }
    if (org.key === 'demo_kacchi_house' && b.key === S7.branch) {
      truth.s7Extra = Math.round(((obs.usage.get(S7.ing) ?? 0) * S7.extraBps) / 10000);
      add(physUse, S7.ing, truth.s7Extra);
    }
    if (
      org.key === 'demo_kacchi_house' &&
      b.key === S9.branch &&
      (obs.usage.get(S9.ing) ?? 0) > 0
    ) {
      truth.s9Wasted = S9.grams;
      add(physUse, S9.ing, S9.grams);
    }

    // Waste that happened today; logged unless it is Mirpur's weekend.
    const logs = org.key === 'demo_kacchi_house' ? kacchiWaste(rng) : cafeWaste(rng);
    const logging = !(
      org.key === 'demo_kacchi_house' &&
      b.key === NO_WASTE_LOG.branch &&
      NO_WASTE_LOG.weekdays.includes(dow)
    );
    const manager = b.staff.find((s) => s.role === 'manager')!;
    logs.forEach((w, i) => {
      const used = new Map<string, number>();
      if (w.ing) add(used, w.ing, w.qty);
      else for (const [ing, q] of gross.get(w.item!)!) add(used, ing, q * w.qty);
      for (const [ing, q] of used) {
        add(physUse, ing, q);
        add(logging ? obs.waste : truth.unloggedWaste, ing, q);
      }
      if (!logging) return;
      obs.wasteLogged = true;
      rows.waste_logs.push({
        id: detId('waste', org.key, b.key, date, i),
        org_id: orgId,
        branch_id: branchId,
        ingredient_id: w.ing ? invIds.ingredient(org, w.ing) : null,
        menu_item_id: w.item
          ? ids.item(
              org,
              org.menu.find((m) => m.key === w.item)!,
            )
          : null,
        qty_base: w.ing ? w.qty : null,
        qty_portions: w.item ? w.qty : null,
        reason_code_id: ids.reason(org, 'waste', w.reason),
        source: w.item ? 'kds' : 'mobile',
        logged_by_staff_id: ids.staff(org, b, manager),
        logged_at: dhaka(date, '21:30'),
        business_date: date,
      });
    });

    // Goods leaving today: the recorded Wednesday spices and S6's unrecorded chicken.
    const out = new Map<string, number>();
    if (
      org.key === 'demo_kacchi_house' &&
      b.key === RECORDED_TRANSFER.from &&
      dow === RECORDED_TRANSFER.weekday
    ) {
      const { ing, grams, to } = RECORDED_TRANSFER;
      add(out, ing, grams);
      add(obs.tOut, ing, grams);
      this.arrive(org, to, ing, grams);
      const received = date !== UNRECEIVED_TRANSFER_ON;
      const transferId = detId('transfer', org.key, b.key, date);
      const toBranch = org.branches.find((x) => x.key === to)!;
      rows.transfers.push({
        id: transferId,
        org_id: orgId,
        from_branch_id: branchId,
        to_branch_id: ids.branch(org, toBranch),
        status: received ? 'received' : 'sent',
        sent_at: dhaka(date, '10:00'),
        sent_on: date,
        received_at: received ? dhaka(date, '15:00') : null,
        received_on: received ? date : null,
      });
      rows.transfer_lines.push({
        id: detId('transfer-line', org.key, b.key, date),
        org_id: orgId,
        transfer_id: transferId,
        ingredient_id: invIds.ingredient(org, ing),
        qty_base_sent: grams,
        qty_base_received: received ? grams : null,
      });
      if (received) this.pendingReceipt.set(`${org.key}/${to}/${date}`, { ing, grams });
    }
    if (org.key === 'demo_kacchi_house' && b.key === S6.from && S6.weekdays.includes(dow)) {
      add(out, S6.ing, S6.grams);
      truth.s6Moved = S6.grams;
      this.arrive(org, S6.to, S6.ing, S6.grams);
    }
    // Goods arriving today (other branches were simulated earlier the same day).
    const arriving = this.arriving.get(`${this.key(org, b)}`);
    if (arriving) {
      for (const [ing, q] of arriving) add(phys, ing, q);
      this.arriving.delete(this.key(org, b));
    }
    const receipt = this.pendingReceipt.get(`${org.key}/${b.key}/${date}`);
    if (receipt) {
      add(obs.tIn, receipt.ing, receipt.grams);
      this.pendingReceipt.delete(`${org.key}/${b.key}/${date}`);
    }

    // Morning bazar: buy up to what today needs (fresh) or restock dry goods running low.
    const need = new Map(physUse);
    for (const [ing, q] of out) add(need, ing, q);
    const bySupplier = new Map<string, Row[]>();
    for (const ing of Object.keys(inv.supply)) {
      const s = inv.supply[ing]!;
      const d = need.get(ing) ?? 0;
      const have = phys.get(ing) ?? 0;
      let buy = 0;
      if (d > 0 && s.daily && have < 2 * d) buy = Math.ceil((2 * d - have) / s.pack) * s.pack;
      if (d > 0 && !s.daily && have < 4 * d) buy = Math.ceil((10 * d - have) / s.pack) * s.pack;
      if (buy === 0) continue;
      const standard = buy * priceOn(org.key, ing, date);
      let paid = standard;
      if (
        org.key === 'demo_kacchi_house' &&
        ing === 'onion' &&
        date >= ONION_MARKET.from &&
        date <= ONION_MARKET.to
      ) {
        paid = (standard * ONION_MARKET.pct) / 100;
      }
      if (org.key === 'demo_kacchi_house' && b.key === S8.branch && ing === S8.ing) {
        const r = makeRng('s8', org.key, b.key, date);
        if (r.chance(S8.chance)) {
          const bps = r.int(S8.minBps, S8.maxBps);
          const perKg = Math.round((priceOn(org.key, ing, date) * 1000 * (10000 + bps)) / 10000);
          paid = (buy / 1000) * perKg;
          truth.s8Overpaid += paid - standard;
          truth.s8Days.push({ date, qty: buy, paid, standard, bps });
        }
      }
      if (!Number.isInteger(paid))
        throw new Error(`${org.key}/${ing}: a non-integer purchase price`);
      add(phys, ing, buy);
      add(obs.purchaseQty, ing, buy);
      add(obs.purchasePoisha, ing, paid);
      const purchaseId = detId('purchase', org.key, b.key, date, s.supplier);
      const lines = bySupplier.get(s.supplier) ?? [];
      lines.push({
        id: detId('purchase-line', org.key, b.key, date, ing),
        org_id: orgId,
        branch_id: branchId,
        purchase_id: purchaseId,
        ingredient_id: invIds.ingredient(org, ing),
        qty_base: buy,
        line_total_poisha: paid,
      });
      bySupplier.set(s.supplier, lines);
    }
    for (const [supplier, lines] of bySupplier) {
      obs.bought = true;
      rows.purchases.push({
        id: String(lines[0]!.purchase_id),
        org_id: orgId,
        branch_id: branchId,
        supplier_id: invIds.supplier(org, supplier),
        purchased_on: date,
        source: 'form',
        status: 'confirmed',
        total_poisha: lines.reduce((sum, l) => sum + Number(l.line_total_poisha), 0),
        confirmed_at: dhaka(date, '09:00'),
      });
      rows.purchase_lines.push(...lines);
    }

    // The day's physical consumption.
    for (const [ing, q] of need) {
      add(phys, ing, -q);
      if ((phys.get(ing) ?? 0) < 0) throw new Error(`${k}/${ing} ran out on ${date}`);
    }

    if (
      dow === COUNT_WEEKDAY &&
      !(
        org.key === 'demo_kacchi_house' &&
        b.key === MISSED_COUNT.branch &&
        date === MISSED_COUNT.date
      )
    ) {
      this.count(org, b, date, 'guided_weekly', rows, obs);
    }
    this.record(this.obs, k, date, obs);
    this.record(this.truth, k, date, truth);
  }

  private pendingReceipt = new Map<string, { ing: string; grams: number }>();

  private arrive(org: OrgCfg, toBranch: string, ing: string, qty: number) {
    const k = this.key(org, toBranch);
    const m = this.arriving.get(k) ?? new Map<string, number>();
    add(m, ing, qty);
    this.arriving.set(k, m);
  }

  private count(org: OrgCfg, b: BranchCfg, date: string, kind: string, rows: DayRows, obs: DayObs) {
    const phys = this.stock(org, b);
    const countId = detId('count', org.key, b.key, date);
    rows.stock_counts.push({
      id: countId,
      org_id: ids.org(org),
      branch_id: ids.branch(org, b),
      counted_on: date,
      kind,
      status: 'submitted',
      submitted_at: dhaka(date, '23:50'),
    });
    obs.count = new Map();
    for (const ing of Object.keys(INVENTORY[org.key]!.supply)) {
      const qty = phys.get(ing) ?? 0;
      obs.count.set(ing, qty);
      rows.stock_count_lines.push({
        id: detId('count-line', org.key, b.key, date, ing),
        org_id: ids.org(org),
        branch_id: ids.branch(org, b),
        stock_count_id: countId,
        ingredient_id: invIds.ingredient(org, ing),
        counted_qty_base: qty,
      });
    }
  }

  // ---- Ground truth ------------------------------------------------------------------------------

  private days(org: OrgCfg, b: BranchCfg): Map<string, DayObs> {
    return this.obs.get(this.key(org, b)) ?? new Map();
  }

  private lastCount(org: OrgCfg, b: BranchCfg, onOrBefore: string): string | null {
    let best: string | null = null;
    for (const [date, o] of this.days(org, b))
      if (o.count && date <= onOrBefore && (!best || date > best)) best = date;
    return best;
  }

  private sum(
    org: OrgCfg,
    b: BranchCfg,
    from: string,
    to: string,
    pick: (o: DayObs) => Qty,
    ing: string,
  ): number {
    let s = 0;
    for (const [date, o] of this.days(org, b))
      if (date > from && date <= to) s += pick(o).get(ing) ?? 0;
    return s;
  }

  private truthSum(
    org: OrgCfg,
    b: string,
    from: string,
    to: string,
    pick: (t: DayTruth) => number,
  ): number {
    let s = 0;
    for (const [date, t] of this.truth.get(this.key(org, b)) ?? new Map<string, DayTruth>())
      if (date > from && date <= to) s += pick(t);
    return s;
  }

  facts(orgs: readonly OrgCfg[]): InventoryFacts {
    const out: InventoryFacts = {
      from: INVENTORY_FROM,
      count_weekday: COUNT_WEEKDAY,
      period: { from: PERIOD_FROM, to: PERIOD_TO },
      orgs: {},
    };
    for (const org of orgs) {
      const inv = INVENTORY[org.key];
      if (!inv) continue;
      const branches: InventoryFacts['orgs'][string]['branches'] = {};
      for (const b of org.branches) {
        const stock: BranchInventory['stock'] = {};
        const variance: BranchInventory['variance'] = {};
        const last = this.lastCount(org, b, ANCHOR_DATE)!;
        const lastObs = this.days(org, b).get(last)!;
        for (const [ing, s] of Object.entries(inv.supply)) {
          const moves = (pick: (o: DayObs) => Qty) =>
            this.sum(org, b, last, ANCHOR_DATE, pick, ing);
          const stockQty =
            lastObs.count!.get(ing)! +
            moves((o) => o.purchaseQty) +
            moves((o) => o.tIn) -
            moves((o) => o.tOut) -
            moves((o) => o.usage) -
            moves((o) => o.waste);
          const use14 = this.sum(
            org,
            b,
            addDays(ANCHOR_DATE, -14),
            ANCHOR_DATE,
            (o) => o.usage,
            ing,
          );
          const inTransit =
            org.key === 'demo_kacchi_house' &&
            b.key === RECORDED_TRANSFER.to &&
            ing === RECORDED_TRANSFER.ing
              ? RECORDED_TRANSFER.grams
              : 0;
          const green = s.daily ? DAILY_COVER.green : 7;
          const red = s.daily ? DAILY_COVER.red : 3;
          stock[ing] = {
            last_count_date: last,
            stock_qty: stockQty,
            in_transit_qty: inTransit,
            usage_14d_qty: use14,
            days_of_cover_x100: use14 > 0 ? roundHalfAway(stockQty * 1400, use14) : null,
            band:
              use14 <= 0
                ? 'none'
                : stockQty * 14 >= green * use14
                  ? 'green'
                  : stockQty * 14 < red * use14
                    ? 'red'
                    : 'yellow',
          };

          const open = this.days(org, b).get(PERIOD_FROM)!.count!.get(ing)!;
          const close = this.days(org, b).get(PERIOD_TO)!.count!.get(ing)!;
          const p = (pick: (o: DayObs) => Qty) =>
            this.sum(org, b, PERIOD_FROM, PERIOD_TO, pick, ing);
          const actual =
            open + p((o) => o.purchaseQty) + p((o) => o.tIn) - p((o) => o.tOut) - close;
          variance[ing] = {
            opening_qty: open,
            closing_qty: close,
            purchases_qty: p((o) => o.purchaseQty),
            purchases_poisha: p((o) => o.purchasePoisha),
            transfers_in_qty: p((o) => o.tIn),
            transfers_out_qty: p((o) => o.tOut),
            usage_theoretical_qty: p((o) => o.usage),
            waste_qty: p((o) => o.waste),
            usage_actual_qty: actual,
            variance_qty: actual - p((o) => o.usage) - p((o) => o.waste),
          };
        }
        const discipline: Record<string, number> = {};
        for (let d = DISCIPLINE_FROM; d <= DISCIPLINE_TO; d = addDays(d, 1)) {
          const o = this.days(org, b).get(d)!;
          const due = weekday(d) === COUNT_WEEKDAY;
          discipline[d] =
            (o.bought ? 25 : 0) +
            (o.wasteLogged ? 15 : 0) +
            (o.cashClosed ? 20 : 0) +
            (!due || o.count ? 25 : 0) +
            15; // every demo item has a costed recipe
        }
        branches[b.key] = { stock, variance, discipline };
      }
      out.orgs[org.key] = { branches };
    }
    return out;
  }

  scenarios(orgs: readonly OrgCfg[]): Scenario[] {
    const kacchi = orgs.find((o) => o.key === 'demo_kacchi_house')!;
    const period = { period_from: PERIOD_FROM, period_to: PERIOD_TO };
    const facts = this.facts([kacchi]).orgs[kacchi.key]!.branches;
    const t = (b: string, pick: (x: DayTruth) => number) =>
      this.truthSum(kacchi, b, PERIOD_FROM, PERIOD_TO, pick);
    const tq = (b: string, pick: (x: DayTruth) => Qty, ing: string) =>
      t(b, (x) => pick(x).get(ing) ?? 0);
    const cost = (ing: string) => priceOn(kacchi.key, ing, PERIOD_TO);
    const s8Days = [
      ...(this.truth.get(this.key(kacchi, S8.branch)) ?? new Map<string, DayTruth>()).entries(),
    ]
      .filter(([d]) => d > PERIOD_FROM && d <= PERIOD_TO)
      .flatMap(([, x]) => x.s8Days);
    return [
      {
        id: 'S6',
        title: 'Unrecorded chicken transfers Dhanmondi → Mirpur twice a week',
        status: 'planted',
        available_from_phase: 5,
        detected_in_phase: 6,
        org: kacchi.key,
        facts: {
          ...period,
          ingredient_key: S6.ing,
          from_branch: S6.from,
          to_branch: S6.to,
          moved_qty: t(S6.from, (x) => x.s6Moved),
          unit_cost_poisha_per_base: cost(S6.ing),
          moved_value_poisha: t(S6.from, (x) => x.s6Moved) * cost(S6.ing),
          from_variance_qty: facts[S6.from]!.variance[S6.ing]!.variance_qty,
          to_variance_qty: facts[S6.to]!.variance[S6.ing]!.variance_qty,
        },
        note: 'Visible from Phase 5 as mirrored chicken variance; Phase 6 names it a suspected unrecorded transfer.',
      },
      {
        id: 'S7',
        title: 'Mirpur over-portions kacchi mutton by ~12%',
        status: 'planted',
        available_from_phase: 5,
        detected_in_phase: 6,
        org: kacchi.key,
        branch: S7.branch,
        facts: {
          ...period,
          ingredient_key: S7.ing,
          extra_bps: S7.extraBps,
          extra_qty: t(S7.branch, (x) => x.s7Extra),
          extra_value_poisha: t(S7.branch, (x) => x.s7Extra) * cost(S7.ing),
          normal_loss_qty: tq(S7.branch, (x) => x.normalLoss, S7.ing),
          voided_dish_qty: tq(S7.branch, (x) => x.voidUse, S7.ing),
          unlogged_waste_qty: tq(S7.branch, (x) => x.unloggedWaste, S7.ing),
          variance_qty: facts[S7.branch]!.variance[S7.ing]!.variance_qty,
          usage_theoretical_qty: facts[S7.branch]!.variance[S7.ing]!.usage_theoretical_qty,
        },
      },
      {
        id: 'S8',
        title: 'Dhanmondi purchaser pays 9–12% above median for beef on some days',
        status: 'planted',
        available_from_phase: 5,
        detected_in_phase: 6,
        org: kacchi.key,
        branch: S8.branch,
        facts: {
          ...period,
          ingredient_key: S8.ing,
          overpay_days: s8Days.length,
          overpaid_poisha: s8Days.reduce((s, d) => s + d.paid - d.standard, 0),
          days: s8Days,
        },
        note: 'Onion costs every branch 15% more from 10 to 23 August: a market move that must not be flagged.',
      },
      {
        id: 'S9',
        title: 'Uttara unlogged rice waste ≈ 4 kg/day',
        status: 'planted',
        available_from_phase: 5,
        detected_in_phase: 6,
        org: kacchi.key,
        branch: S9.branch,
        facts: {
          ...period,
          ingredient_key: S9.ing,
          wasted_qty: t(S9.branch, (x) => x.s9Wasted),
          wasted_value_poisha: t(S9.branch, (x) => x.s9Wasted) * cost(S9.ing),
          normal_loss_qty: tq(S9.branch, (x) => x.normalLoss, S9.ing),
          voided_dish_qty: tq(S9.branch, (x) => x.voidUse, S9.ing),
          variance_qty: facts[S9.branch]!.variance[S9.ing]!.variance_qty,
          usage_theoretical_qty: facts[S9.branch]!.variance[S9.ing]!.usage_theoretical_qty,
        },
      },
    ];
  }
}

interface WasteEvent {
  ing?: string;
  item?: string;
  qty: number;
  reason: 'spoiled' | 'overcooked' | 'dropped' | 'leftover';
}

function kacchiWaste(rng: ReturnType<typeof makeRng>): WasteEvent[] {
  const out: WasteEvent[] = [{ ing: 'rice', qty: rng.int(3, 8) * 100, reason: 'leftover' }];
  if (rng.chance(0.5)) out.push({ ing: 'onion', qty: rng.int(1, 4) * 100, reason: 'spoiled' });
  if (rng.chance(0.2))
    out.push({
      item: rng.pick(['kacchi_mutton', 'tehari', 'chicken_roast', 'morog_polao']),
      qty: 1,
      reason: 'dropped',
    });
  return out;
}

function cafeWaste(rng: ReturnType<typeof makeRng>): WasteEvent[] {
  const out: WasteEvent[] = [{ ing: 'milk', qty: rng.int(1, 3) * 100, reason: 'spoiled' }];
  if (rng.chance(0.25)) out.push({ item: 'croissant', qty: 1, reason: 'leftover' });
  if (rng.chance(0.15)) out.push({ ing: 'lettuce', qty: rng.int(1, 3) * 100, reason: 'spoiled' });
  return out;
}
