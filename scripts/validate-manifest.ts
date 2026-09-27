/**
 * `pnpm manifest:validate` — ROADMAP Phase 0 "manifest validates". Recomputes every ground-truth number in
 * supabase/seed/manifest.json from the database with independent SQL and fails on any difference.
 * Sums are exact (ADR 0006). Scenarios above SEED_PHASE (default 0) are reported as pending, not failed.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { computeLine, mulBps } from '../src/lib/money';
import { MANIFEST_PATH } from './seed/build';
import { ANCHOR_DATE, CUTOFF_MINUTES, ORGS, type OrgCfg } from './seed/config';
import { ids } from './seed/generate';
import { COUNT_WEEKDAY, INVENTORY, invIds } from './seed/inventory';
import { QTY_ITEM } from './seed/ledger';
import { excessOverBaseline, ManifestSchema, rateRatioX100, type Manifest } from './seed/manifest';

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const phase = Number(process.env.SEED_PHASE ?? 0);
const manifest: Manifest = ManifestSchema.parse(
  JSON.parse(readFileSync(process.env.MANIFEST_FILE ?? MANIFEST_PATH, 'utf8')),
);

const pool = new pg.Pool({ connectionString: url, max: 2 });
const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await pool.query(sql, params)).rows as T[];
const n = (v: unknown) => Number(v ?? 0);

const failures: string[] = [];
/** JSON with object keys sorted, so two equal objects compare equal regardless of key order. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
const check = (path: string, expected: unknown, actual: unknown) => {
  if (canonical(expected) !== canonical(actual)) {
    failures.push(`${path}: manifest ${canonical(expected)} ≠ database ${canonical(actual)}`);
  }
};
const checkAll = (
  path: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) => {
  for (const key of Object.keys(expected)) {
    // Descriptive facts ("staff": "rafiq") label a scenario; only numbers are recomputed from the database.
    if (typeof expected[key] === 'string') continue;
    check(`${path}.${key}`, expected[key], actual[key]);
  }
};

async function branchFacts(org: OrgCfg, branchKey: string) {
  const b = org.branches.find((x) => x.key === branchKey)!;
  const branchId = ids.branch(org, b);
  const [t] = await q(
    `select count(*) filter (where order_status = 'completed') as orders_completed,
            count(*) filter (where order_status = 'cancelled') as orders_cancelled,
            coalesce(sum(net_before_discount_poisha) filter (where order_status = 'completed'), 0) as gross_poisha,
            coalesce(sum(discount_net_poisha) filter (where order_status = 'completed'), 0) as discount_net_poisha,
            coalesce(sum(net_poisha) filter (where order_status = 'completed'), 0) as net_poisha,
            coalesce(sum(vat_poisha) filter (where order_status = 'completed'), 0) as vat_poisha,
            coalesce(sum(service_charge_poisha) filter (where order_status = 'completed'), 0) as service_charge_poisha,
            coalesce(sum(total_poisha) filter (where order_status = 'completed'), 0) as total_poisha
     from public.orders where org_id = $1 and branch_id = $2`,
    [ids.org(org), branchId],
  );
  const [p] = await q(
    `select coalesce(sum(amount_poisha), 0) as s from public.payments where org_id = $1 and branch_id = $2`,
    [ids.org(org), branchId],
  );
  const channels = await q<{ kind: string; orders: string; net: string }>(
    `select c.kind::text as kind, count(*) as orders, sum(o.net_poisha) as net
     from public.orders o join public.channels c on c.org_id = o.org_id and c.id = o.channel_id
     where o.org_id = $1 and o.branch_id = $2 and o.order_status = 'completed' group by c.kind order by c.kind`,
    [ids.org(org), branchId],
  );
  const itemId = ids.item(
    org,
    org.menu.find((m) => m.key === QTY_ITEM[org.key])!,
  );
  const [w] = await q(
    `select coalesce(sum(oi.quantity), 0) as total,
            coalesce(sum(oi.quantity) filter (where o.placed_at > $4::timestamptz - interval '2 hours' and o.placed_at <= $4::timestamptz), 0) as last_2h,
            coalesce(sum(oi.quantity) filter (where o.business_date = $5::date), 0) as today,
            coalesce(sum(oi.quantity) filter (where o.business_date = $5::date - 1), 0) as yesterday,
            coalesce(sum(oi.quantity) filter (where o.business_date between $5::date - 6 and $5::date), 0) as last_7d,
            coalesce(sum(oi.quantity) filter (where o.business_date between date_trunc('month', $5::date)::date and $5::date), 0) as month_to_date
     from public.order_items oi join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
     where oi.org_id = $1 and oi.branch_id = $2 and oi.menu_item_id = $3 and oi.status = 'active'`,
    [ids.org(org), branchId, itemId, manifest.frozen_now, manifest.anchor_date],
  );
  return {
    orders_completed: n(t!.orders_completed),
    orders_cancelled: n(t!.orders_cancelled),
    gross_poisha: n(t!.gross_poisha),
    discount_net_poisha: n(t!.discount_net_poisha),
    net_poisha: n(t!.net_poisha),
    vat_poisha: n(t!.vat_poisha),
    service_charge_poisha: n(t!.service_charge_poisha),
    total_poisha: n(t!.total_poisha),
    payments_poisha: n(p!.s),
    by_channel: Object.fromEntries(
      channels.map((c) => [c.kind, { orders: n(c.orders), net_poisha: n(c.net) }]),
    ),
    item_qty: {
      last_2h: n(w!.last_2h),
      today: n(w!.today),
      yesterday: n(w!.yesterday),
      last_7d: n(w!.last_7d),
      month_to_date: n(w!.month_to_date),
      total: n(w!.total),
    },
  };
}

/**
 * Phase 3: units, net and recipe cost of completed orders' active lines, costed independently of the
 * product's costing functions — straight from recipe_lines and ingredient_price_history.
 */
