import { beforeAll, describe, expect, it } from 'vitest';
import { businessDate } from '../../src/lib/time/business-date';
import { ANCHOR_DATE, CUTOFF_MINUTES, DEMO_CAFE, FROZEN_NOW, KACCHI_HOUSE, ORGS } from './config';
import { allDates, generateDay, type DayRows } from './generate';
import { Inventory, S6, S7, S8, S9 } from './inventory';
import { Ledger } from './ledger';
import { Retention } from './retention';
import { Seasonal } from './seasonal';
import { ManifestSchema, type Manifest } from './manifest';

const num = (v: unknown) => Number(v);

describe('generator: determinism', () => {
  it('the same seed yields identical rows; a different day yields different rows', () => {
    const b = KACCHI_HOUSE.branches[1]!;
    const a1 = generateDay(KACCHI_HOUSE, b, '2026-03-05');
    const a2 = generateDay(KACCHI_HOUSE, b, '2026-03-05');
    const other = generateDay(KACCHI_HOUSE, b, '2026-03-06');
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
    expect(JSON.stringify(a1)).not.toBe(JSON.stringify(other));
    expect(a1.orders.length).toBeGreaterThan(0);
  });
});

describe('generator: row invariants', () => {
  const sample = [
    '2025-11-06',
    '2026-01-15',
    '2026-02-27',
    '2026-06-13',
    '2026-09-20',
    ANCHOR_DATE,
  ];

  for (const org of ORGS) {
    it(`${org.name}: every order is internally consistent`, () => {
      for (const date of sample) {
        for (const b of org.branches) {
          const day = generateDay(org, b, date);
          const linesByOrder = new Map<string, DayRows['order_items']>();
          for (const l of day.order_items)
            linesByOrder.set(String(l.order_id), [
              ...(linesByOrder.get(String(l.order_id)) ?? []),
              l,
            ]);
          const paidByOrder = new Map<string, number>();
          for (const p of day.payments)
            paidByOrder.set(
              String(p.order_id),
              (paidByOrder.get(String(p.order_id)) ?? 0) + num(p.amount_poisha),
            );

          for (const o of day.orders) {
            const active = (linesByOrder.get(String(o.id)) ?? []).filter(
              (l) => l.status === 'active',
            );
            const sum = (k: string) => active.reduce((s, l) => s + num(l[k]), 0);
            expect(num(o.net_poisha)).toBe(sum('net_poisha'));
            expect(num(o.vat_poisha)).toBe(sum('vat_poisha'));
            expect(num(o.service_charge_poisha)).toBe(sum('service_charge_poisha'));
            expect(num(o.total_poisha)).toBe(
              num(o.net_poisha) + num(o.vat_poisha) + num(o.service_charge_poisha),
            );
            expect(num(o.net_before_discount_poisha) - num(o.discount_net_poisha)).toBe(
              num(o.net_poisha),
            );
            if (org.priceIncludesVat) {
              // Inclusive: net + VAT is exactly the printed price after discount.
              expect(num(o.net_poisha) + num(o.vat_poisha)).toBe(
                num(o.gross_poisha) - num(o.discount_poisha),
              );
            }
            if (o.order_status === 'cancelled') {
              expect(num(o.total_poisha)).toBe(0);
              expect(paidByOrder.has(String(o.id))).toBe(false);
              expect(active).toHaveLength(0);
            } else {
              expect(paidByOrder.get(String(o.id))).toBe(num(o.total_poisha)); // split payments still add up
            }
            expect(o.business_date).toBe(
              businessDate(new Date(String(o.placed_at)), CUTOFF_MINUTES),
            );
            expect(Date.parse(String(o.placed_at))).toBeLessThanOrEqual(Date.parse(FROZEN_NOW));
          }
        }
      }
    });
  }

  it('Café charges service on dine-in only, and adds VAT on top (exclusive pricing)', () => {
    const day = generateDay(DEMO_CAFE, DEMO_CAFE.branches[0]!, '2026-06-13');
    const dineIn = day.orders.filter((o) => num(o.service_charge_bps) > 0);
    expect(dineIn.length).toBeGreaterThan(0);
    expect(day.orders.some((o) => num(o.service_charge_bps) === 0)).toBe(true);
    for (const o of day.orders.filter((x) => x.order_status === 'completed')) {
      expect(o.price_includes_vat).toBe(false);
      expect(num(o.total_poisha)).toBeGreaterThan(num(o.net_poisha));
    }
  });

  it('Eid closure days have no orders, and the day after rebounds', () => {
    for (const b of KACCHI_HOUSE.branches) {
      expect(generateDay(KACCHI_HOUSE, b, '2026-03-20').orders).toHaveLength(0);
      expect(generateDay(KACCHI_HOUSE, b, '2026-05-27').orders).toHaveLength(0);
    }
  });

  it('nothing is generated after the frozen "now", and the last shift is still open', () => {
    const day = generateDay(KACCHI_HOUSE, KACCHI_HOUSE.branches[0]!, ANCHOR_DATE);
    const latest = Math.max(...day.orders.map((o) => Date.parse(String(o.placed_at))));
    expect(latest).toBeLessThanOrEqual(Date.parse(FROZEN_NOW));
    expect(day.shifts.some((s) => s.status === 'open')).toBe(true);
  });
});

