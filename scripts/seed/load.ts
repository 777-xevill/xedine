/** Loads the generated dataset into Postgres. Superuser connection: this is seed data, not an app path. */
import type pg from 'pg';
import {
  CALENDAR,
  DEMO_PASSWORD,
  FIRST_DATE,
  FIXED_COSTS_PER_BRANCH,
  ANCHOR_DATE,
  SALARY_TAKA,
  type OrgCfg,
} from './config';
import { ids, REASON_CODES, type DayRows, type Row } from './generate';
import { COSTING } from './costing';
import { detId } from './rng';

type ColSpec = [name: string, type: string][];

const BATCH = 4000;

async function insertRows(
  client: pg.PoolClient,
  table: string,
  cols: ColSpec,
  rows: Row[],
): Promise<void> {
  if (rows.length === 0) return;
  const names = cols.map(([n]) => `"${n}"`).join(', ');
  const defs = cols.map(([n, t]) => `"${n}" ${t}`).join(', ');
  for (let i = 0; i < rows.length; i += BATCH) {
    await client.query(
      `insert into public.${table} (${names}) select ${names} from json_to_recordset($1::json) as x(${defs})`,
      [JSON.stringify(rows.slice(i, i + BATCH))],
    );
  }
}

const money = (n: string): [string, string] => [n, 'bigint'];
const amounts: ColSpec = [
  money('gross_poisha'),
  money('discount_poisha'),
  money('net_before_discount_poisha'),
  money('discount_net_poisha'),
  money('net_poisha'),
  money('vat_poisha'),
  money('service_charge_poisha'),
  money('total_poisha'),
];

const SPEC = {
  shifts: [
    ['id', 'uuid'],
    ['org_id', 'uuid'],
    ['branch_id', 'uuid'],
    ['opened_by_staff_id', 'uuid'],
    ['closed_by_staff_id', 'uuid'],
    ['status', 'public.shift_status'],
    ['opened_at', 'timestamptz'],
    ['closed_at', 'timestamptz'],
    ['business_date', 'date'],
    money('opening_float_poisha'),
    money('expected_cash_poisha'),
    money('counted_cash_poisha'),
    money('over_short_poisha'),
  ] as ColSpec,
  cash_counts: [
    ['id', 'uuid'],
    ['org_id', 'uuid'],
    ['branch_id', 'uuid'],
    ['shift_id', 'uuid'],
    ['kind', 'public.cash_count_kind'],
    ['counted_by_staff_id', 'uuid'],
    ['counted_at', 'timestamptz'],
    money('total_poisha'),
  ] as ColSpec,
  orders: [
    ['id', 'uuid'],
    ['org_id', 'uuid'],
    ['branch_id', 'uuid'],
    ['channel_id', 'uuid'],
    ['shift_id', 'uuid'],
    ['staff_id', 'uuid'],
    ['order_number', 'integer'],
    ['order_status', 'public.order_status'],
    ['payment_status', 'public.payment_status'],
    ['guests', 'integer'],
    ['placed_at', 'timestamptz'],
    ['received_at', 'timestamptz'],
    ['business_date', 'date'],
    ...amounts,
    ['price_includes_vat', 'boolean'],
    ['vat_rate_bps', 'integer'],
    ['service_charge_bps', 'integer'],
  ] as ColSpec,
  order_items: [
    ['id', 'uuid'],
    ['org_id', 'uuid'],
    ['branch_id', 'uuid'],
    ['order_id', 'uuid'],
    ['menu_item_id', 'uuid'],
    ['name_snapshot', 'text'],
    ['quantity', 'integer'],
    money('unit_price_poisha'),
    ...amounts,
    ['status', 'public.order_line_status'],
    ['kot_sent_at', 'timestamptz'],
  ] as ColSpec,
  order_events: [
    ['id', 'uuid'],
    ['org_id', 'uuid'],
    ['branch_id', 'uuid'],
    ['order_id', 'uuid'],
    ['event_type', 'public.order_event_type'],
    ['staff_id', 'uuid'],
    ['occurred_at', 'timestamptz'],
  ] as ColSpec,
  payments: [
    ['id', 'uuid'],
    ['org_id', 'uuid'],
    ['branch_id', 'uuid'],
    ['order_id', 'uuid'],
    ['shift_id', 'uuid'],
    ['staff_id', 'uuid'],
    ['method', 'public.payment_method'],
    money('amount_poisha'),
    ['received_at', 'timestamptz'],
  ] as ColSpec,
  discounts: [
    ['id', 'uuid'],
    ['org_id', 'uuid'],
    ['branch_id', 'uuid'],
    ['order_id', 'uuid'],
    money('amount_poisha'),
    ['percent_bps', 'integer'],
    ['reason_code_id', 'uuid'],
    ['applied_by_staff_id', 'uuid'],
    ['created_at', 'timestamptz'],
  ] as ColSpec,
  voids: [
    ['id', 'uuid'],
    ['org_id', 'uuid'],
    ['branch_id', 'uuid'],
    ['order_id', 'uuid'],
    ['order_item_id', 'uuid'],
    money('value_poisha'),
    ['after_kot', 'boolean'],
    ['after_payment', 'boolean'],
    ['reason_code_id', 'uuid'],
    ['voided_by_staff_id', 'uuid'],
    ['voided_at', 'timestamptz'],
  ] as ColSpec,
};

