-- Menu, channels, shifts, orders, payments, discounts, voids, refunds.
-- Money is bigint poisha. Order lines store the full VAT decomposition (ADR 0005).
-- Cost and margin data lives in separate money-gated tables (ADR 0007), never on order rows.

create type public.channel_kind as enum ('dine_in', 'takeaway', 'own_delivery', 'foodpanda', 'pathao_food', 'custom');
create type public.reason_kind as enum ('discount', 'void', 'refund', 'waste', 'adjustment');
create type public.order_status as enum ('open', 'sent_to_kitchen', 'preparing', 'ready', 'served', 'completed', 'cancelled');
create type public.payment_status as enum ('unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded');
create type public.payment_method as enum ('cash', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'bank');
create type public.order_line_status as enum ('active', 'voided');
create type public.order_event_type as enum (
  'created', 'sent_to_kitchen', 'preparing', 'ready', 'served', 'paid', 'completed', 'voided', 'cancelled', 'refunded', 'reopened'
);
create type public.shift_status as enum ('open', 'closed');
create type public.cash_count_kind as enum ('opening', 'closing', 'spot');

-- ---------------------------------------------------------------------------------------------
-- Menu
-- ---------------------------------------------------------------------------------------------
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  name_bn text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  category_id uuid,
  name text not null,
  name_bn text,
  description text,
  sku text,
  -- The price as printed on the menu (VAT-inclusive or not per org_settings.price_includes_vat).
  base_price_poisha bigint not null default 0 check (base_price_poisha >= 0),
  vat_rate_bps_override integer check (vat_rate_bps_override between 0 and 10000),
  is_combo boolean not null default false,
  is_active boolean not null default true,
  photo_path text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, category_id) references public.menu_categories (org_id, id) on delete set null (category_id)
);
create index menu_items_category_idx on public.menu_items (org_id, category_id);

create table public.item_variants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  menu_item_id uuid not null,
  name text not null,
  name_bn text,
  price_delta_poisha bigint not null default 0,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete cascade
);
create index item_variants_item_idx on public.item_variants (org_id, menu_item_id);

create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  name_bn text,
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 1 check (max_select >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.menu_item_modifier_groups (
  org_id uuid not null references public.organizations (id) on delete cascade,
  menu_item_id uuid not null,
  modifier_group_id uuid not null,
  primary key (menu_item_id, modifier_group_id),
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete cascade,
  foreign key (org_id, modifier_group_id) references public.modifier_groups (org_id, id) on delete cascade
);

create table public.modifiers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  group_id uuid not null,
  name text not null,
  name_bn text,
  price_poisha bigint not null default 0,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, group_id) references public.modifier_groups (org_id, id) on delete cascade
);
create index modifiers_group_idx on public.modifiers (org_id, group_id);

create table public.branch_item_prices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  menu_item_id uuid not null,
  variant_id uuid,
  price_poisha bigint not null check (price_poisha >= 0),
  -- 86'd items are is_available = false.
  is_available boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique nulls not distinct (org_id, branch_id, menu_item_id, variant_id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete cascade,
  foreign key (org_id, variant_id) references public.item_variants (org_id, id) on delete cascade
);

-- Append-only log of price changes (trigger-populated from Phase 1).
create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid,
  menu_item_id uuid not null,
  variant_id uuid,
  old_price_poisha bigint,
  new_price_poisha bigint not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete cascade
);
create index price_history_item_idx on public.price_history (org_id, menu_item_id, changed_at desc);
create trigger price_history_no_update before update or delete on public.price_history
  for each row execute function private.forbid_mutation();

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, branch_id, name),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  name text not null,
  seats integer check (seats > 0),
  -- Unguessable token for optional QR table ordering.
  qr_token text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, branch_id, name),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  kind public.channel_kind not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, name)
);

-- Commission and fees are cost data: money-gated (ADR 0007).
create table public.channel_commissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  channel_id uuid not null,
  commission_bps integer not null default 0 check (commission_bps between 0 and 10000),
  fixed_fee_poisha bigint not null default 0 check (fixed_fee_poisha >= 0),
  packaging_poisha bigint not null default 0 check (packaging_poisha >= 0),
  restaurant_funded_discount_bps integer not null default 0 check (restaurant_funded_discount_bps between 0 and 10000),
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  unique (org_id, channel_id, effective_from),
  foreign key (org_id, channel_id) references public.channels (org_id, id) on delete cascade
);

