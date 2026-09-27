/**
 * Deterministic generator for the synthetic Dhaka dataset. Pure: no database, no wall clock. The same
 * SEED always yields byte-identical rows, so the manifest (ground truth) can be committed and asserted.
 * Streams one (org, branch, business day) at a time so a year never has to sit in memory.
 */
import {
  computeLine,
  mulBps,
  sumLines,
  type LineAmounts,
  type VatConfig,
} from '../../src/lib/money';
import {
  addDays,
  businessDate,
  businessDayBounds,
  weekday,
} from '../../src/lib/time/business-date';
import {
  ANCHOR_DATE,
  CALENDAR,
  CUTOFF_MINUTES,
  DAYS,
  FIRST_DATE,
  FROZEN_NOW,
  PAYMENT_MIX,
  priceOf,
  RATES,
  WEEKDAY_FACTOR,
  type BranchCfg,
  type ChannelKey,
  type MenuItemCfg,
  type OrgCfg,
  type PaymentMethod,
  type StaffCfg,
} from './config';
import { customerFor, feedbackFor, inSlowSlot } from './customers';
import { detId, makeRng, type Rng } from './rng';

export type Row = Record<string, string | number | boolean | null>;

export interface DayRows {
  shifts: Row[];
  cash_counts: Row[];
  orders: Row[];
  order_items: Row[];
  order_events: Row[];
  payments: Row[];
  discounts: Row[];
  voids: Row[];
  // Phase 8: post-meal feedback and the reviews some of it becomes (scripts/seed/customers.ts).
  feedback: Row[];
  reviews: Row[];
  // Phase 5 stock ledger (scripts/seed/inventory.ts); generateDay leaves these empty.
  purchases: Row[];
  purchase_lines: Row[];
  stock_counts: Row[];
  stock_count_lines: Row[];
  waste_logs: Row[];
  transfers: Row[];
  transfer_lines: Row[];
}

export const emptyDayRows = (): DayRows => ({
  shifts: [],
  cash_counts: [],
  orders: [],
  order_items: [],
  order_events: [],
  payments: [],
  discounts: [],
  voids: [],
  feedback: [],
  reviews: [],
  purchases: [],
  purchase_lines: [],
  stock_counts: [],
  stock_count_lines: [],
  waste_logs: [],
  transfers: [],
  transfer_lines: [],
});

export const REASON_CODES = [
  {
    kind: 'discount',
    code: 'regular_customer',
    label: 'Regular customer',
    label_bn: 'নিয়মিত গ্রাহক',
  },
  { kind: 'discount', code: 'complaint', label: 'Complaint', label_bn: 'অভিযোগ' },
  { kind: 'discount', code: 'staff_meal', label: 'Staff meal', label_bn: 'স্টাফ মিল' },
  { kind: 'discount', code: 'festival', label: 'Festival offer', label_bn: 'উৎসব অফার' },
  { kind: 'void', code: 'wrong_item', label: 'Wrong item', label_bn: 'ভুল আইটেম' },
  {
    kind: 'void',
    code: 'customer_changed_mind',
    label: 'Customer changed mind',
    label_bn: 'গ্রাহক মত বদলেছেন',
  },
  { kind: 'void', code: 'kitchen_delay', label: 'Kitchen delay', label_bn: 'রান্নাঘরে দেরি' },
  { kind: 'waste', code: 'spoiled', label: 'Spoiled / expired', label_bn: 'নষ্ট / মেয়াদোত্তীর্ণ' },
  {
    kind: 'waste',
    code: 'overcooked',
    label: 'Overcooked or burnt',
    label_bn: 'বেশি রান্না বা পুড়ে গেছে',
  },
  {
    kind: 'waste',
    code: 'dropped',
    label: 'Dropped or spilled',
    label_bn: 'পড়ে গেছে বা ছড়িয়ে গেছে',
  },
  {
    kind: 'waste',
    code: 'leftover',
    label: 'Cooked but not sold',
    label_bn: 'রান্না হয়েছে কিন্তু বিক্রি হয়নি',
  },
] as const;

export const ids = {
  org: (org: OrgCfg) => detId('org', org.key),
  branch: (org: OrgCfg, b: BranchCfg) => detId('branch', org.key, b.key),
  staff: (org: OrgCfg, b: BranchCfg, s: StaffCfg) => detId('staff', org.key, b.key, s.key),
  channel: (org: OrgCfg, key: ChannelKey) => detId('channel', org.key, key),
  item: (org: OrgCfg, item: MenuItemCfg) => detId('item', org.key, item.key),
  reason: (org: OrgCfg, kind: string, code: string) => detId('reason', org.key, kind, code),
  shift: (org: OrgCfg, b: BranchCfg, date: string, part: 'am' | 'pm') =>
    detId('shift', org.key, b.key, date, part),
};