async function itemCosts(
  org: OrgCfg,
  from: string,
  to: string,
  opts: { itemKey?: string; channel?: string } = {},
) {
  const itemFilter = opts.itemKey
    ? ids.item(
        org,
        org.menu.find((m) => m.key === opts.itemKey)!,
      )
    : null;
  return q<{ menu_item_id: string; branch_id: string; units: string; net: string; cost: string }>(
    `with line as (
       select oi.menu_item_id, o.branch_id, o.business_date, oi.quantity, oi.net_poisha
         from public.order_items oi
         join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
         join public.channels ch on ch.org_id = o.org_id and ch.id = o.channel_id
        where oi.org_id = $1 and oi.status = 'active' and o.order_status = 'completed'
          and o.business_date between $2::date and $3::date
          and ($4::uuid is null or oi.menu_item_id = $4::uuid)
          and ($5::text is null or ch.kind::text = $5::text)
     ), unit as (
       select k.menu_item_id, k.business_date,
              sum(rl.qty_base * 100 / rl.yield_pct *
                  (select h.cost_poisha::numeric / h.per_base_qty from public.ingredient_price_history h
                    where h.org_id = r.org_id and h.ingredient_id = rl.ingredient_id and h.effective_from <= k.business_date
                    order by h.effective_from desc limit 1)) as unit_cost
         from (select distinct menu_item_id, business_date from line) k
         join public.recipes r on r.org_id = $1 and r.menu_item_id = k.menu_item_id and r.status = 'active'
         join public.recipe_lines rl on rl.org_id = r.org_id and rl.recipe_id = r.id
        group by k.menu_item_id, k.business_date
     )
     select line.menu_item_id, line.branch_id, sum(line.quantity) as units, sum(line.net_poisha) as net,
            sum(round(unit.unit_cost * line.quantity)) as cost
       from line join unit on unit.menu_item_id = line.menu_item_id and unit.business_date = line.business_date
      group by line.menu_item_id, line.branch_id`,
    [ids.org(org), from, to, itemFilter, opts.channel ?? null],
  );
}

/**
 * Phase 5: what was recorded for one branch per ingredient over (from, to] — purchases, recorded
 * transfers, waste (menu-item waste through its recipe) and theoretical usage of sold lines — straight
 * from the tables, independent of private.m_stock_moves.
 */