/** Rows for several days, flushed together in foreign-key order. */
export class DayBuffer {
  private rows: DayRows = {
    shifts: [],
    cash_counts: [],
    orders: [],
    order_items: [],
    order_events: [],
    payments: [],
    discounts: [],
    voids: [],
  };
  private count = 0;

  push(day: DayRows): void {
    for (const k of Object.keys(this.rows) as (keyof DayRows)[]) this.rows[k].push(...day[k]);
    this.count += day.orders.length;
  }

  get size(): number {
    return this.count;
  }

  async flush(client: pg.PoolClient): Promise<void> {
    for (const table of [
      'shifts',
      'cash_counts',
      'orders',
      'order_items',
      'order_events',
      'payments',
      'discounts',
      'voids',
    ] as const) {
      await insertRows(client, table, SPEC[table], this.rows[table]);
      this.rows[table] = [];
    }
    this.count = 0;
  }
}

const userId = (email: string) => detId('user', email);

export async function loadStatic(client: pg.PoolClient, org: OrgCfg): Promise<void> {
  const orgId = ids.org(org);
  const owner = org.users.find((u) => u.role === 'owner')!;

  for (const u of org.users) {
    await client.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change_token_new, email_change,
         email_change_token_current, phone_change, phone_change_token, reauthentication_token)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
         extensions.crypt($3, extensions.gen_salt('bf', 10)), now(),
         '{"provider":"email","providers":["email"]}', $4::jsonb, now(), now(), '', '', '', '', '', '', '', '')`,
      [userId(u.email), u.email, DEMO_PASSWORD, JSON.stringify({ full_name: u.fullName })],
    );
    await client.query(
      `insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
       values ($1::uuid, $1::uuid, $2::jsonb, 'email', $3::text, now(), now(), now())`,
      [
        userId(u.email),
        JSON.stringify({ sub: userId(u.email), email: u.email, email_verified: true }),
        userId(u.email),
      ],
    );
  }

  await client.query(
    `insert into public.organizations (id, name, slug, is_demo, created_by) values ($1, $2, $3, true, $4)`,
    [orgId, org.name, org.slug, userId(owner.email)],
  );
  await client.query(
    `insert into public.org_settings (org_id, price_includes_vat, vat_rate_bps, service_charge_bps, default_cutoff_minutes, default_locale)
     values ($1, $2, $3, $4, 240, 'en')`,
    [orgId, org.priceIncludesVat, org.vatRateBps, org.serviceChargeBps],
  );
  await client.query(
    `insert into public.org_profile (org_id, cuisine, format, city) values ($1, $2, $3, 'Dhaka')`,
    [orgId, org.cuisine, org.format],
  );
  await client.query(
    `insert into public.org_cost_settings (org_id, assumed_food_cost_bps, target_food_cost_bps) values ($1, $2, $3)`,
    [orgId, org.assumedFoodCostBps, COSTING[org.key]?.targetFoodCostBps ?? null],
  );

  for (const b of org.branches) {
    await client.query(
      `insert into public.branches (id, org_id, name, area, city) values ($1, $2, $3, $4, 'Dhaka')`,
      [ids.branch(org, b), orgId, b.name, b.area],
    );
    for (const s of b.staff) {
      await client.query(
        `insert into public.staff (id, org_id, branch_id, display_name, role) values ($1, $2, $3, $4, $5)`,
        [ids.staff(org, b, s), orgId, ids.branch(org, b), s.name, s.role],
      );
    }
    for (const f of FIXED_COSTS_PER_BRANCH) {
      await client.query(
        `insert into public.fixed_costs (org_id, branch_id, kind, label, monthly_poisha, effective_from) values ($1, $2, $3, $4, $5, $6)`,
        [orgId, ids.branch(org, b), f.kind, f.label, f.monthly, FIRST_DATE],
      );
    }
    for (const s of b.staff) {
      for (let m = FIRST_DATE.slice(0, 7); m <= ANCHOR_DATE.slice(0, 7); m = nextMonth(m)) {
        await client.query(
          `insert into public.salary_entries (org_id, branch_id, staff_id, month, salary_poisha) values ($1, $2, $3, $4, $5)`,
          [orgId, ids.branch(org, b), ids.staff(org, b, s), `${m}-01`, SALARY_TAKA[s.role] * 100],
        );
      }
    }
  }

  for (const u of org.users) {
    const [m] = (
      await client.query<{ id: string }>(
        `insert into public.memberships (user_id, org_id, role, branch_scope) values ($1, $2, $3, $4) returning id`,
        [userId(u.email), orgId, u.role, u.role === 'manager' ? 'list' : 'all'],
      )
    ).rows;
    if (u.role === 'manager') {
      const b = org.branches.find((x) => x.key === u.branchKey)!;
      await client.query(
        `insert into public.membership_branches (membership_id, branch_id, org_id) values ($1, $2, $3)`,
        [m!.id, ids.branch(org, b), orgId],
      );
    }
  }

  for (const c of org.channels) {
    await client.query(
      `insert into public.channels (id, org_id, name, kind) values ($1, $2, $3, $4)`,
      [ids.channel(org, c.key), orgId, c.name, c.key],
    );
    if (c.commissionBps > 0) {
      await client.query(
        `insert into public.channel_commissions (org_id, channel_id, commission_bps, effective_from) values ($1, $2, $3, $4)`,
        [orgId, ids.channel(org, c.key), c.commissionBps, FIRST_DATE],
      );
    }
  }
  for (const r of REASON_CODES) {
    await client.query(
      `insert into public.reason_codes (id, org_id, kind, code, label, label_bn) values ($1, $2, $3, $4, $5, $6)`,
      [ids.reason(org, r.kind, r.code), orgId, r.kind, r.code, r.label, r.label_bn],
    );
  }
  const categoryIds = new Map<string, string>();
  for (const [i, name] of org.categories.entries()) {
    const id = detId('category', org.key, name);
    categoryIds.set(name, id);
    await client.query(
      `insert into public.menu_categories (id, org_id, name, sort_order) values ($1, $2, $3, $4)`,
      [id, orgId, name, i],
    );
  }
  for (const m of org.menu) {
    await client.query(
      `insert into public.menu_items (id, org_id, category_id, name, name_bn, base_price_poisha, is_combo) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        ids.item(org, m),
        orgId,
        categoryIds.get(m.category),
        m.name,
        m.nameBn ?? null,
        m.pricePoisha,
        m.isCombo ?? false,
      ],
    );
  }
  await loadCosting(client, org);
  for (const c of CALENDAR) {
    await client.query(
      `insert into public.calendar_events (org_id, name, kind, starts_on, ends_on, source) values ($1, $2, $3, $4, $5, 'seed estimate — TODO(verify)')`,
      [orgId, c.name, c.kind, c.starts_on, c.ends_on],
    );
  }
}