const iso = (ms: number) => new Date(ms).toISOString();
const frozenNowMs = Date.parse(FROZEN_NOW);

const EID_CLOSURE = new Set(
  CALENDAR.filter((c) => c.kind === 'eid').flatMap((c) => {
    const out: string[] = [];
    for (let d = c.starts_on as string; d <= c.ends_on; d = addDays(d, 1)) out.push(d);
    return out;
  }),
);
const inRamadan = (d: string) => d >= '2026-02-18' && d <= '2026-03-19';

function hourWeights(org: OrgCfg, date: string): number[] {
  const w = [...org.hourWeights];
  if (!inRamadan(date)) return w;
  for (let h = 0; h < 24; h++) {
    const base = w[h] ?? 0;
    if (org.key === 'demo_kacchi_house') {
      if (h >= 11 && h <= 15) w[h] = base * 0.35;
      else if (h >= 16 && h <= 18)
        w[h] = base * 2.4; // iftar
      else if (h === 19) w[h] = base * 2;
      else if (h >= 20 && h <= 22) w[h] = base * 1.2;
      else if (h >= 1 && h <= 3) w[h] = base * 4; // sehri
    } else if (h >= 9 && h <= 16) {
      w[h] = base * 0.6;
    } else if (h >= 20 && h <= 23) {
      w[h] = base * 1.5;
    }
  }
  return w;
}

const isThursday = (date: string) => weekday(date) === 4;
const isUttaraHabibDay = (org: OrgCfg, b: BranchCfg, date: string) =>
  org.key === 'demo_kacchi_house' && b.key === 'uttara' && isThursday(date);

function vatCfg(org: OrgCfg, dineIn: boolean): VatConfig {
  return {
    priceIncludesVat: org.priceIncludesVat,
    vatRateBps: org.vatRateBps,
    serviceChargeBps: dineIn ? org.serviceChargeBps : 0,
    vatOnServiceCharge: false,
  };
}

function orderCount(org: OrgCfg, b: BranchCfg, date: string, rng: Rng): number {
  if (EID_CLOSURE.has(date)) return 0;
  let mean = b.baseOrders * WEEKDAY_FACTOR[weekday(date)]!;
  const dom = Number(date.slice(8, 10));
  if (dom <= 7) mean *= 1.08; // salary week
  if (date === '2026-04-14') mean *= 1.2; // Pohela Boishakh
  if (EID_CLOSURE.has(addDays(date, -1))) mean *= 1.35; // rebound after Eid
  if (makeRng('rain', org.key, date).chance(0.08)) mean *= 0.97;
  return Math.max(0, Math.round(mean * (0.9 + 0.2 * rng.next())));
}

const LINE_COUNTS = [
  { n: 1, w: 35 },
  { n: 2, w: 35 },
  { n: 3, w: 20 },
  { n: 4, w: 10 },
] as const;

const DISCOUNT_PCTS = [500, 1000, 1000, 1500] as const;

function primaryMethod(channel: ChannelKey, rng: Rng): PaymentMethod {
  if (channel === 'foodpanda' || channel === 'pathao_food') return 'bank'; // platform payout, not till cash
  if (channel === 'own_delivery') return rng.chance(0.7) ? 'cash' : 'bkash';
  return rng.weighted(PAYMENT_MIX, (m) => m.weight).method;
}

interface BuiltLine {
  item: MenuItemCfg;
  quantity: number;
  amounts: LineAmounts;
  voided: boolean;
}