async function stockObservables(org: OrgCfg, branchKey: string, from: string, to: string) {
  const b = org.branches.find((x) => x.key === branchKey)!;
  const rows = await q<{ ingredient_id: string; kind: string; qty: string; value: string }>(
    `select pl.ingredient_id, 'purchase' as kind, sum(pl.qty_base) as qty, sum(pl.line_total_poisha) as value
       from public.purchase_lines pl join public.purchases p on p.id = pl.purchase_id
      where p.org_id = $1 and p.branch_id = $2 and p.status = 'confirmed' and p.purchased_on > $3::date and p.purchased_on <= $4::date
      group by 1
     union all
     select tl.ingredient_id, 'out', sum(tl.qty_base_sent), 0
       from public.transfer_lines tl join public.transfers t on t.id = tl.transfer_id
      where t.org_id = $1 and t.from_branch_id = $2 and t.status <> 'draft' and t.sent_on > $3::date and t.sent_on <= $4::date
      group by 1
     union all
     select tl.ingredient_id, 'in', sum(tl.qty_base_received), 0
       from public.transfer_lines tl join public.transfers t on t.id = tl.transfer_id
      where t.org_id = $1 and t.to_branch_id = $2 and t.status in ('received', 'disputed')
        and t.received_on > $3::date and t.received_on <= $4::date
      group by 1
     union all
     select w.ingredient_id, 'waste', sum(w.qty_base), 0 from public.waste_logs w
      where w.org_id = $1 and w.branch_id = $2 and w.ingredient_id is not null and w.business_date > $3::date and w.business_date <= $4::date
      group by 1
     union all
     select rl.ingredient_id, 'waste', sum(w.qty_portions * rl.qty_base * 100 / rl.yield_pct), 0
       from public.waste_logs w
       join public.recipes r on r.org_id = w.org_id and r.menu_item_id = w.menu_item_id and r.status = 'active'
       join public.recipe_lines rl on rl.recipe_id = r.id
      where w.org_id = $1 and w.branch_id = $2 and w.ingredient_id is null and w.business_date > $3::date and w.business_date <= $4::date
      group by 1
     union all
     select rl.ingredient_id, 'usage', sum(oi.quantity * rl.qty_base * 100 / rl.yield_pct), 0
       from public.order_items oi
       join public.orders o on o.id = oi.order_id
       join public.recipes r on r.org_id = oi.org_id and r.menu_item_id = oi.menu_item_id and r.status = 'active'
       join public.recipe_lines rl on rl.recipe_id = r.id
      where oi.org_id = $1 and oi.branch_id = $2 and oi.status = 'active' and o.order_status = 'completed'
        and o.business_date > $3::date and o.business_date <= $4::date
      group by 1`,
    [ids.org(org), ids.branch(org, b), from, to],
  );
  const out = new Map<string, Record<string, number>>();
  for (const key of Object.keys(INVENTORY[org.key]!.supply)) {
    const id = invIds.ingredient(org, key);
    const sum = (kind: string, col: 'qty' | 'value' = 'qty') =>
      rows
        .filter((r) => r.ingredient_id === id && r.kind === kind)
        .reduce((s, r) => s + n(r[col]), 0);
    out.set(key, {
      purchases_qty: sum('purchase'),
      purchases_poisha: sum('purchase', 'value'),
      transfers_in_qty: sum('in'),
      transfers_out_qty: sum('out'),
      usage_theoretical_qty: sum('usage'),
      waste_qty: sum('waste'),
    });
  }
  return out;
}

async function countOn(org: OrgCfg, branchKey: string, date: string) {
  const b = org.branches.find((x) => x.key === branchKey)!;
  const rows = await q<{ ingredient_id: string; qty: string }>(
    `select l.ingredient_id, l.counted_qty_base as qty from public.stock_count_lines l
       join public.stock_counts c on c.id = l.stock_count_id
      where c.org_id = $1 and c.branch_id = $2 and c.counted_on = $3::date and c.status = 'submitted'`,
    [ids.org(org), ids.branch(org, b), date],
  );
  return new Map(rows.map((r) => [r.ingredient_id, n(r.qty)]));
}