/**
 * Phase 3 fixtures: ingredients with their price history (incl. S4's beef spike) and an approved recipe for
 * every menu item. Prices are stored per 1,000 base units so every unit price is exact (see costing.ts).
 */
async function loadCosting(client: pg.PoolClient, org: OrgCfg): Promise<void> {
  const costing = COSTING[org.key];
  if (!costing) return;
  const orgId = ids.org(org);
  const owner = org.users.find((u) => u.role === 'owner')!;
  const ingId = (key: string) => detId('ingredient', org.key, key);
  for (const i of costing.ingredients) {
    await client.query(
      `insert into public.ingredients (id, org_id, name, base) values ($1, $2, $3, $4)`,
      [ingId(i.key), orgId, i.name, i.base],
    );
    const history = [
      { from: FIRST_DATE, price: i.poishaPerBase },
      ...costing.priceChanges
        .filter((c) => c.ing === i.key)
        .map((c) => ({ from: c.from, price: c.poishaPerBase })),
    ];
    for (const h of history) {
      await client.query(
        `insert into public.ingredient_price_history (org_id, ingredient_id, effective_from, cost_poisha, per_base_qty, source)
         values ($1, $2, $3, $4, 1000, 'seed')`,
        [orgId, ingId(i.key), h.from, h.price * 1000],
      );
    }
    const current = history[history.length - 1]!.price;
    await client.query(
      `insert into public.ingredient_costs (ingredient_id, org_id, manual_cost_poisha, per_base_qty) values ($1, $2, $3, 1000)`,
      [ingId(i.key), orgId, current * 1000],
    );
  }
  for (const m of org.menu) {
    const lines = costing.recipes[m.key];
    if (!lines) continue;
    const recipeId = detId('recipe', org.key, m.key);
    await client.query(
      `insert into public.recipes (id, org_id, menu_item_id, name, yield_portions, status, source, version, approved_by, approved_at)
       values ($1, $2, $3, $4, 1, 'active', 'manual', 1, $5, $6)`,
      [recipeId, orgId, ids.item(org, m), m.name, userId(owner.email), `${FIRST_DATE}T00:00:00Z`],
    );
    for (const l of lines) {
      await client.query(
        `insert into public.recipe_lines (org_id, recipe_id, ingredient_id, qty_base, yield_pct) values ($1, $2, $3, $4, $5)`,
        [orgId, recipeId, ingId(l.ing), l.qty, l.yieldPct ?? 100],
      );
    }
  }
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
