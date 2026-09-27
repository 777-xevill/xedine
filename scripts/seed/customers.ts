/**
 * The demo orgs' customers, feedback and reviews (ROADMAP Phase 8 test oracle). Fixture data only: phone
 * numbers are made up. Every choice here uses its own random streams, so order contents never change.
 *
 *   Pools   — per branch: a few regulars (who come every week or so) and many occasional customers. About a
 *             third of dine-in, takeaway and own-delivery orders are identified (platform orders never are).
 *   S11     — Dhanmondi's kitchen takes twice as long on Friday nights, 20:00–22:00 (generate.ts), and the
 *             feedback and reviews from those tables complain that it was slow.
 *   S12     — Uttara raises its kacchi prices on 1 July (config.ts) and its regulars stop coming.
 */
import { FIRST_DATE, type BranchCfg, type OrgCfg } from './config';
import type { Row } from './generate';
import { detId, makeRng } from './rng';

export const IDENTIFIED_SHARE = 0.35;
export const LAPSE = {
  org: 'demo_kacchi_house',
  branch: 'uttara',
  from: '2026-07-01',
  regularWeight: 0.4,
};
export const S11_SLOT = {
  org: 'demo_kacchi_house',
  branch: 'dhanmondi',
  weekday: 5,
  fromHour: 20,
  toHour: 22,
};

const POOL = { kacchi: { size: 1200, regulars: 60 }, cafe: { size: 600, regulars: 40 } };
const REGULAR_WEIGHT = 20;

export const custIds = {
  customer: (org: OrgCfg, b: BranchCfg, i: number) => detId('customer', org.key, b.key, i),
};

export function poolFor(org: OrgCfg) {
  return org.key === 'demo_cafe' ? POOL.cafe : POOL.kacchi;
}

/** A made-up +8801 number, unique per org, branch and index. */
export function phoneOf(org: OrgCfg, b: BranchCfg, i: number): string {
  const orgN = org.key === 'demo_cafe' ? 9 : 7;
  const branchN = org.branches.findIndex((x) => x.key === b.key);
  return `+8801${orgN}${branchN}${String(i).padStart(7, '0')}`;
}

/** Customer rows and consent history for every pool (loaded before any order refers to them). */
export function customerRows(org: OrgCfg): { customers: Row[]; consents: Row[] } {
  const customers: Row[] = [];
  const consents: Row[] = [];
  for (const b of org.branches) {
    const { size } = poolFor(org);
    for (let i = 0; i < size; i++) {
      const id = custIds.customer(org, b, i);
      customers.push({
        id,
        org_id: detId('org', org.key),
        phone: phoneOf(org, b, i),
        first_seen_at: `${FIRST_DATE}T06:00:00Z`,
      });
      const r = makeRng('consent', org.key, b.key, i);
      const roll = r.next();
      if (roll < 0.65 || roll >= 0.95)
        consents.push({
          id: detId('consent', org.key, b.key, i),
          org_id: detId('org', org.key),
          customer_id: id,
          channel: 'whatsapp',
          purpose: 'marketing',
          granted: roll < 0.65,
          source: 'pos',
          recorded_at: `${FIRST_DATE}T06:00:00Z`,
        });
    }
  }
  return { customers, consents };
}

const cumulative = new Map<string, number[]>();
function weights(org: OrgCfg, b: BranchCfg, lapsed: boolean): number[] {
  const key = `${org.key}/${b.key}/${lapsed}`;
  let c = cumulative.get(key);
  if (c) return c;
  const { size, regulars } = poolFor(org);
  c = [];
  let sum = 0;
  for (let i = 0; i < size; i++) {
    sum += i < regulars ? (lapsed ? LAPSE.regularWeight : REGULAR_WEIGHT) : 1;
    c.push(sum);
  }
  cumulative.set(key, c);
  return c;
}