create table public.reason_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind public.reason_kind not null,
  code text not null,
  label text not null,
  label_bn text,
  requires_manager_approval boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, kind, code)
);

-- ---------------------------------------------------------------------------------------------
-- Shifts and cash
-- ---------------------------------------------------------------------------------------------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  device_id uuid,
  opened_by_staff_id uuid,
  closed_by_staff_id uuid,
  status public.shift_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  business_date date,
  opening_float_poisha bigint not null default 0 check (opening_float_poisha >= 0),
  expected_cash_poisha bigint,
  counted_cash_poisha bigint,
  over_short_poisha bigint,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, device_id) references public.devices (org_id, id) on delete set null (device_id),
  foreign key (org_id, opened_by_staff_id) references public.staff (org_id, id) on delete set null (opened_by_staff_id),
  foreign key (org_id, closed_by_staff_id) references public.staff (org_id, id) on delete set null (closed_by_staff_id)
);
create index shifts_branch_idx on public.shifts (org_id, branch_id, opened_at desc);

create table public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  shift_id uuid not null,
  kind public.cash_count_kind not null,
  counted_by_staff_id uuid,
  counted_at timestamptz not null default now(),
  denominations jsonb not null default '{}'::jsonb,
  total_poisha bigint not null check (total_poisha >= 0),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, shift_id) references public.shifts (org_id, id) on delete cascade,
  foreign key (org_id, counted_by_staff_id) references public.staff (org_id, id) on delete set null (counted_by_staff_id)
);

-- Server-assigned, gapless invoice numbers. Clients never write this; an RPC arrives in Phase 1.
create table public.invoice_sequences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  series text not null default 'default',
  next_number bigint not null default 1 check (next_number >= 1),
  unique (org_id, branch_id, series),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------------------------
create table public.orders (
  -- Client-generated UUID so an offline POS can create orders without a round trip (ADR / CLAUDE.md #7).
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  idempotency_key text,
  channel_id uuid,
  table_id uuid,
  shift_id uuid,
  staff_id uuid,
  device_id uuid,
  customer_id uuid,
  order_number integer,
  order_status public.order_status not null default 'open',
  payment_status public.payment_status not null default 'unpaid',
  guests integer check (guests > 0),
  -- Client clock time of sale. business_date is derived from it at insert (private.set_order_business_date).
  placed_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  business_date date not null,
  invoice_no text,
  provisional_receipt_no text,
  notes text,
  -- VAT decomposition, ADR 0005. All poisha.
  gross_poisha bigint not null default 0,
  discount_poisha bigint not null default 0,
  net_before_discount_poisha bigint not null default 0,
  discount_net_poisha bigint not null default 0,
  net_poisha bigint not null default 0,
  vat_poisha bigint not null default 0,
  service_charge_poisha bigint not null default 0,
  total_poisha bigint not null default 0,
  -- Tax settings frozen at sale time, so changing org_settings never rewrites history.
  price_includes_vat boolean not null default true,
  vat_rate_bps integer not null default 0,
  service_charge_bps integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, idempotency_key),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, channel_id) references public.channels (org_id, id) on delete set null (channel_id),
  foreign key (org_id, table_id) references public.dining_tables (org_id, id) on delete set null (table_id),
  foreign key (org_id, shift_id) references public.shifts (org_id, id) on delete set null (shift_id),
  foreign key (org_id, staff_id) references public.staff (org_id, id) on delete set null (staff_id),
  foreign key (org_id, device_id) references public.devices (org_id, id) on delete set null (device_id)
);
create index orders_branch_date_idx on public.orders (org_id, branch_id, business_date);
create index orders_branch_placed_idx on public.orders (org_id, branch_id, placed_at desc);
create index orders_channel_idx on public.orders (org_id, channel_id) where channel_id is not null;
create index orders_staff_idx on public.orders (org_id, staff_id) where staff_id is not null;

-- business_date is fixed at insert from placed_at and the branch/org cutoff, and never rewritten.
create function private.set_order_business_date() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cutoff integer;
begin
  if tg_op = 'UPDATE' then
    if new.placed_at is distinct from old.placed_at then
      raise exception 'orders.placed_at is immutable' using errcode = 'restrict_violation';
    end if;
    new.business_date := old.business_date;
    return new;
  end if;
  select coalesce(b.cutoff_minutes, s.default_cutoff_minutes, 240)
    into v_cutoff
  from public.branches b
  left join public.org_settings s on s.org_id = b.org_id
  where b.id = new.branch_id and b.org_id = new.org_id;
  new.business_date := private.business_date(new.placed_at, coalesce(v_cutoff, 240));
  return new;