describe('generator: the planted scenarios and the clean control', () => {
  let manifest: Manifest;
  const scenario = (id: string) => manifest.scenarios.find((s) => s.id === id)!;

  beforeAll(() => {
    // One full pass over the year. Streaming, so memory stays flat.
    const ledger = new Ledger();
    const inventory = new Inventory();
    const seasonal = new Seasonal();
    const retention = new Retention();
    for (const org of ORGS) {
      for (const date of allDates()) {
        for (const b of org.branches) {
          const rows = generateDay(org, b, date);
          ledger.add(org, b.key, rows);
          inventory.day(org, b, date, rows);
          seasonal.add(org, date, rows);
          retention.add(org, b, date, rows);
        }
      }
    }
    manifest = ledger.manifest(inventory, seasonal, retention);
  }, 120_000);

  it('Phase 3 plants hold: combo loses on foodpanda, the spike pushes Tehari over target, a Dog and a Puzzle', () => {
    const facts = (id: string) =>
      manifest.scenarios.find((s) => s.id === id)!.facts as Record<string, unknown>;
    const fm = (
      facts('S3').full_margin as unknown as { branches: Record<string, { loss_poisha: number }> }
    ).branches;
    for (const b of KACCHI_HOUSE.branches) expect(fm[b.key]!.loss_poisha).toBeGreaterThan(0);
    const s4 = facts('S4') as unknown as {
      target_food_cost_bps: number;
      branches: Record<string, Record<'before' | 'spike', { food_cost_bps: number }>>;
    };
    for (const b of KACCHI_HOUSE.branches) {
      expect(s4.branches[b.key]!.before.food_cost_bps).toBeLessThan(s4.target_food_cost_bps);
      expect(s4.branches[b.key]!.spike.food_cost_bps).toBeGreaterThan(s4.target_food_cost_bps);
    }
    const matrix = facts('S5').matrix as unknown as Record<string, string>;
    expect(matrix.shahi_tukra).toBe('dog');
    expect(matrix.kala_bhuna).toBe('puzzle');
  });

  it('Phase 5–6 plants show up in the recorded stock the way a detector will see them', () => {
    type Plant =
      'moved_qty' | 'from_variance_qty' | 'to_variance_qty' | 'wasted_qty' | 'variance_qty';
    const facts = (id: string) =>
      manifest.scenarios.find((s) => s.id === id)!.facts as unknown as Record<Plant, number>;
    const v = manifest.inventory.orgs.demo_kacchi_house!.branches;
    const bps = (b: string, ing: string) =>
      (v[b]!.variance[ing]!.variance_qty * 10000) / v[b]!.variance[ing]!.usage_theoretical_qty;
    // S6: Dhanmondi's chicken looks over-used and Mirpur's under-used, each by roughly what moved.
    const s6 = facts('S6');
    expect(s6.moved_qty).toBe(8 * S6.grams); // eight Tuesdays and Saturdays in the four weeks
    expect(s6.from_variance_qty).toBeGreaterThan(s6.moved_qty);
    expect(s6.from_variance_qty).toBeLessThan(s6.moved_qty * 1.2);
    expect(-s6.to_variance_qty).toBeGreaterThan(s6.moved_qty * 0.8);
    expect(-s6.to_variance_qty).toBeLessThan(s6.moved_qty);
    // S7: Mirpur's mutton variance is the 12% over-portion plus the normal 1% and cooked-then-voided dishes.
    expect(bps(S7.branch, S7.ing)).toBeGreaterThan(1200);
    expect(bps(S7.branch, S7.ing)).toBeLessThan(1500);
    for (const b of ['dhanmondi', 'uttara']) expect(bps(b, S7.ing)).toBeLessThan(200);
    // S8: overpaid days are 9–12% over, on roughly a third of days.
    const s8 = manifest.scenarios.find((s) => s.id === 'S8')!.facts as {
      days: { bps: number }[];
    };
    expect(s8.days.length).toBeGreaterThan(4);
    for (const d of s8.days) {
      expect(d.bps).toBeGreaterThanOrEqual(S8.minBps);
      expect(d.bps).toBeLessThanOrEqual(S8.maxBps);
    }
    // S9: Uttara's rice variance is the 4 kg a day nobody logged.
    expect(facts('S9').wasted_qty).toBe(28 * S9.grams);
    expect(facts('S9').variance_qty).toBeGreaterThan(facts('S9').wasted_qty);
    // The clean café: the normal 1% loss plus cooked-then-voided dishes at the baseline void rate —
    // at most the low end of the 2–5% 'watch' band, never a problem.
    for (const [ing, x] of Object.entries(
      manifest.inventory.orgs.demo_cafe!.branches.gulshan!.variance,
    )) {
      if (x.usage_theoretical_qty > 0)
        expect(Math.abs((x.variance_qty * 10000) / x.usage_theoretical_qty), ing).toBeLessThan(300);
    }
    // Discipline: Mirpur skips the waste log at weekends, Uttara missed the 13 September count.
    const d = (b: string) => manifest.inventory.orgs.demo_kacchi_house!.branches[b]!.discipline;
    expect(d('mirpur')['2026-09-18']).toBe(85);
    expect(d('mirpur')['2026-09-17']).toBe(100);
    expect(d('uttara')['2026-09-13']).toBe(75);
    expect(Object.values(d('dhanmondi')).every((s) => s === 100)).toBe(true);
  });

  it('Phase 8 plants: Friday nights at Dhanmondi are twice as slow; Uttara loses its regulars', () => {
    const s11 = manifest.scenarios.find((s) => s.id === 'S11')!.facts as Record<string, number>;
    expect(s11.orders).toBeGreaterThan(60);
    expect(s11.median_seconds! / s11.branch_median_seconds!).toBeGreaterThan(1.7);
    expect(s11.feedback_slow).toBeGreaterThan(0);
    const s12 = manifest.scenarios.find((s) => s.id === 'S12')!.facts as {
      branches: Record<string, { regulars: number; lapsed: number }>;
    };
    const rate = (b: string) => s12.branches[b]!.lapsed / s12.branches[b]!.regulars;
    expect(s12.branches.uttara!.regulars).toBeGreaterThan(20);
    expect(rate('uttara')).toBeGreaterThan(0.5);
    for (const b of ['dhanmondi', 'mirpur']) expect(rate(b)).toBeLessThan(0.2);
  });

  it('the manifest satisfies its own schema', () => {
    expect(() => ManifestSchema.parse(manifest)).not.toThrow();
    expect(manifest.scenarios.map((s) => s.id)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S13',
      'S6',
      'S7',
      'S8',
      'S9',
      'S10',
      'S11',
      'S12',
    ]);
  });

  it('has a year of realistic volume', () => {
    const total = manifest.orgs.demo_kacchi_house!.totals.orders_completed;
    expect(total).toBeGreaterThan(50_000);
    expect(total).toBeLessThan(120_000);
    expect(manifest.orgs.demo_cafe!.totals.orders_completed).toBeGreaterThan(10_000);
  });

  it('S1: the Mirpur cashier voids after KOT at roughly 6× the peers', () => {
    const f = scenario('S1').facts as unknown as Record<
      'staff_void_count' | 'void_rate_ratio_x100' | 'excess_void_value_poisha',
      number
    >;
    expect(f.staff_void_count).toBeGreaterThan(300);
    expect(f.void_rate_ratio_x100).toBeGreaterThan(480);
    expect(f.void_rate_ratio_x100).toBeLessThan(780);
    expect(f.excess_void_value_poisha).toBeGreaterThan(0);
  });

  it('S2: the Uttara manager discounts at roughly 3× the peers, and skips reason codes more', () => {
    const f = scenario('S2').facts as unknown as Record<
      | 'staff_discount_count'
      | 'discount_rate_ratio_x100'
      | 'staff_discounts_without_reason'
      | 'peer_discounts_without_reason'
      | 'peer_discount_count',
      number
    >;
    expect(f.staff_discount_count).toBeGreaterThan(50);
    expect(f.discount_rate_ratio_x100).toBeGreaterThan(220);
    expect(f.discount_rate_ratio_x100).toBeLessThan(400);
    expect(f.staff_discounts_without_reason / f.staff_discount_count).toBeGreaterThan(
      2 * (f.peer_discounts_without_reason / f.peer_discount_count),
    );
  });

  it('S3: most family combos are sold through foodpanda, and the commission is a large share of their net', () => {
    const f = scenario('S3').facts as {
      combo_net_unit_poisha: number;
      combo_commission_per_unit_poisha: number;
      branches: Record<
        string,
        {
          combo_units_via_foodpanda: number;
          combo_units_total: number;
          foodpanda_commission_poisha: number;
        }
      >;
    };
    for (const b of Object.values(f.branches)) {
      expect(b.combo_units_via_foodpanda / b.combo_units_total).toBeGreaterThan(0.6);
      expect(b.foodpanda_commission_poisha).toBeGreaterThan(0);
    }
    expect(f.combo_commission_per_unit_poisha / f.combo_net_unit_poisha).toBeCloseTo(0.3, 2);
  });

  it('S13: the Café stays at baseline — no planted anomaly to find', () => {
    const f = scenario('S13').facts as unknown as Record<
      'void_after_kot_count' | 'discount_count' | 'orders',
      number
    >;
    const voidRate = f.void_after_kot_count / f.orders;
    const discountRate = f.discount_count / f.orders;
    expect(voidRate).toBeGreaterThan(0.003);
    expect(voidRate).toBeLessThan(0.012); // the baseline is 0.7%
    expect(discountRate).toBeGreaterThan(0.02);
    expect(discountRate).toBeLessThan(0.045); // the baseline is 3%
  });

  it('rolling-window quantities are ordered sensibly at the frozen now', () => {
    for (const org of Object.values(manifest.orgs)) {
      for (const b of Object.values(org.branches)) {
        const q = b.item_qty;
        expect(q.last_2h).toBeLessThanOrEqual(q.today);
        expect(q.today).toBeLessThanOrEqual(q.last_7d);
        expect(q.last_7d).toBeLessThanOrEqual(q.total);
        expect(q.month_to_date).toBeLessThanOrEqual(q.total);
        expect(q.today).toBeGreaterThan(0);
      }
    }
  });

  it('channel nets add up to the branch net, and payments equal totals', () => {
    for (const org of Object.values(manifest.orgs)) {
      for (const b of Object.values(org.branches)) {
        expect(Object.values(b.by_channel).reduce((s, c) => s + c.net_poisha, 0)).toBe(
          b.net_poisha,
        );
        expect(Object.values(b.by_channel).reduce((s, c) => s + c.orders, 0)).toBe(
          b.orders_completed,
        );
        expect(b.payments_poisha).toBe(b.total_poisha);
      }
    }
  });
});