/** Phase 5 ground truth: variance over the period, stock and cover at the anchor, discipline by day. */
async function inventoryFacts() {
  const inv = manifest.inventory;
  for (const org of ORGS) {
    const expected = inv.orgs[org.key];
    if (!expected) continue;
    for (const b of org.branches) {
      const e = expected.branches[b.key]!;
      const path = `inventory.${org.key}.${b.key}`;
      const open = await countOn(org, b.key, inv.period.from);
      const close = await countOn(org, b.key, inv.period.to);
      const moves = await stockObservables(org, b.key, inv.period.from, inv.period.to);
      for (const [ing, ev] of Object.entries(e.variance)) {
        const id = invIds.ingredient(org, ing);
        const m = moves.get(ing)!;
        const actual =
          open.get(id)! +
          m.purchases_qty! +
          m.transfers_in_qty! -
          m.transfers_out_qty! -
          close.get(id)!;
        checkAll(`${path}.variance.${ing}`, ev, {
          opening_qty: open.get(id),
          closing_qty: close.get(id),
          ...m,
          usage_actual_qty: actual,
          variance_qty: actual - m.usage_theoretical_qty! - m.waste_qty!,
        });
      }
      const use14 = await stockObservables(
        org,
        b.key,
        addDaysIso(manifest.anchor_date, -14),
        manifest.anchor_date,
      );
      for (const [ing, es] of Object.entries(e.stock)) {
        const id = invIds.ingredient(org, ing);
        const last = await countOn(org, b.key, es.last_count_date);
        const since = (
          await stockObservables(org, b.key, es.last_count_date, manifest.anchor_date)
        ).get(ing)!;
        check(
          `${path}.stock.${ing}.stock_qty`,
          es.stock_qty,
          last.get(id)! +
            since.purchases_qty! +
            since.transfers_in_qty! -
            since.transfers_out_qty! -
            since.usage_theoretical_qty! -
            since.waste_qty!,
        );
        check(
          `${path}.stock.${ing}.usage_14d_qty`,
          es.usage_14d_qty,
          use14.get(ing)!.usage_theoretical_qty,
        );
      }
      const [transit] = await q(
        `select coalesce(sum(tl.qty_base_sent), 0) as q from public.transfer_lines tl join public.transfers t on t.id = tl.transfer_id
          where t.org_id = $1 and t.to_branch_id = $2 and t.status = 'sent'`,
        [ids.org(org), ids.branch(org, b)],
      );
      check(
        `${path}.in_transit`,
        Object.values(e.stock).reduce((s, x) => s + x.in_transit_qty, 0),
        n(transit!.q),
      );
      for (const [date, score] of Object.entries(e.discipline)) {
        const [d] = await q(
          `select exists (select 1 from public.purchases where org_id = $1 and branch_id = $2 and purchased_on = $3::date and status = 'confirmed') as bazar,
                  exists (select 1 from public.waste_logs where org_id = $1 and branch_id = $2 and business_date = $3::date) as waste,
                  (select count(*) > 0 and bool_and(status = 'closed') from public.shifts where org_id = $1 and branch_id = $2 and business_date = $3::date) as cash,
                  exists (select 1 from public.stock_counts where org_id = $1 and branch_id = $2 and counted_on = $3::date and status = 'submitted') as counted`,
          [ids.org(org), ids.branch(org, b), date],
        );
        const due = new Date(`${date}T00:00:00Z`).getUTCDay() === COUNT_WEEKDAY;
        check(
          `${path}.discipline.${date}`,
          score,
          (d!.bazar ? 25 : 0) +
            (d!.waste ? 15 : 0) +
            (d!.cash ? 20 : 0) +
            (!due || d!.counted ? 25 : 0) +
            15,
        );
      }
    }
  }
}

function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function staffCounts(org: OrgCfg, branchKey: string, staffKeys: string[]) {
  const b = org.branches.find((x) => x.key === branchKey)!;
  const staffIds = staffKeys.map((k) =>
    ids.staff(
      org,
      b,
      b.staff.find((s) => s.key === k)!,
    ),
  );
  const [o] = await q(
    `select count(*) as c from public.orders where org_id = $1 and staff_id = any($2::uuid[])`,
    [ids.org(org), staffIds],
  );
  const [v] = await q(
    `select count(*) as c, coalesce(sum(value_poisha), 0) as v from public.voids where org_id = $1 and after_kot and voided_by_staff_id = any($2::uuid[])`,
    [ids.org(org), staffIds],
  );
  const [d] = await q(
    `select count(*) as c, coalesce(sum(amount_poisha), 0) as v, count(*) filter (where reason_code_id is null) as noreason
     from public.discounts where org_id = $1 and applied_by_staff_id = any($2::uuid[])`,
    [ids.org(org), staffIds],
  );
  return {
    orders: n(o!.c),
    voidCount: n(v!.c),
    voidValue: n(v!.v),
    discountCount: n(d!.c),
    discountPoisha: n(d!.v),
    noReason: n(d!.noreason),
  };
}