end $$;
create trigger orders_business_date before insert or update on public.orders
  for each row execute function private.set_order_business_date();
create trigger orders_touch before update on public.orders for each row execute function private.touch_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  order_id uuid not null,
  menu_item_id uuid,
  variant_id uuid,
  station_id uuid,
  name_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price_poisha bigint not null check (unit_price_poisha >= 0),
  gross_poisha bigint not null default 0,
  discount_poisha bigint not null default 0,
  net_before_discount_poisha bigint not null default 0,
  discount_net_poisha bigint not null default 0,
  net_poisha bigint not null default 0,
  vat_poisha bigint not null default 0,
  service_charge_poisha bigint not null default 0,
  total_poisha bigint not null default 0,
  status public.order_line_status not null default 'active',
  kot_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, order_id) references public.orders (org_id, id) on delete cascade,
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete set null (menu_item_id),
  foreign key (org_id, variant_id) references public.item_variants (org_id, id) on delete set null (variant_id),
  foreign key (org_id, station_id) references public.stations (org_id, id) on delete set null (station_id)
);
create index order_items_order_idx on public.order_items (org_id, order_id);
create index order_items_item_idx on public.order_items (org_id, menu_item_id) where menu_item_id is not null;
create index order_items_branch_time_idx on public.order_items (org_id, branch_id, created_at);

create table public.order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  order_item_id uuid not null,
  modifier_id uuid,
  name_snapshot text not null,
  price_poisha bigint not null default 0,
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, order_item_id) references public.order_items (org_id, id) on delete cascade,
  foreign key (org_id, modifier_id) references public.modifiers (org_id, id) on delete set null (modifier_id)
);
create index order_item_modifiers_item_idx on public.order_item_modifiers (org_id, order_item_id);

-- Recipe-cost snapshot at sale time. Cost data, so separate and money-gated (ADR 0007). Written from Phase 3.
create table public.order_item_costs (
  order_item_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  unit_cost_poisha bigint not null check (unit_cost_poisha >= 0),
  recipe_id uuid,
  snapshot_at timestamptz not null default now(),
  foreign key (org_id, order_item_id) references public.order_items (org_id, id) on delete cascade
);

-- Status timeline. Append-only; feeds service-speed analytics (ticket time = ready − sent_to_kitchen).
create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  order_id uuid not null,
  event_type public.order_event_type not null,
  staff_id uuid,
  device_id uuid,
  occurred_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, order_id) references public.orders (org_id, id) on delete cascade,
  foreign key (org_id, staff_id) references public.staff (org_id, id) on delete set null (staff_id),
  foreign key (org_id, device_id) references public.devices (org_id, id) on delete set null (device_id)
);
create index order_events_order_idx on public.order_events (org_id, order_id, occurred_at);
create index order_events_branch_type_idx on public.order_events (org_id, branch_id, event_type, occurred_at);
create trigger order_events_no_update before update or delete on public.order_events
  for each row execute function private.forbid_mutation();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  order_id uuid not null,
  shift_id uuid,
  staff_id uuid,
  method public.payment_method not null,
  amount_poisha bigint not null check (amount_poisha > 0),
  reference text,
  idempotency_key text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, idempotency_key),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, order_id) references public.orders (org_id, id) on delete cascade,
  foreign key (org_id, shift_id) references public.shifts (org_id, id) on delete set null (shift_id),
  foreign key (org_id, staff_id) references public.staff (org_id, id) on delete set null (staff_id)
);
create index payments_order_idx on public.payments (org_id, order_id);
create index payments_branch_time_idx on public.payments (org_id, branch_id, received_at);

