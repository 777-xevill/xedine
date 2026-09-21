/**
 * The ground-truth manifest (ROADMAP "Test oracle", ADR 0006). Committed at supabase/seed/manifest.json.
 * Raw sums are what the database must reproduce exactly; derived numbers use the shared formulas below
 * so the generator, the validator and later detector tests can never disagree about a definition.
 */
import { z } from 'zod';

const int = z.number().int();

export const TotalsSchema = z.object({
  orders_completed: int,
  orders_cancelled: int,
  /** VAT-exclusive, before discounts (sales.gross). */
  gross_poisha: int,
  discount_net_poisha: int,
  net_poisha: int,
  vat_poisha: int,
  service_charge_poisha: int,
  total_poisha: int,
  payments_poisha: int,
});
export type Totals = z.infer<typeof TotalsSchema>;

export const WindowQtySchema = z.object({
  last_2h: int,
  today: int,
  yesterday: int,
  last_7d: int,
  month_to_date: int,
  total: int,
});

export const BranchFactsSchema = TotalsSchema.extend({
  by_channel: z.record(z.string(), z.object({ orders: int, net_poisha: int })),
  /** items.qty_sold windows for the ground-truth item, at FROZEN_NOW. */
  item_qty: WindowQtySchema,
});

export const OrgFactsSchema = z.object({
  slug: z.string(),
  price_includes_vat: z.boolean(),
  vat_rate_bps: int,
  service_charge_bps: int,
  qty_item_key: z.string(),
  branches: z.record(z.string(), BranchFactsSchema),
  totals: TotalsSchema,
});

export const ScenarioSchema = z.object({
  id: z.string().regex(/^S\d+$/),
  title: z.string(),
  status: z.enum(['planted', 'pending']),
  /** The phase from which the planted data and its ground truth exist in the seed. */
  available_from_phase: int,
  /** The phase whose detector must recover it. */
  detected_in_phase: int,
  org: z.string().optional(),
  branch: z.string().optional(),
  facts: z.record(z.string(), z.unknown()).optional(),
  note: z.string().optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ManifestSchema = z.object({
  version: z.literal(1),
  seed: z.string(),
  anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  first_date: z.string(),
  days: int,
  frozen_now: z.string(),
  cutoff_minutes: int,
  orgs: z.record(z.string(), OrgFactsSchema),
  tolerances: z.object({
    sums: z.literal('exact'),
    finding_impact_pct: z.number(),
    max_false_positives_per_branch_week_on_clean_org: z.number(),
  }),
  scenarios: z.array(ScenarioSchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// ---- Shared derivations (used by the generator, the validator and later detector golden tests) ----

/** A staff member's rate as a multiple of their peers', ×100 (600 = 6.00×). */
export function rateRatioX100(num: number, den: number, peerNum: number, peerDen: number): number {
  if (den === 0 || peerDen === 0 || peerNum === 0) return 0;
  return Math.round((100 * (num / den)) / (peerNum / peerDen));
}

/** Excess over the peer baseline, in poisha: actual − (peer value per order × this staff's orders). */
export function excessOverBaseline(
  value: number,
  orders: number,
  peerValue: number,
  peerOrders: number,
): number {
  if (peerOrders === 0) return 0;
  return Math.round(value - (peerValue / peerOrders) * orders);
}

export const PENDING_SCENARIOS: Scenario[] = [
  {
    id: 'S4',
    title: 'Beef price spike (week 20) pushes Beef Tehari below target margin',
    status: 'pending',
    available_from_phase: 3,
    detected_in_phase: 3,
  },
  {
    id: 'S5',
    title: 'One Dog and one Puzzle item on the menu (Shahi Tukra, Kala Bhuna)',
    status: 'pending',
    available_from_phase: 3,
    detected_in_phase: 3,
    note: 'Menu items already seeded with low popularity; margins need recipe costs.',
  },
  {
    id: 'S6',
    title: 'Unrecorded chicken transfers Dhanmondi → Mirpur twice a week',
    status: 'pending',
    available_from_phase: 5,
    detected_in_phase: 6,
  },
  {
    id: 'S7',
    title: 'Mirpur over-portions kacchi mutton by ~12%',
    status: 'pending',
    available_from_phase: 5,
    detected_in_phase: 6,
  },
  {
    id: 'S8',
    title: 'Dhanmondi purchaser pays 9–12% above median for beef on some days',
    status: 'pending',
    available_from_phase: 5,
    detected_in_phase: 6,
  },
  {
    id: 'S9',
    title: 'Uttara unlogged rice waste ≈ 4 kg/day',
    status: 'pending',
    available_from_phase: 5,
    detected_in_phase: 6,
  },
  {
    id: 'S10',
    title: 'Ramadan iftar surge, Eid closure + rebound, salary-week lift, rainy-day dine-in dip',
    status: 'pending',
    available_from_phase: 0,
    detected_in_phase: 7,
    note: 'The seasonal shape is already in the generated orders; forecast ground truth is defined in Phase 7.',
  },
  {
    id: 'S11',
    title: 'Dhanmondi Friday 20:00–22:00 ticket times double; "slow" complaints',
    status: 'pending',
    available_from_phase: 8,
    detected_in_phase: 8,
  },
  {
    id: 'S12',
    title: 'Uttara regulars lapse after a price increase',
    status: 'pending',
    available_from_phase: 8,
    detected_in_phase: 8,
  },
];
