/**
 * The synthetic Dhaka dataset (ROADMAP "Test oracle"). Two demo organizations, 365 days of orders
 * ending on ANCHOR_DATE, with known anomalies planted for the leak detectors to recover.
 * Everything here is fixture data: demo orgs only, never a production path (CLAUDE.md "Don'ts").
 */
import { addDays } from '../../src/lib/time/business-date';

export const ANCHOR_DATE = '2026-09-21';
export const DAYS = 365;
export const FIRST_DATE = addDays(ANCHOR_DATE, -(DAYS - 1));
/** Tests freeze "now" to the anchor date at 23:30 Asia/Dhaka (= 17:30Z), inside the last business day. */
export const FROZEN_NOW = '2026-09-21T17:30:00Z';
export const CUTOFF_MINUTES = 240;
export const DEMO_PASSWORD = 'demo-password-123';

export type ChannelKey = 'dine_in' | 'takeaway' | 'own_delivery' | 'foodpanda' | 'pathao_food';
export type PaymentMethod = 'cash' | 'card' | 'bkash' | 'nagad' | 'rocket' | 'upay' | 'bank';

export interface MenuItemCfg {
  key: string;
  name: string;
  nameBn?: string;
  category: string;
  /** Printed menu price in poisha (VAT-inclusive or not per the org). */
  pricePoisha: number;
  /** Relative popularity. */
  pop: number;
  isCombo?: boolean;
}

export interface StaffCfg {
  key: string;
  name: string;
  role: 'cashier' | 'manager';
}

export interface BranchCfg {
  key: string;
  name: string;
  area: string;
  baseOrders: number;
  staff: StaffCfg[];
}

export interface OrgCfg {
  key: string;
  slug: string;
  name: string;
  priceIncludesVat: boolean;
  /** TODO(verify): demo values only. Real regulatory rates are owner-entered config. */
  vatRateBps: number;
  serviceChargeBps: number;
  assumedFoodCostBps: number;
  cuisine: string;
  format: string;
  hourWeights: readonly number[];
  channels: { key: ChannelKey; name: string; share: number; commissionBps: number }[];
  categories: string[];
  menu: MenuItemCfg[];
  branches: BranchCfg[];
  users: {
    email: string;
    role: 'owner' | 'manager' | 'accountant';
    branchKey?: string;
    fullName: string;
  }[];
}

const tk = (taka: number) => taka * 100;

// Local hour 0..23. Two peaks: lunch 12-14 and dinner 20-22; Thursday/Friday nights heavier via weekday factor.
const KACCHI_HOURS = [
  2, 1, 0.5, 0.3, 0, 0, 1, 1.5, 2, 2, 2.5, 4, 9, 11, 9, 4, 3, 3.5, 4, 8, 12, 12, 8, 4,
] as const;
const CAFE_HOURS = [
  0, 0, 0, 0, 0, 0, 1, 6, 9, 9, 7, 6, 8, 8, 6, 6, 7, 6, 5, 4, 3, 2, 1, 0,
] as const;