create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  order_id uuid not null,
  order_item_id uuid,
  amount_poisha bigint not null check (amount_poisha > 0),
  percent_bps integer check (percent_bps between 1 and 10000),
  reason_code_id uuid,
  reason_note text,
  applied_by_staff_id uuid,
  approved_by_staff_id uuid,
  created_at timestamptz not null default now(),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, order_id) references public.orders (org_id, id) on delete cascade,
  foreign key (org_id, order_item_id) references public.order_items (org_id, id) on delete cascade,
  foreign key (org_id, reason_code_id) references public.reason_codes (org_id, id) on delete set null (reason_code_id),
  foreign key (org_id, applied_by_staff_id) references public.staff (org_id, id) on delete set null (applied_by_staff_id),
  foreign key (org_id, approved_by_staff_id) references public.staff (org_id, id) on delete set null (approved_by_staff_id)
);
create index discounts_branch_time_idx on public.discounts (org_id, branch_id, created_at);
create index discounts_staff_idx on public.discounts (org_id, applied_by_staff_id) where applied_by_staff_id is not null;

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  order_id uuid not null,
  payment_id uuid,
  method public.payment_method not null,
  amount_poisha bigint not null check (amount_poisha > 0),
  reason_code_id uuid,
  reason_note text,
  refunded_by_staff_id uuid,
  approved_by_staff_id uuid,
  created_at timestamptz not null default now(),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, order_id) references public.orders (org_id, id) on delete cascade,
  foreign key (org_id, payment_id) references public.payments (org_id, id) on delete set null (payment_id),
  foreign key (org_id, reason_code_id) references public.reason_codes (org_id, id) on delete set null (reason_code_id),
  foreign key (org_id, refunded_by_staff_id) references public.staff (org_id, id) on delete set null (refunded_by_staff_id),
  foreign key (org_id, approved_by_staff_id) references public.staff (org_id, id) on delete set null (approved_by_staff_id)
);
create index refunds_branch_time_idx on public.refunds (org_id, branch_id, created_at);

-- Voided lines. after_kot / after_payment feed the zero-input leak detectors (METRICS.md "POS exceptions").
create table public.voids (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  order_id uuid not null,
  order_item_id uuid,
  value_poisha bigint not null check (value_poisha >= 0),
  after_kot boolean not null default false,
  after_payment boolean not null default false,
  reason_code_id uuid,
  reason_note text,
  voided_by_staff_id uuid,
  approved_by_staff_id uuid,
  voided_at timestamptz not null default now(),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, order_id) references public.orders (org_id, id) on delete cascade,
  foreign key (org_id, order_item_id) references public.order_items (org_id, id) on delete set null (order_item_id),
  foreign key (org_id, reason_code_id) references public.reason_codes (org_id, id) on delete set null (reason_code_id),
  foreign key (org_id, voided_by_staff_id) references public.staff (org_id, id) on delete set null (voided_by_staff_id),
  foreign key (org_id, approved_by_staff_id) references public.staff (org_id, id) on delete set null (approved_by_staff_id)
);
create index voids_branch_time_idx on public.voids (org_id, branch_id, voided_at);
create index voids_staff_idx on public.voids (org_id, voided_by_staff_id) where voided_by_staff_id is not null;

create trigger menu_categories_touch before update on public.menu_categories for each row execute function private.touch_updated_at();
create trigger menu_items_touch before update on public.menu_items for each row execute function private.touch_updated_at();
create trigger branch_item_prices_touch before update on public.branch_item_prices for each row execute function private.touch_updated_at();
create trigger shifts_touch before update on public.shifts for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Policies (ADR 0007)
--   catalogue: everyone in the org reads, only the owner edits
--   operations: branch-scoped; owner/manager/cashier write; nothing is ever deleted by a client
--   cost data: owner + accountant only
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_all public.app_role[] := private.roles_all();
  v_owner public.app_role[] := array['owner']::public.app_role[];
  v_ops_read public.app_role[] := array['owner', 'manager', 'cashier', 'kitchen', 'accountant']::public.app_role[];
  v_ops_write public.app_role[] := array['owner', 'manager', 'cashier']::public.app_role[];
  v_mgr public.app_role[] := array['owner', 'manager']::public.app_role[];
  v_money public.app_role[] := array['owner', 'accountant']::public.app_role[];
  t text;