export function generateDay(org: OrgCfg, b: BranchCfg, date: string): DayRows {
  const rows = emptyDayRows();
  const rng = makeRng('day', org.key, b.key, date);
  const n = orderCount(org, b, date, rng);
  if (n === 0) return rows;

  const { start } = businessDayBounds(date, CUTOFF_MINUTES);
  const startMs = start.getTime();
  const weights = hourWeights(org, date);
  const raining = makeRng('rain', org.key, date).chance(0.08);

  // Order instants: pick an hour by weight, then a uniform minute/second; offset from the 04:00 day start.
  const offsets: number[] = [];
  for (let i = 0; i < n; i++) {
    const hour = rng.weighted([...weights.keys()], (h) => weights[h]!);
    const secOfDay = hour * 3600 + rng.int(0, 3599);
    offsets.push((secOfDay - CUTOFF_MINUTES * 60 + 86_400) % 86_400);
  }
  offsets.sort((a, c) => a - c);

  const cashiers = b.staff.filter((s) => s.role === 'cashier');
  const habib = b.staff.find((s) => s.key === 'habib');
  const shiftCashier = (part: 'am' | 'pm'): StaffCfg => {
    const r = makeRng('shift-cashier', org.key, b.key, date, part);
    // S1: Rafiq works about 35% of Mirpur's shifts; everyone else shares the rest equally.
    return r.weighted(cashiers, (s) => (s.key === 'rafiq' ? 0.35 : 0.325));
  };
  const cashierByPart = { am: shiftCashier('am'), pm: shiftCashier('pm') };
  const AM_SECONDS = 11 * 3600; // 04:00 → 15:00 local

  const cashInShift = { am: 0, pm: 0 };
  const shiftUsed = { am: false, pm: false };
  let orderNumber = 0;

  for (const offset of offsets) {
    const placedMs = startMs + offset * 1000;
    if (placedMs > frozenNowMs) continue; // nothing after the frozen "now"
    orderNumber += 1;

    const part: 'am' | 'pm' = offset < AM_SECONDS ? 'am' : 'pm';
    shiftUsed[part] = true;
    const habibTakesIt =
      Boolean(habib) && isUttaraHabibDay(org, b, date) && rng.chance(RATES.s2HabibThursdayShare);
    const staff: StaffCfg = habibTakesIt && habib ? habib : cashierByPart[part];
    const staffId = ids.staff(org, b, staff);

    const channel = rng.weighted(org.channels, (c) => {
      if (!raining) return c.share;
      return c.key === 'dine_in' ? c.share * 0.8 : c.key === 'takeaway' ? c.share : c.share * 1.3;
    }).key;
    const dineIn = channel === 'dine_in';
    const cfg = vatCfg(org, dineIn);
    const orderId = detId('order', org.key, b.key, date, orderNumber);
    const method = primaryMethod(channel, rng);

    // Lines.
    const lineCount = rng.weighted(LINE_COUNTS, (l) => l.w).n;
    const picked = new Map<string, { item: MenuItemCfg; quantity: number }>();
    for (let j = 0; j < lineCount; j++) {
      const item = rng.weighted(org.menu, (m) => {
        if (m.isCombo) return channel === 'foodpanda' ? m.pop * 6 : m.pop * 0.5;
        return m.pop;
      });
      const qty = rng.weighted(
        [
          { q: 1, w: 85 },
          { q: 2, w: 12 },
          { q: 3, w: 3 },
        ],
        (x) => x.w,
      ).q;
      const prev = picked.get(item.key);
      picked.set(item.key, { item, quantity: (prev?.quantity ?? 0) + qty });
    }

    // Void after the kitchen ticket (S1: Rafiq on cash orders).
    const isS1 =
      org.key === 'demo_kacchi_house' &&
      b.key === 'mirpur' &&
      staff.key === 'rafiq' &&
      method === 'cash';
    const voidP = isS1 ? RATES.s1CashVoidAfterKot : RATES.voidAfterKot;
    const voidIndex = rng.chance(voidP) ? rng.int(0, picked.size - 1) : -1;

    // Discount (S2: Habib on Thursdays).
    const isS2 = habibTakesIt;
    const discountP = isS2 ? RATES.s2ThursdayDiscount : RATES.discount;
    const discountPct = rng.chance(discountP) ? rng.pick(DISCOUNT_PCTS) : 0;
    const missingReason = rng.chance(
      isS2 ? RATES.s2DiscountMissingReason : RATES.discountMissingReason,
    );

    const lines: BuiltLine[] = [...picked.values()].map((p, idx) => {
      const voided = idx === voidIndex;
      const price = priceOf(org, b, p.item, date);
      const gross = price * p.quantity;
      const discountPoisha = !voided && discountPct > 0 ? mulBps(gross, discountPct) : 0;
      return {
        item: p.item,
        quantity: p.quantity,
        voided,
        amounts: computeLine({ unitPricePoisha: price, quantity: p.quantity, discountPoisha }, cfg),
      };
    });
    const active = lines.filter((l) => !l.voided);
    const totals = sumLines(active.map((l) => l.amounts));
    const cancelled = active.length === 0;
    const kotMs = placedMs + 90_000;
    // S11: Dhanmondi's kitchen is twice as slow on Friday nights (drawn first, so the stream is unchanged).
    const ticketMs = rng.int(8 * 60, 18 * 60) * 1000 * (inSlowSlot(org, b, placedMs) ? 2 : 1);
    const readyMs = kotMs + ticketMs;
    const paidMs = dineIn ? readyMs + rng.int(5, 15) * 60_000 : placedMs + 60_000;
    const guests = dineIn && rng.chance(0.5) ? rng.int(1, 6) : null;
    const shiftId = ids.shift(org, b, date, part);
    const customerId = customerFor(org, b, date, orderNumber, channel);

    rows.orders.push({
      id: orderId,
      org_id: ids.org(org),
      branch_id: ids.branch(org, b),
      channel_id: ids.channel(org, channel),
      shift_id: shiftId,
      staff_id: staffId,
      customer_id: customerId,
      order_number: orderNumber,
      order_status: cancelled ? 'cancelled' : 'completed',
      payment_status: cancelled ? 'unpaid' : 'paid',
      guests,
      placed_at: iso(placedMs),
      received_at: iso(placedMs),
      business_date: businessDate(new Date(placedMs), CUTOFF_MINUTES),
      gross_poisha: totals.grossPoisha,
      discount_poisha: totals.discountPoisha,
      net_before_discount_poisha: totals.netBeforeDiscountPoisha,
      discount_net_poisha: totals.discountNetPoisha,
      net_poisha: totals.netPoisha,
      vat_poisha: totals.vatPoisha,
      service_charge_poisha: totals.serviceChargePoisha,
      total_poisha: totals.totalPoisha,
      price_includes_vat: org.priceIncludesVat,
      vat_rate_bps: org.vatRateBps,
      service_charge_bps: cfg.serviceChargeBps,
    });

    lines.forEach((l, idx) => {
      const lineId = detId('line', org.key, b.key, date, orderNumber, idx);
      rows.order_items.push({
        id: lineId,
        org_id: ids.org(org),
        branch_id: ids.branch(org, b),
        order_id: orderId,
        menu_item_id: ids.item(org, l.item),
        name_snapshot: l.item.name,
        quantity: l.quantity,
        unit_price_poisha: l.amounts.grossPoisha / l.quantity,
        gross_poisha: l.amounts.grossPoisha,
        discount_poisha: l.amounts.discountPoisha,
        net_before_discount_poisha: l.amounts.netBeforeDiscountPoisha,
        discount_net_poisha: l.amounts.discountNetPoisha,
        net_poisha: l.amounts.netPoisha,
        vat_poisha: l.amounts.vatPoisha,
        service_charge_poisha: l.amounts.serviceChargePoisha,
        total_poisha: l.amounts.totalPoisha,
        status: l.voided ? 'voided' : 'active',
        kot_sent_at: iso(kotMs),
      });
      if (l.voided) {
        const voidedAt = kotMs + rng.int(4, 12) * 60_000;
        rows.voids.push({
          id: detId('void', org.key, b.key, date, orderNumber, idx),
          org_id: ids.org(org),
          branch_id: ids.branch(org, b),
          order_id: orderId,
          order_item_id: lineId,
          value_poisha: l.amounts.netBeforeDiscountPoisha,
          after_kot: true,
          after_payment: false,
          reason_code_id: ids.reason(
            org,
            'void',
            rng.pick(['wrong_item', 'customer_changed_mind', 'kitchen_delay']),
          ),
          voided_by_staff_id: staffId,
          voided_at: iso(voidedAt),
        });
        rows.order_events.push(event(org, b, orderId, 'voided', voidedAt, staffId, `void:${idx}`));
      }
    });

    rows.order_events.push(event(org, b, orderId, 'created', placedMs, staffId));
    rows.order_events.push(event(org, b, orderId, 'sent_to_kitchen', kotMs, staffId));
    if (!cancelled) {
      rows.order_events.push(event(org, b, orderId, 'ready', readyMs, null));
      rows.order_events.push(event(org, b, orderId, 'paid', paidMs, staffId));

      if (discountPct > 0 && totals.discountPoisha > 0) {
        rows.discounts.push({
          id: detId('discount', org.key, b.key, date, orderNumber),
          org_id: ids.org(org),
          branch_id: ids.branch(org, b),
          order_id: orderId,
          amount_poisha: totals.discountPoisha,
          percent_bps: discountPct,
          reason_code_id: missingReason
            ? null
            : ids.reason(
                org,
                'discount',
                rng.pick(['regular_customer', 'complaint', 'staff_meal', 'festival']),
              ),
          applied_by_staff_id: staffId,
          created_at: iso(placedMs + 30_000),
        });
      }

      const split =
        (channel === 'dine_in' || channel === 'takeaway') &&
        rng.chance(0.1) &&
        totals.totalPoisha >= 2;
      const legs: { method: PaymentMethod; amount: number }[] = split
        ? [
            { method, amount: Math.floor(totals.totalPoisha / 2) },
            {
              method: method === 'cash' ? 'bkash' : 'cash',
              amount: totals.totalPoisha - Math.floor(totals.totalPoisha / 2),
            },
          ]
        : [{ method, amount: totals.totalPoisha }];
      legs.forEach((leg, k) => {
        rows.payments.push({
          id: detId('payment', org.key, b.key, date, orderNumber, k),
          org_id: ids.org(org),
          branch_id: ids.branch(org, b),
          order_id: orderId,
          shift_id: shiftId,
          staff_id: staffId,
          method: leg.method,
          amount_poisha: leg.amount,
          received_at: iso(paidMs),
        });
        if (leg.method === 'cash') cashInShift[part] += leg.amount;
      });

      // Phase 8: some identified dine-in guests answer the feedback link; a few also post a review.
      if (dineIn && customerId) {
        const fb = feedbackFor({
          org,
          b,
          date,
          orderNumber,
          orderId,
          customerId,
          paidMs,
          placedMs,
          netPoisha: totals.netPoisha,
        });
        if (fb.feedback) rows.feedback.push(fb.feedback);
        if (fb.review) rows.reviews.push(fb.review);
      }
    }
  }

  // Shifts and their cash counts. A shift whose end is still in the future stays open.
  const FLOAT = 500_000;
  for (const part of ['am', 'pm'] as const) {
    if (!shiftUsed[part]) continue;
    const cashier = cashierByPart[part];
    const openedMs = startMs + (part === 'am' ? 0 : AM_SECONDS * 1000);
    const endMs = startMs + (part === 'am' ? AM_SECONDS : 86_400) * 1000;
    const closed = endMs <= frozenNowMs;
    const r = makeRng('cash', org.key, b.key, date, part);
    const expected = FLOAT + cashInShift[part];
    const noise =
      (r.chance(0.12) ? r.int(100, 300) * (r.chance(0.5) ? 1 : -1) : r.int(-30, 30)) * 100;
    const counted = Math.max(0, expected + noise);
    const shiftId = ids.shift(org, b, date, part);
    rows.shifts.push({
      id: shiftId,
      org_id: ids.org(org),
      branch_id: ids.branch(org, b),
      opened_by_staff_id: ids.staff(org, b, cashier),
      closed_by_staff_id: closed ? ids.staff(org, b, cashier) : null,
      status: closed ? 'closed' : 'open',
      opened_at: iso(openedMs),
      closed_at: closed ? iso(endMs) : null,
      business_date: date,
      opening_float_poisha: FLOAT,
      expected_cash_poisha: closed ? expected : null,
      counted_cash_poisha: closed ? counted : null,
      over_short_poisha: closed ? counted - expected : null,
    });
    rows.cash_counts.push({
      id: detId('cash-count', org.key, b.key, date, part, 'open'),
      org_id: ids.org(org),
      branch_id: ids.branch(org, b),
      shift_id: shiftId,
      kind: 'opening',
      counted_by_staff_id: ids.staff(org, b, cashier),
      counted_at: iso(openedMs),
      total_poisha: FLOAT,
    });
    if (closed) {
      rows.cash_counts.push({
        id: detId('cash-count', org.key, b.key, date, part, 'close'),
        org_id: ids.org(org),
        branch_id: ids.branch(org, b),
        shift_id: shiftId,
        kind: 'closing',
        counted_by_staff_id: ids.staff(org, b, cashier),
        counted_at: iso(endMs),
        total_poisha: counted,
      });
    }
  }
  return rows;
}

function event(
  org: OrgCfg,
  b: BranchCfg,
  orderId: string,
  type: string,
  atMs: number,
  staffId: string | null,
  salt = '',
): Row {
  return {
    id: detId('event', orderId, type, salt),
    org_id: ids.org(org),
    branch_id: ids.branch(org, b),
    order_id: orderId,
    event_type: type,
    staff_id: staffId,
    occurred_at: iso(atMs),
  };
}

/** Every business date in the dataset, oldest first. */
export function* allDates(): Generator<string> {
  for (let i = 0; i < DAYS; i++) yield addDays(FIRST_DATE, i);
}

export { ANCHOR_DATE };