export const KACCHI_HOUSE: OrgCfg = {
  key: 'demo_kacchi_house',
  slug: 'demo-kacchi-house',
  name: 'Demo Kacchi House',
  priceIncludesVat: true,
  vatRateBps: 500,
  serviceChargeBps: 0,
  assumedFoodCostBps: 3600,
  cuisine: 'kacchi_biryani',
  format: 'casual_dining',
  hourWeights: KACCHI_HOURS,
  channels: [
    { key: 'dine_in', name: 'Dine-in', share: 55, commissionBps: 0 },
    { key: 'takeaway', name: 'Takeaway', share: 15, commissionBps: 0 },
    { key: 'own_delivery', name: 'Own delivery', share: 10, commissionBps: 0 },
    { key: 'foodpanda', name: 'foodpanda', share: 15, commissionBps: 3000 },
    { key: 'pathao_food', name: 'Pathao Food', share: 5, commissionBps: 2500 },
  ],
  categories: ['Kacchi & Biryani', 'Kabab & Grill', 'Rice & Curry', 'Sides', 'Drinks', 'Combos'],
  menu: [
    {
      key: 'kacchi_mutton',
      name: 'Kacchi Biryani (Mutton)',
      nameBn: 'কাচ্চি বিরিয়ানি (মটন)',
      category: 'Kacchi & Biryani',
      pricePoisha: tk(420),
      pop: 30,
    },
    {
      key: 'kacchi_half',
      name: 'Kacchi Biryani (Half)',
      nameBn: 'কাচ্চি বিরিয়ানি (হাফ)',
      category: 'Kacchi & Biryani',
      pricePoisha: tk(260),
      pop: 12,
    },
    {
      key: 'tehari',
      name: 'Beef Tehari',
      nameBn: 'বিফ তেহারি',
      category: 'Kacchi & Biryani',
      pricePoisha: tk(230),
      pop: 18,
    },
    {
      key: 'morog_polao',
      name: 'Morog Polao',
      nameBn: 'মোরগ পোলাও',
      category: 'Kacchi & Biryani',
      pricePoisha: tk(280),
      pop: 8,
    },
    {
      key: 'chicken_roast',
      name: 'Chicken Roast',
      nameBn: 'চিকেন রোস্ট',
      category: 'Rice & Curry',
      pricePoisha: tk(120),
      pop: 10,
    },
    {
      key: 'beef_bhuna',
      name: 'Beef Bhuna',
      nameBn: 'বিফ ভুনা',
      category: 'Rice & Curry',
      pricePoisha: tk(260),
      pop: 7,
    },
    {
      key: 'chicken_kabab',
      name: 'Chicken Kabab',
      nameBn: 'চিকেন কাবাব',
      category: 'Kabab & Grill',
      pricePoisha: tk(180),
      pop: 9,
    },
    {
      key: 'jali_kabab',
      name: 'Jali Kabab',
      nameBn: 'জালি কাবাব',
      category: 'Kabab & Grill',
      pricePoisha: tk(140),
      pop: 6,
    },
    {
      key: 'plain_rice',
      name: 'Plain Rice',
      nameBn: 'সাদা ভাত',
      category: 'Sides',
      pricePoisha: tk(40),
      pop: 8,
    },
    {
      key: 'salad',
      name: 'Green Salad',
      nameBn: 'সবুজ সালাদ',
      category: 'Sides',
      pricePoisha: tk(50),
      pop: 4,
    },
    {
      key: 'firni',
      name: 'Firni',
      nameBn: 'ফিরনি',
      category: 'Sides',
      pricePoisha: tk(90),
      pop: 6,
    },
    {
      key: 'borhani',
      name: 'Borhani',
      nameBn: 'বোরহানি',
      category: 'Drinks',
      pricePoisha: tk(60),
      pop: 16,
    },
    {
      key: 'soft_drink',
      name: 'Soft Drink',
      nameBn: 'কোমল পানীয়',
      category: 'Drinks',
      pricePoisha: tk(50),
      pop: 12,
    },
    {
      key: 'water',
      name: 'Mineral Water',
      nameBn: 'মিনারেল ওয়াটার',
      category: 'Drinks',
      pricePoisha: tk(30),
      pop: 10,
    },
    // S3: a delivery combo that loses money once the foodpanda commission is paid (proven in Phase 3 with recipe costs).
    {
      key: 'family_combo',
      name: 'Family Combo',
      nameBn: 'ফ্যামিলি কম্বো',
      category: 'Combos',
      pricePoisha: tk(1250),
      pop: 3.2,
      isCombo: true,
    },
    // S5 (Phase 3): a Dog (low popularity, low margin) and a Puzzle (low popularity, high margin).
    {
      key: 'shahi_tukra',
      name: 'Shahi Tukra',
      nameBn: 'শাহী টুকরা',
      category: 'Sides',
      pricePoisha: tk(180),
      pop: 0.6,
    },
    {
      key: 'kala_bhuna',
      name: 'Kala Bhuna',
      nameBn: 'কালা ভুনা',
      category: 'Rice & Curry',
      pricePoisha: tk(420),
      pop: 1.2,
    },
  ],
  branches: [
    {
      key: 'dhanmondi',
      name: 'Dhanmondi',
      area: 'Dhanmondi',
      baseOrders: 90,
      staff: [
        { key: 'sumon', name: 'Sumon', role: 'cashier' },
        { key: 'nasrin', name: 'Nasrin', role: 'cashier' },
        { key: 'jahid', name: 'Jahid', role: 'cashier' },
        { key: 'farhana', name: 'Farhana', role: 'manager' },
      ],
    },
    {
      key: 'mirpur',
      name: 'Mirpur',
      area: 'Mirpur 10',
      baseOrders: 70,
      staff: [
        { key: 'rafiq', name: 'Rafiq', role: 'cashier' }, // S1: voids after KOT on cash orders at ~6x baseline
        { key: 'kamal', name: 'Kamal', role: 'cashier' },
        { key: 'shirin', name: 'Shirin', role: 'cashier' },
        { key: 'anwar', name: 'Anwar', role: 'manager' },
      ],
    },
    {
      key: 'uttara',
      name: 'Uttara',
      area: 'Uttara Sector 7',
      baseOrders: 60,
      staff: [
        { key: 'liton', name: 'Liton', role: 'cashier' },
        { key: 'rima', name: 'Rima', role: 'cashier' },
        { key: 'sohel', name: 'Sohel', role: 'cashier' },
        { key: 'habib', name: 'Habib', role: 'manager' }, // S2: ~3x normal discounts on Thursdays
      ],
    },
  ],
  users: [
    { email: 'owner@demo-kacchi.xedine.example', role: 'owner', fullName: 'Demo Owner' },
    {
      email: 'accountant@demo-kacchi.xedine.example',
      role: 'accountant',
      fullName: 'Demo Accountant',
    },
    {
      email: 'manager.mirpur@demo-kacchi.xedine.example',
      role: 'manager',
      branchKey: 'mirpur',
      fullName: 'Anwar (Mirpur manager)',
    },
    {
      email: 'manager.uttara@demo-kacchi.xedine.example',
      role: 'manager',
      branchKey: 'uttara',
      fullName: 'Habib (Uttara manager)',
    },
  ],
};