begin
  foreach t in array array['menu_categories', 'menu_items', 'item_variants', 'modifier_groups',
                           'menu_item_modifier_groups', 'modifiers', 'channels', 'reason_codes'] loop
    perform private.apply_policies(t, 'org', v_all, v_owner, true);
  end loop;

  perform private.apply_policies('branch_item_prices', 'branch', v_all, v_mgr);
  perform private.apply_policies('price_history', 'branch', array['owner', 'manager', 'accountant']::public.app_role[], '{}',
    false, 'append-only log; populated by triggers from Phase 1');
  perform private.apply_policies('stations', 'branch', v_all, v_mgr, true);
  perform private.apply_policies('dining_tables', 'branch', v_all, v_mgr, true);
  perform private.apply_policies('channel_commissions', 'org', v_money, v_owner, false, 'money-gated (ADR 0007)');

  perform private.apply_policies('shifts', 'branch', v_ops_read, v_ops_write);
  perform private.apply_policies('cash_counts', 'branch', v_ops_read, v_ops_write);
  perform private.apply_policies('orders', 'branch', v_ops_read, v_ops_write, false,
    'Phase 1 tightens kitchen/status transitions behind RPCs');
  perform private.apply_policies('order_items', 'branch', v_ops_read, v_ops_write);
  perform private.apply_policies('order_item_modifiers', 'branch', v_ops_read, v_ops_write);
  perform private.apply_policies('order_events', 'branch', v_ops_read,
    array['owner', 'manager', 'cashier', 'kitchen']::public.app_role[], false, 'append-only');
  perform private.apply_policies('payments', 'branch', v_ops_read, v_ops_write);
  perform private.apply_policies('discounts', 'branch', v_ops_read, v_ops_write);
  perform private.apply_policies('refunds', 'branch', v_ops_read, v_ops_write);
  perform private.apply_policies('voids', 'branch', v_ops_read, v_ops_write);

  perform private.apply_policies('order_item_costs', 'org', v_money, '{}', false,
    'money-gated; written by the service role from Phase 3');
end $$;

select private.register_table('invoice_sequences', 'service_only', 'gapless numbers are assigned server-side (Phase 1 RPC)');

comment on table public.menu_categories is 'Menu grouping. | written by: menu | phase: 1';
comment on table public.menu_items is 'Sellable item with the printed base price. | written by: menu | phase: 1';
comment on table public.item_variants is 'Size/portion variants with a price delta. | written by: menu | phase: 1';
comment on table public.modifier_groups is 'Groups of add-ons with min/max selection. | written by: menu | phase: 1';
comment on table public.menu_item_modifier_groups is 'Which modifier groups apply to which item. | written by: menu | phase: 1';
comment on table public.modifiers is 'Add-on options with a price. | written by: menu | phase: 1';
comment on table public.branch_item_prices is 'Per-branch price and 86 availability. | written by: menu | phase: 1';
comment on table public.price_history is 'Append-only log of price changes. | written by: menu | phase: 1';
comment on table public.stations is 'KDS stations per branch. | written by: kds | phase: 1';
comment on table public.dining_tables is 'Tables per branch, optional QR token. | written by: pos | phase: 1';
comment on table public.channels is 'Sales channels: dine-in, takeaway, own delivery, foodpanda, Pathao Food, custom. | written by: pos | phase: 1';
comment on table public.channel_commissions is 'Money-gated commission and fee terms per channel. | written by: pos | phase: 2';
comment on table public.reason_codes is 'Reason codes for discounts, voids, refunds, waste, adjustments. | written by: pos | phase: 1';
comment on table public.shifts is 'Cash shifts: opening float, expected vs counted, over/short. | written by: pos | phase: 1';
comment on table public.cash_counts is 'Opening/closing/spot cash counts per shift. | written by: pos | phase: 1';
comment on table public.invoice_sequences is 'Server-assigned gapless invoice numbers. Service-only. | written by: pos | phase: 1';
comment on table public.orders is 'A sale. Order status is separate from payment status; VAT decomposition stored. | written by: pos | phase: 1';
comment on table public.order_items is 'Order lines with price snapshot and VAT decomposition. | written by: pos | phase: 1';
comment on table public.order_item_modifiers is 'Modifiers chosen on an order line. | written by: pos | phase: 1';
comment on table public.order_item_costs is 'Recipe-cost snapshot per line. Money-gated. | written by: recipes | phase: 3';
comment on table public.order_events is 'Append-only order status timeline. | written by: kds | phase: 1';
comment on table public.payments is 'Split payments by method. | written by: payments | phase: 1';
comment on table public.discounts is 'Order/line discounts with reason and approver. | written by: pos | phase: 1';
comment on table public.refunds is 'Refunds with reason and approver. | written by: pos | phase: 1';
comment on table public.voids is 'Voided lines; after_kot/after_payment feed leak detectors. | written by: pos | phase: 1';