/** The customer on an order, or null when it was not identified. */
export function customerFor(
  org: OrgCfg,
  b: BranchCfg,
  date: string,
  orderNumber: number,
  channel: string,
): string | null {
  if (channel === 'foodpanda' || channel === 'pathao_food') return null;
  const r = makeRng('order-customer', org.key, b.key, date, orderNumber);
  if (!r.chance(IDENTIFIED_SHARE)) return null;
  const lapsed = org.key === LAPSE.org && b.key === LAPSE.branch && date >= LAPSE.from;
  const c = weights(org, b, lapsed);
  const x = r.next() * c[c.length - 1]!;
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid]! > x) hi = mid;
    else lo = mid + 1;
  }
  return custIds.customer(org, b, lo);
}

const iso = (ms: number) => new Date(ms).toISOString();
const COMMENTS = {
  good: [
    'Great kacchi, will come again',
    'খুব ভালো লেগেছে',
    'Delicious tehari',
    'darun hoise',
    'Loved the borhani',
  ],
  slow: [
    'Food took too long to come',
    'খাবার আসতে অনেক দেরি হয়েছে',
    'Very slow service tonight',
    'waited 40 minutes',
  ],
  other: ['Kacchi was a bit cold', 'Too salty today', 'খাবার ঠান্ডা ছিল'],
};

/** Feedback (a quarter of identified dine-in orders answer) and the few that also become reviews. */
export function feedbackFor(args: {
  org: OrgCfg;
  b: BranchCfg;
  date: string;
  orderNumber: number;
  orderId: string;
  customerId: string;
  paidMs: number;
  placedMs: number;
  netPoisha: number;
}): { feedback: Row | null; review: Row | null } {
  const { org, b, date, orderNumber } = args;
  const r = makeRng('feedback', org.key, b.key, date, orderNumber);
  if (!r.chance(0.25)) return { feedback: null, review: null };
  const slow = inSlowSlot(org, b, args.placedMs);
  const rating = slow
    ? r.int(3, 6)
    : r.weighted(
        [10, 9, 8, 7, 6, 5, 4],
        (x) => ({ 10: 30, 9: 30, 8: 20, 7: 10, 6: 5, 5: 3, 4: 2 })[x]!,
      );
  const comment = slow
    ? r.chance(0.7)
      ? r.pick(COMMENTS.slow)
      : null
    : r.chance(0.35)
      ? r.pick(COMMENTS.good)
      : r.chance(0.08)
        ? r.pick(COMMENTS.other)
        : null;
  const submittedMs = args.paidMs + r.int(20, 90) * 60_000;
  const feedback: Row = {
    id: detId('feedback', org.key, b.key, date, orderNumber),
    org_id: detId('org', org.key),
    branch_id: detId('branch', org.key, b.key),
    order_id: args.orderId,
    customer_id: args.customerId,
    token_hash: `seed:${detId('feedback-token', org.key, b.key, date, orderNumber)}`,
    rating,
    comment,
    sent_at: iso(args.paidMs + 10 * 60_000),
    submitted_at: iso(submittedMs),
  };
  const review: Row | null =
    comment && r.chance(slow ? 0.5 : 0.12)
      ? {
          id: detId('review', org.key, b.key, date, orderNumber),
          org_id: detId('org', org.key),
          branch_id: detId('branch', org.key, b.key),
          source: rating >= 7 ? 'google' : 'facebook',
          external_id: detId('review-ext', org.key, b.key, date, orderNumber),
          rating,
          body: comment,
          author: rating >= 7 ? 'Google user' : 'Facebook user',
          reviewed_at: iso(submittedMs + 30 * 60_000),
        }
      : null;
  return { feedback, review };
}

/** S11: Dhanmondi, Friday, placed 20:00–21:59 Dhaka. */
export function inSlowSlot(org: OrgCfg, b: BranchCfg, placedMs: number): boolean {
  if (org.key !== S11_SLOT.org || b.key !== S11_SLOT.branch) return false;
  const local = new Date(placedMs + 6 * 3_600_000);
  const hour = local.getUTCHours();
  return (
    local.getUTCDay() === S11_SLOT.weekday && hour >= S11_SLOT.fromHour && hour < S11_SLOT.toHour
  );
}