export const DEMO_CAFE: OrgCfg = {
  key: 'demo_cafe',
  slug: 'demo-cafe',
  name: 'Demo Café',
  priceIncludesVat: false,
  vatRateBps: 500,
  serviceChargeBps: 500,
  assumedFoodCostBps: 3200,
  cuisine: 'cafe',
  format: 'cafe',
  hourWeights: CAFE_HOURS,
  channels: [
    { key: 'dine_in', name: 'Dine-in', share: 60, commissionBps: 0 },
    { key: 'takeaway', name: 'Takeaway', share: 30, commissionBps: 0 },
    { key: 'foodpanda', name: 'foodpanda', share: 10, commissionBps: 3000 },
  ],
  categories: ['Coffee', 'Cold Drinks', 'Food', 'Dessert'],
  menu: [
    { key: 'espresso', name: 'Espresso', category: 'Coffee', pricePoisha: tk(180), pop: 12 },
    { key: 'cappuccino', name: 'Cappuccino', category: 'Coffee', pricePoisha: tk(240), pop: 20 },
    { key: 'latte', name: 'Latte', category: 'Coffee', pricePoisha: tk(260), pop: 18 },
    {
      key: 'cold_coffee',
      name: 'Cold Coffee',
      category: 'Cold Drinks',
      pricePoisha: tk(280),
      pop: 16,
    },
    { key: 'iced_tea', name: 'Iced Tea', category: 'Cold Drinks', pricePoisha: tk(160), pop: 8 },
    {
      key: 'chicken_sandwich',
      name: 'Chicken Sandwich',
      category: 'Food',
      pricePoisha: tk(320),
      pop: 11,
    },
    { key: 'club_sandwich', name: 'Club Sandwich', category: 'Food', pricePoisha: tk(380), pop: 7 },
    { key: 'pasta_alfredo', name: 'Pasta Alfredo', category: 'Food', pricePoisha: tk(450), pop: 6 },
    { key: 'fries', name: 'French Fries', category: 'Food', pricePoisha: tk(200), pop: 9 },
    { key: 'croissant', name: 'Croissant', category: 'Dessert', pricePoisha: tk(150), pop: 8 },
    { key: 'brownie', name: 'Brownie', category: 'Dessert', pricePoisha: tk(190), pop: 9 },
    { key: 'cheesecake', name: 'Cheesecake', category: 'Dessert', pricePoisha: tk(320), pop: 5 },
  ],
  branches: [
    {
      key: 'gulshan',
      name: 'Gulshan',
      area: 'Gulshan 2',
      baseOrders: 55,
      staff: [
        { key: 'tania', name: 'Tania', role: 'cashier' },
        { key: 'imran', name: 'Imran', role: 'cashier' },
        { key: 'meherun', name: 'Meherun', role: 'manager' },
      ],
    },
  ],
  users: [{ email: 'owner@demo-cafe.xedine.example', role: 'owner', fullName: 'Demo Café Owner' }],
};

export const ORGS: readonly OrgCfg[] = [KACCHI_HOUSE, DEMO_CAFE];

/** Sunday = 0 … Saturday = 6. Friday and Saturday are the Bangladesh weekend; Thursday night is a peak. */
export const WEEKDAY_FACTOR = [0.9, 0.85, 0.85, 0.9, 1.15, 1.45, 1.25] as const;