try {
  // Manifest header.
  check('anchor_date', manifest.anchor_date, ANCHOR_DATE);
  check('cutoff_minutes', manifest.cutoff_minutes, CUTOFF_MINUTES);

  // Independent invariants that need no manifest. Scoped to the demo organizations: a shared database
  // (CI runs the DB tests first) also holds test orgs whose orders are stamped with the real current time.
  const demoOrgs = ORGS.map((o) => ids.org(o));
  const [badDates] = await q(
    `select count(*) as c from public.orders
     where org_id = any($2::uuid[]) and business_date <> private.business_date(placed_at, $1)`,
    [CUTOFF_MINUTES, demoOrgs],
  );
  check('invariant: orders.business_date agrees with private.business_date()', 0, n(badDates!.c));
  const [unpaid] = await q(
    `select count(*) as c from public.orders o
     where o.org_id = any($1::uuid[]) and o.order_status = 'completed'
       and o.total_poisha <> (select coalesce(sum(p.amount_poisha), 0) from public.payments p where p.order_id = o.id)`,
    [demoOrgs],
  );
  check('invariant: every completed order is paid in full', 0, n(unpaid!.c));
  const [afterNow] = await q(
    `select count(*) as c from public.orders where org_id = any($2::uuid[]) and placed_at > $1::timestamptz`,
    [manifest.frozen_now, demoOrgs],
  );
  check('invariant: no order after the frozen now', 0, n(afterNow!.c));

  // Per-branch and per-org totals.
  for (const org of ORGS) {
    const expected = manifest.orgs[org.key]!;
    for (const b of org.branches) {
      const actual = await branchFacts(org, b.key);
      const e = expected.branches[b.key]!;
      const path = `orgs.${org.key}.branches.${b.key}`;
      const { by_channel: expectedChannels, item_qty: expectedQty, ...expectedTotals } = e;
      checkAll(path, expectedTotals, actual);
      check(`${path}.by_channel`, expectedChannels, actual.by_channel);
      check(`${path}.item_qty`, expectedQty, actual.item_qty);
    }
    check(
      `orgs.${org.key}.price_includes_vat`,
      expected.price_includes_vat,
      (
        await q(`select price_includes_vat as v from public.org_settings where org_id = $1`, [
          ids.org(org),
        ])
      )[0]!.v,
    );
  }

  // Scenarios.
  const kacchi = ORGS.find((o) => o.key === 'demo_kacchi_house')!;
  const cafe = ORGS.find((o) => o.key === 'demo_cafe')!;
  const pending: string[] = [];
  for (const s of manifest.scenarios) {
    if (s.status === 'pending' || s.available_from_phase > phase) {
      pending.push(s.id);
      continue;
    }
    const f = s.facts as Record<string, unknown>;
    if (s.id === 'S1') {
      const staff = await staffCounts(kacchi, 'mirpur', ['rafiq']);
      const peers = await staffCounts(kacchi, 'mirpur', ['kamal', 'shirin', 'anwar']);
      checkAll('S1', f, {
        staff_orders: staff.orders,
        staff_void_count: staff.voidCount,
        staff_void_value_poisha: staff.voidValue,
        peer_orders: peers.orders,
        peer_void_count: peers.voidCount,
        peer_void_value_poisha: peers.voidValue,
        void_rate_ratio_x100: rateRatioX100(
          staff.voidCount,
          staff.orders,
          peers.voidCount,
          peers.orders,
        ),
        excess_void_value_poisha: excessOverBaseline(
          staff.voidValue,
          staff.orders,
          peers.voidValue,
          peers.orders,
        ),
      });
    } else if (s.id === 'S2') {
      const staff = await staffCounts(kacchi, 'uttara', ['habib']);
      const peers = await staffCounts(kacchi, 'uttara', ['liton', 'rima', 'sohel']);
      checkAll('S2', f, {
        staff_orders: staff.orders,
        staff_discount_count: staff.discountCount,
        staff_discount_poisha: staff.discountPoisha,
        staff_discounts_without_reason: staff.noReason,
        peer_orders: peers.orders,
        peer_discount_count: peers.discountCount,
        peer_discount_poisha: peers.discountPoisha,
        peer_discounts_without_reason: peers.noReason,
        discount_rate_ratio_x100: rateRatioX100(
          staff.discountCount,
          staff.orders,
          peers.discountCount,
          peers.orders,
        ),
        excess_discount_poisha: excessOverBaseline(
          staff.discountPoisha,
          staff.orders,
          peers.discountPoisha,
          peers.orders,
        ),
      });
      const [thursdays] = await q(
        `select count(*) as c, count(*) filter (where extract(dow from business_date) = 4) as thu from public.orders where org_id = $1 and staff_id = $2`,
        [
          ids.org(kacchi),
          ids.staff(
            kacchi,
            kacchi.branches[2]!,
            kacchi.branches[2]!.staff.find((x) => x.key === 'habib')!,
          ),
        ],
      );
      check(
        'S2: every order the manager rang up was on a Thursday',
        n(thursdays!.c),
        n(thursdays!.thu),
      );
    } else if (s.id === 'S3') {
      const branches = f.branches as Record<string, Record<string, number>>;
      const bps = f.foodpanda_commission_bps as number;
      for (const b of kacchi.branches) {
        const [fp] = await q(
          `select count(*) as c, coalesce(sum(o.net_poisha), 0) as net from public.orders o join public.channels ch on ch.org_id = o.org_id and ch.id = o.channel_id
           where o.org_id = $1 and o.branch_id = $2 and ch.kind = 'foodpanda' and o.order_status = 'completed'`,
          [ids.org(kacchi), ids.branch(kacchi, b)],
        );
        const comboId = ids.item(
          kacchi,
          kacchi.menu.find((m) => m.key === 'family_combo')!,
        );
        const [units] = await q(
          `select coalesce(sum(oi.quantity), 0) as total,
                  coalesce(sum(oi.quantity) filter (where ch.kind = 'foodpanda'), 0) as fp
           from public.order_items oi join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
                join public.channels ch on ch.org_id = o.org_id and ch.id = o.channel_id
           where oi.org_id = $1 and oi.branch_id = $2 and oi.menu_item_id = $3 and oi.status = 'active'`,
          [ids.org(kacchi), ids.branch(kacchi, b), comboId],
        );
        checkAll(`S3.${b.key}`, branches[b.key]!, {
          foodpanda_orders: n(fp!.c),
          foodpanda_net_poisha: n(fp!.net),
          foodpanda_commission_poisha: mulBps(n(fp!.net), bps),
          combo_units_via_foodpanda: n(units!.fp),
          combo_units_total: n(units!.total),
        });
      }
      const [commission] = await q(
        `select commission_bps as bps from public.channel_commissions cc join public.channels ch on ch.org_id = cc.org_id and ch.id = cc.channel_id
         where cc.org_id = $1 and ch.kind = 'foodpanda'`,
        [ids.org(kacchi)],
      );
      check('S3.foodpanda_commission_bps (configured in the database)', bps, n(commission!.bps));

      // Phase 3: with its recipe cost the combo loses money on foodpanda.
      if (phase >= 3) {
        const fm = f.full_margin as { branches: Record<string, Record<string, number>> };
        const rows = await itemCosts(kacchi, manifest.first_date, manifest.anchor_date, {
          itemKey: 'family_combo',
          channel: 'foodpanda',
        });
        for (const b of kacchi.branches) {
          const r = rows.find((x) => x.branch_id === ids.branch(kacchi, b));
          const net = n(r?.net);
          const cost = n(r?.cost);
          checkAll(`S3.full_margin.${b.key}`, fm.branches[b.key]!, {
            units: n(r?.units),
            net_poisha: net,
            cost_poisha: cost,
            commission_poisha: mulBps(net, bps),
            loss_poisha: cost + mulBps(net, bps) - net,
          });
        }
      }

      // The combo's printed price and VAT-exclusive unit value, recomputed from the database's own settings.
      const [combo] = await q(
        `select mi.base_price_poisha as price, s.price_includes_vat as inc, s.vat_rate_bps as vat
         from public.menu_items mi join public.org_settings s on s.org_id = mi.org_id
         where mi.id = $1`,
        [
          ids.item(
            kacchi,
            kacchi.menu.find((m) => m.key === 'family_combo')!,
          ),
        ],
      );
      const netUnit = computeLine(
        { unitPricePoisha: n(combo!.price), quantity: 1 },
        {
          priceIncludesVat: combo!.inc === true,
          vatRateBps: n(combo!.vat),
          serviceChargeBps: 0,
          vatOnServiceCharge: false,
        },
      ).netPoisha;
      check('S3.combo_printed_price_poisha', f.combo_printed_price_poisha, n(combo!.price));
      check('S3.combo_net_unit_poisha', f.combo_net_unit_poisha, netUnit);
      check(
        'S3.combo_commission_per_unit_poisha',
        f.combo_commission_per_unit_poisha,
        mulBps(netUnit, bps),
      );
    } else if (s.id === 'S4') {
      const target = n(f.target_food_cost_bps);
      const branches = f.branches as Record<string, Record<string, Record<string, number>>>;
      const spikeFrom = String(f.spike_from);
      const spikeTo = String(f.spike_to);
      const beforeFrom = new Date(Date.parse(`${spikeFrom}T00:00:00Z`) - 28 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const beforeTo = new Date(Date.parse(`${spikeFrom}T00:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10);
      const windowFacts = (rows: Awaited<ReturnType<typeof itemCosts>>, branchId: string) => {
        const r = rows.find((x) => x.branch_id === branchId);
        const net = n(r?.net);
        const cost = n(r?.cost);
        return {
          units: n(r?.units),
          net_poisha: net,
          cost_poisha: cost,
          food_cost_bps: net > 0 ? Math.round((cost * 10000) / net) : 0,
          excess_over_target_poisha: cost - mulBps(net, target),
        };
      };
      const spike = await itemCosts(kacchi, spikeFrom, spikeTo, { itemKey: 'tehari' });
      const before = await itemCosts(kacchi, beforeFrom, beforeTo, { itemKey: 'tehari' });
      for (const b of kacchi.branches) {
        checkAll(
          `S4.${b.key}.spike`,
          branches[b.key]!.spike!,
          windowFacts(spike, ids.branch(kacchi, b)),
        );
        checkAll(
          `S4.${b.key}.before`,
          branches[b.key]!.before!,
          windowFacts(before, ids.branch(kacchi, b)),
        );
      }
      const [t] = await q(
        `select target_food_cost_bps as t from public.org_cost_settings where org_id = $1`,
        [ids.org(kacchi)],
      );
      check('S4.target_food_cost_bps (configured in the database)', target, n(t!.t));
    } else if (s.id === 'S5') {
      const rows = await itemCosts(kacchi, manifest.first_date, manifest.anchor_date);
      const byItem = new Map<string, { units: number; net: number; cost: number }>();
      for (const r of rows) {
        const a = byItem.get(r.menu_item_id) ?? { units: 0, net: 0, cost: 0 };
        a.units += n(r.units);
        a.net += n(r.net);
        a.cost += n(r.cost);
        byItem.set(r.menu_item_id, a);
      }
      const sold = kacchi.menu
        .map((m) => ({
          key: m.key,
          ...(byItem.get(ids.item(kacchi, m)) ?? { units: 0, net: 0, cost: 0 }),
        }))
        .filter((i) => i.units > 0);
      const units = sold.reduce((sum, i) => sum + i.units, 0);
      const cmAll = sold.reduce((sum, i) => sum + (i.net - i.cost), 0);
      const matrix = Object.fromEntries(
        sold.map((i) => {
          const popular = i.units * sold.length * 10 >= 7 * units;
          const profitable = (i.net - i.cost) * units >= cmAll * i.units;
          return [
            i.key,
            popular ? (profitable ? 'star' : 'plowhorse') : profitable ? 'puzzle' : 'dog',
          ];
        }),
      );
      check('S5.items_sold', f.items_sold, sold.length);
      check('S5.units_sold', f.units_sold, units);
      check('S5.matrix', f.matrix, matrix);
    } else if (s.id === 'S6' || s.id === 'S7' || s.id === 'S9') {
      // The planted truth (what moved, the extra grams) is not in the database by design; what the
      // database must show is the variance it causes, checked with the rest of the stock facts below.
      const v = manifest.inventory.orgs[kacchi.key]!.branches;
      const branch = String(s.id === 'S6' ? f.from_branch : s.branch);
      const ing = String(f.ingredient_key);
      check(
        `${s.id}.variance_qty`,
        s.id === 'S6' ? f.from_variance_qty : f.variance_qty,
        v[branch]!.variance[ing]!.variance_qty,
      );
      if (s.id === 'S6')
        check(
          'S6.to_variance_qty',
          f.to_variance_qty,
          v[String(f.to_branch)]!.variance[ing]!.variance_qty,
        );
    } else if (s.id === 'S8') {
      const days = f.days as { date: string; qty: number; paid: number }[];
      const b = kacchi.branches.find((x) => x.key === s.branch)!;
      for (const d of days) {
        const [row] = await q(
          `select coalesce(sum(pl.qty_base), 0) as qty, coalesce(sum(pl.line_total_poisha), 0) as paid
             from public.purchase_lines pl join public.purchases p on p.id = pl.purchase_id
            where p.org_id = $1 and p.branch_id = $2 and p.purchased_on = $3::date and pl.ingredient_id = $4 and p.status = 'confirmed'`,
          [
            ids.org(kacchi),
            ids.branch(kacchi, b),
            d.date,
            invIds.ingredient(kacchi, String(f.ingredient_key)),
          ],
        );
        check(
          `S8.${d.date}`,
          { qty: d.qty, paid: d.paid },
          { qty: n(row!.qty), paid: n(row!.paid) },
        );
      }
    } else if (s.id === 'S10') {
      // Closures have no orders; the iftar shift shows in the 16:00–19:00 share; rain days are flagged.
      const [closed] = await q(
        `select count(*) as c from public.orders where org_id = any($1::uuid[]) and business_date = any($2::date[])`,
        [demoOrgs, f.eid_closures],
      );
      check('S10.orders_on_closures', f.orders_on_closures, n(closed!.c));
      const share = async (w: { from: string; to: string }) => {
        const [r] = await q(
          `select coalesce(sum(oi.quantity) filter (where extract(hour from o.placed_at at time zone 'Asia/Dhaka') between 16 and 18), 0) as s,
                  coalesce(sum(oi.quantity), 0) as a
             from public.order_items oi join public.orders o on o.id = oi.order_id
            where o.org_id = $1 and o.order_status = 'completed' and oi.status = 'active'
              and o.business_date between $2::date and $3::date`,
          [ids.org(kacchi), w.from, w.to],
        );
        return n(r!.a) > 0 ? Math.round((n(r!.s) * 10000) / n(r!.a)) : 0;
      };
      check(
        'S10.snacks_share_ramadan_bps',
        f.snacks_share_ramadan_bps,
        await share(f.ramadan_window as { from: string; to: string }),
      );
      check(
        'S10.snacks_share_before_bps',
        f.snacks_share_before_bps,
        await share(f.before_window as { from: string; to: string }),
      );
      for (const o of ORGS) {
        const [r] = await q(
          `select count(*) as c from public.calendar_events where org_id = $1 and kind = 'weather'`,
          [ids.org(o)],
        );
        check(`S10.rain_days.${o.key}`, (f.rain_days as Record<string, number>)[o.key], n(r!.c));
      }
    } else if (s.id === 'S11') {
      const b = kacchi.branches.find((x) => x.key === s.branch)!;
      const [r] = await q(
        `select count(*) as n, coalesce(sum(net_poisha), 0) as net from public.orders
          where org_id = $1 and branch_id = $2 and order_status = 'completed'
            and business_date between $3::date and $4::date
            and extract(dow from placed_at at time zone 'Asia/Dhaka') = $5
            and extract(hour from placed_at at time zone 'Asia/Dhaka') between $6 and $6 + 1`,
        [
          ids.org(kacchi),
          ids.branch(kacchi, b),
          f.period_from,
          f.period_to,
          f.weekday,
          f.from_hour,
        ],
      );
      check('S11.orders', f.orders, n(r!.n));
      check('S11.net_poisha', f.net_poisha, n(r!.net));
    } else if (s.id === 'S12') {
      const rows = await q<{ branch_id: string; regulars: string; lapsed: string }>(
        `with before as (
           select customer_id, min(branch_id::text) as branch_id, count(*) as visits from public.orders
            where org_id = $1 and customer_id is not null and order_status = 'completed'
              and business_date between $2::date - 90 and $2::date - 1
            group by customer_id)
         select b.branch_id, count(*) filter (where b.visits >= 4) as regulars,
                count(*) filter (where b.visits >= 4 and not exists (
                  select 1 from public.orders o where o.org_id = $1 and o.customer_id = b.customer_id
                     and o.order_status = 'completed' and o.business_date between $2::date and $3::date)) as lapsed
           from before b group by b.branch_id`,
        [ids.org(kacchi), f.period_from, f.period_to],
      );
      const expected = f.branches as Record<string, { regulars: number; lapsed: number }>;
      for (const b of kacchi.branches) {
        const r = rows.find((x) => x.branch_id === ids.branch(kacchi, b));
        check(`S12.${b.key}`, expected[b.key], { regulars: n(r?.regulars), lapsed: n(r?.lapsed) });
      }
    } else if (s.id === 'S13') {
      const staff = await staffCounts(cafe, 'gulshan', ['tania', 'imran', 'meherun']);
      checkAll('S13', f, {
        planted_anomalies: 0,
        orders: staff.orders,
        void_after_kot_count: staff.voidCount,
        void_value_poisha: staff.voidValue,
        discount_count: staff.discountCount,
        discount_poisha: staff.discountPoisha,
      });
    }
  }

  if (phase >= 5) await inventoryFacts();

  const validated = manifest.scenarios.filter((s) => !pending.includes(s.id)).map((s) => s.id);
  console.log(
    `Validated: ${validated.join(', ')}  (${ORGS.length} orgs, ${ORGS.reduce((c, o) => c + o.branches.length, 0)} branches)`,
  );
  console.log(
    `Pending (planted in a later phase): ${pending.join(', ') || 'none'}   [SEED_PHASE=${phase}]`,
  );
  if (failures.length > 0) {
    console.error(`\n${failures.length} mismatch(es) between the manifest and the database:`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log('✓ Manifest matches the database exactly.');
  }
} finally {
  await pool.end();
}