// TODO(verify): religious dates are astronomical estimates until confirmed each year.
export const CALENDAR = [
  { name: 'Ramadan 2026', kind: 'ramadan', starts_on: '2026-02-18', ends_on: '2026-03-19' },
  {
    name: 'Eid-ul-Fitr 2026 (closure)',
    kind: 'eid',
    starts_on: '2026-03-20',
    ends_on: '2026-03-21',
  },
  { name: 'Pohela Boishakh 1433', kind: 'holiday', starts_on: '2026-04-14', ends_on: '2026-04-14' },
  {
    name: 'Eid-ul-Adha 2026 (closure)',
    kind: 'eid',
    starts_on: '2026-05-27',
    ends_on: '2026-05-28',
  },
] as const;

export const FIXED_COSTS_PER_BRANCH = [
  { kind: 'rent', label: 'Rent', monthly: tk(180_000) },
  { kind: 'utilities', label: 'Electricity & water', monthly: tk(45_000) },
  { kind: 'gas', label: 'Gas', monthly: tk(38_000) },
  { kind: 'internet', label: 'Internet', monthly: tk(3_500) },
] as const;

export const SALARY_TAKA = { cashier: 16_000, manager: 32_000 } as const;

export const PAYMENT_MIX: readonly { method: PaymentMethod; weight: number }[] = [
  { method: 'cash', weight: 62 },
  { method: 'bkash', weight: 18 },
  { method: 'card', weight: 9 },
  { method: 'nagad', weight: 6 },
  { method: 'rocket', weight: 2 },
  { method: 'bank', weight: 2 },
  { method: 'upay', weight: 1 },
];

/** Planted scenario parameters. Normal staff: the "baseline". */
export const RATES = {
  /** Probability a normal order has one line voided after the kitchen ticket. */
  voidAfterKot: 0.007,
  /** S1: Rafiq at Mirpur, on cash orders. Tuned so his overall void rate is ~6x his peers (cash is ~62% of orders). */
  s1CashVoidAfterKot: 0.063,
  discount: 0.03,
  /** S2: Habib at Uttara on Thursdays — 3x the baseline discount rate. */
  s2ThursdayDiscount: 0.09,
  /** Share of a Thursday's Uttara orders Habib rings up himself. */
  s2HabibThursdayShare: 0.25,
  /** Discounts recorded without a reason code. */
  discountMissingReason: 0.1,
  s2DiscountMissingReason: 0.4,
} as const;

/**
 * S12 (Phase 8): Uttara raises its kacchi prices on 1 July; from then its regulars stop coming
 * (customers.ts). Orders at Uttara charge the new price from that day.
 */
export const BRANCH_PRICE_CHANGES = [
  {
    org: 'demo_kacchi_house',
    branch: 'uttara',
    item: 'kacchi_mutton',
    from: '2026-07-01',
    pricePoisha: tk(470),
  },
  {
    org: 'demo_kacchi_house',
    branch: 'uttara',
    item: 'kacchi_half',
    from: '2026-07-01',
    pricePoisha: tk(290),
  },
] as const;

/** The printed price of an item at a branch on a business day. */
export function priceOf(org: OrgCfg, b: BranchCfg, item: MenuItemCfg, date: string): number {
  let price = item.pricePoisha;
  for (const c of BRANCH_PRICE_CHANGES)
    if (c.org === org.key && c.branch === b.key && c.item === item.key && c.from <= date)
      price = c.pricePoisha;
  return price;
}

/**
 * Phase 9 "industry reference" ranges for the demo (ADR 0022 §6). Illustrative only — not survey data —
 * and loaded by the seed, never by a migration, so production shows none until real ranges are sourced.
 * TODO(verify): replace with ranges from a Bangladesh restaurant survey before showing them to customers.
 */
export const BENCHMARK_REFERENCES: { metric_id: string; p25: number; p50: number; p75: number }[] =
  [
    { metric_id: 'food_cost.theoretical_pct', p25: 2800, p50: 3300, p75: 3800 },
    { metric_id: 'labour.pct', p25: 1200, p50: 1600, p75: 2000 },
    { metric_id: 'channel.delivery_share', p25: 1500, p50: 3000, p75: 4500 },
    { metric_id: 'visits.first_return_rate', p25: 1800, p50: 2600, p75: 3400 },
    { metric_id: 'rating.avg', p25: 7.4, p50: 8.2, p75: 8.9 },
  ];
