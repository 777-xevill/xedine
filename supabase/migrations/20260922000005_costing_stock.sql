-- Ingredients, recipes, purchasing, stock counts, waste, transfers.
-- Quantities are numeric in base units (g, ml, pcs). Money is bigint poisha; per-unit prices are
-- stored as a total for a stated quantity so no fractional-poisha column is ever needed.

create type public.base_unit as enum ('g', 'ml', 'pcs');
create type public.recipe_status as enum ('draft', 'active', 'archived');
create type public.recipe_source as enum ('manual', 'ai_draft');
create type public.purchase_source as enum ('form', 'photo', 'voice', 'import');
create type public.purchase_status as enum ('draft', 'confirmed', 'void');
create type public.draft_status as enum ('pending_review', 'confirmed', 'discarded');
create type public.stock_count_kind as enum ('guided_weekly', 'full', 'spot');
create type public.stock_count_status as enum ('open', 'submitted');
create type public.waste_source as enum ('kds', 'mobile', 'manual');
create type public.transfer_status as enum ('draft', 'sent', 'received', 'disputed');

create table public.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  code text not null,
  name text not null,
  base public.base_unit not null,
  -- How many base units one of this unit is (kg → 1000 g).
  to_base_factor numeric not null check (to_base_factor > 0),
  unique (org_id, id),
  unique (org_id, code)
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  name_bn text,
  base public.base_unit not null default 'g',
  category text,
  is_perishable boolean not null default false,
  shelf_life_days integer check (shelf_life_days > 0),
  safety_stock_qty numeric not null default 0 check (safety_stock_qty >= 0),
  -- Days-of-cover overrides (METRICS.md: 🟢 ≥ 7 · 🟡 3–6.99 · 🔴 < 3 by default).
  cover_green_days numeric,
  cover_red_days numeric,
  purchase_unit_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, name),
  foreign key (org_id, purchase_unit_id) references public.units (org_id, id) on delete set null (purchase_unit_id)
);
create trigger ingredients_touch before update on public.ingredients for each row execute function private.touch_updated_at();

-- Manual cost until purchases exist (Phase 5). Cost data → money-gated (ADR 0007).
create table public.ingredient_costs (
  ingredient_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  manual_cost_poisha bigint not null check (manual_cost_poisha >= 0),
  -- Cost is for this many base units (e.g. ৳550 per 1000 g).
  per_base_qty numeric not null default 1000 check (per_base_qty > 0),
  updated_at timestamptz not null default now(),
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete cascade
);

create table public.unit_conversions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  ingredient_id uuid,
  from_unit_id uuid not null,
  to_unit_id uuid not null,
  factor numeric not null check (factor > 0),
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete cascade,
  foreign key (org_id, from_unit_id) references public.units (org_id, id) on delete cascade,
  foreign key (org_id, to_unit_id) references public.units (org_id, id) on delete cascade
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  menu_item_id uuid,
  variant_id uuid,
  name text,
  yield_portions numeric not null default 1 check (yield_portions > 0),
  status public.recipe_status not null default 'draft',
  source public.recipe_source not null default 'manual',
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete cascade,
  foreign key (org_id, variant_id) references public.item_variants (org_id, id) on delete cascade,
  -- AI drafts never become active without a human approving them (CLAUDE.md #4).
  constraint recipes_active_needs_approval check (status <> 'active' or approved_at is not null)
);
create unique index recipes_one_active_idx on public.recipes (org_id, menu_item_id, variant_id) nulls not distinct
  where status = 'active' and menu_item_id is not null;
create trigger recipes_touch before update on public.recipes for each row execute function private.touch_updated_at();
create trigger recipes_audit after insert or update or delete on public.recipes
  for each row execute function private.audit_row_change('recipe');

create table public.recipe_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  recipe_id uuid not null,
  ingredient_id uuid,
  sub_recipe_id uuid,
  qty_base numeric not null check (qty_base > 0),
  yield_pct numeric not null default 100 check (yield_pct > 0 and yield_pct <= 100),
  foreign key (org_id, recipe_id) references public.recipes (org_id, id) on delete cascade,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete restrict,
  foreign key (org_id, sub_recipe_id) references public.recipes (org_id, id) on delete restrict,
  check ((ingredient_id is not null) <> (sub_recipe_id is not null))
);
create index recipe_lines_recipe_idx on public.recipe_lines (org_id, recipe_id);
create trigger recipe_lines_audit after insert or update or delete on public.recipe_lines
  for each row execute function private.audit_row_change('recipe_line');

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  phone text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, name)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  supplier_id uuid,
  purchased_on date not null default current_date,
  source public.purchase_source not null default 'form',
  status public.purchase_status not null default 'confirmed',
  total_poisha bigint not null default 0 check (total_poisha >= 0),
  notes text,
  entered_by uuid references auth.users (id) on delete set null,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, supplier_id) references public.suppliers (org_id, id) on delete set null (supplier_id)
);
create index purchases_branch_date_idx on public.purchases (org_id, branch_id, purchased_on);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  purchase_id uuid not null,
  ingredient_id uuid not null,
  qty_base numeric not null check (qty_base > 0),
  line_total_poisha bigint not null check (line_total_poisha >= 0),
  note text,
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, purchase_id) references public.purchases (org_id, id) on delete cascade,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete restrict
);
create index purchase_lines_purchase_idx on public.purchase_lines (org_id, purchase_id);
create index purchase_lines_ingredient_idx on public.purchase_lines (org_id, ingredient_id);

-- AI-extracted chit/voice drafts. They cannot touch stock until a human confirms (CLAUDE.md #4).
create table public.purchase_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  source public.purchase_source not null,
  media_path text,
  raw_text text,
  extracted jsonb not null default '{}'::jsonb,
  confidence jsonb not null default '{}'::jsonb,
  status public.draft_status not null default 'pending_review',
  purchase_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, purchase_id) references public.purchases (org_id, id) on delete set null (purchase_id)
);

create table public.reference_prices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  ingredient_id uuid,
  label text not null,
  price_poisha bigint not null check (price_poisha >= 0),
  per_base_qty numeric not null default 1000 check (per_base_qty > 0),
  source text,
  observed_on date not null default current_date,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete cascade
);

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  counted_on date not null default current_date,
  kind public.stock_count_kind not null default 'guided_weekly',
  status public.stock_count_status not null default 'open',
  counted_by uuid references auth.users (id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);

create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  stock_count_id uuid not null,
  ingredient_id uuid not null,
  counted_qty_base numeric not null check (counted_qty_base >= 0),
  note text,
  unique (stock_count_id, ingredient_id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, stock_count_id) references public.stock_counts (org_id, id) on delete cascade,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete restrict
);

create table public.waste_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  ingredient_id uuid,
  menu_item_id uuid,
  qty_base numeric check (qty_base > 0),
  qty_portions numeric check (qty_portions > 0),
  reason_code_id uuid,
  note text,
  source public.waste_source not null default 'manual',
  logged_by_staff_id uuid,
  logged_by_user uuid references auth.users (id) on delete set null,
  logged_at timestamptz not null default now(),
  business_date date not null default current_date,
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete set null (ingredient_id),
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete set null (menu_item_id),
  foreign key (org_id, reason_code_id) references public.reason_codes (org_id, id) on delete set null (reason_code_id),
  foreign key (org_id, logged_by_staff_id) references public.staff (org_id, id) on delete set null (logged_by_staff_id)
);
create index waste_logs_branch_date_idx on public.waste_logs (org_id, branch_id, business_date);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  from_branch_id uuid not null,
  to_branch_id uuid not null,
  status public.transfer_status not null default 'draft',
  sent_at timestamptz,
  received_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  received_by uuid references auth.users (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  check (from_branch_id <> to_branch_id),
  foreign key (org_id, from_branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, to_branch_id) references public.branches (org_id, id) on delete cascade
);

create table public.transfer_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  transfer_id uuid not null,
  ingredient_id uuid not null,
  qty_base_sent numeric not null check (qty_base_sent > 0),
  qty_base_received numeric check (qty_base_received >= 0),
  foreign key (org_id, transfer_id) references public.transfers (org_id, id) on delete cascade,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete restrict
);

-- Transfers are visible to either branch's members; lines follow their transfer.
create policy transfers_select on public.transfers for select to authenticated
  using (
    private.can_access_branch_role(org_id, from_branch_id, array['owner', 'manager', 'kitchen', 'purchaser', 'accountant']::public.app_role[])
    or private.can_access_branch_role(org_id, to_branch_id, array['owner', 'manager', 'kitchen', 'purchaser', 'accountant']::public.app_role[])
  );
create policy transfers_insert on public.transfers for insert to authenticated
  with check (
    private.can_access_branch_role(org_id, from_branch_id, array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[])
  );
create policy transfers_update on public.transfers for update to authenticated
  using (
    private.can_access_branch_role(org_id, from_branch_id, array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[])
    or private.can_access_branch_role(org_id, to_branch_id, array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[])
  )
  with check (
    private.can_access_branch_role(org_id, from_branch_id, array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[])
    or private.can_access_branch_role(org_id, to_branch_id, array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[])
  );
select private.register_table('transfers', 'custom', 'visible/editable from either branch; send/receive confirmation is Phase 5');

create policy transfer_lines_select on public.transfer_lines for select to authenticated
  using (exists (select 1 from public.transfers t where t.org_id = transfer_lines.org_id and t.id = transfer_lines.transfer_id));
create policy transfer_lines_insert on public.transfer_lines for insert to authenticated
  with check (exists (select 1 from public.transfers t where t.org_id = transfer_lines.org_id and t.id = transfer_lines.transfer_id));
create policy transfer_lines_update on public.transfer_lines for update to authenticated
  using (exists (select 1 from public.transfers t where t.org_id = transfer_lines.org_id and t.id = transfer_lines.transfer_id))
  with check (exists (select 1 from public.transfers t where t.org_id = transfer_lines.org_id and t.id = transfer_lines.transfer_id));
select private.register_table('transfer_lines', 'custom', 'follows the parent transfer (RLS on transfers applies inside the subquery)');

do $$
declare
  v_owner public.app_role[] := array['owner']::public.app_role[];
  v_catalog_read public.app_role[] := array['owner', 'manager', 'kitchen', 'purchaser', 'accountant']::public.app_role[];
  v_money public.app_role[] := array['owner', 'accountant']::public.app_role[];
  v_buy_read public.app_role[] := array['owner', 'purchaser', 'accountant']::public.app_role[];
  v_buy_write public.app_role[] := array['owner', 'purchaser']::public.app_role[];
  v_stock_read public.app_role[] := array['owner', 'manager', 'kitchen', 'purchaser', 'accountant']::public.app_role[];
  v_stock_write public.app_role[] := array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[];
begin
  perform private.apply_policies('units', 'org', v_catalog_read, v_owner);
  perform private.apply_policies('ingredients', 'org', v_catalog_read, v_owner);
  perform private.apply_policies('ingredient_costs', 'org', v_money, v_owner, false, 'money-gated (ADR 0007)');
  perform private.apply_policies('unit_conversions', 'org', v_catalog_read, v_owner);
  perform private.apply_policies('recipes', 'org', array['owner', 'manager', 'kitchen', 'accountant']::public.app_role[], v_owner, false,
    'recipe edits are audited by trigger');
  perform private.apply_policies('recipe_lines', 'org', array['owner', 'manager', 'kitchen', 'accountant']::public.app_role[], v_owner);
  perform private.apply_policies('suppliers', 'org', v_catalog_read, v_owner);
  perform private.apply_policies('purchases', 'branch', v_buy_read, v_buy_write, false, 'prices → managers excluded (ADR 0007)');
  perform private.apply_policies('purchase_lines', 'branch', v_buy_read, v_buy_write);
  perform private.apply_policies('purchase_drafts', 'branch', v_buy_read, v_buy_write);
  perform private.apply_policies('reference_prices', 'org', v_buy_read, v_owner);
  perform private.apply_policies('stock_counts', 'branch', v_stock_read, v_stock_write);
  perform private.apply_policies('stock_count_lines', 'branch', v_stock_read, v_stock_write);
  perform private.apply_policies('waste_logs', 'branch', array['owner', 'manager', 'kitchen', 'accountant']::public.app_role[],
    array['owner', 'manager', 'kitchen']::public.app_role[]);
end $$;

comment on table public.units is 'Units with a factor to the base unit (g, ml, pcs). | written by: inventory | phase: 3';
comment on table public.ingredients is 'Ingredient catalogue in base units; stock and cover settings. | written by: recipes | phase: 3';
comment on table public.ingredient_costs is 'Manual ingredient cost until purchases exist. Money-gated. | written by: recipes | phase: 3';
comment on table public.unit_conversions is 'Ingredient-specific unit conversions. | written by: recipes | phase: 3';
comment on table public.recipes is 'Recipe per menu item/variant; drafts need approval to become active. | written by: recipes | phase: 3';
comment on table public.recipe_lines is 'Recipe lines: ingredient or sub-recipe, qty in base units, yield %. | written by: recipes | phase: 3';
comment on table public.suppliers is 'Suppliers. | written by: purchasing | phase: 5';
comment on table public.purchases is 'A bazar purchase; money-bearing so managers cannot read it. | written by: purchasing | phase: 5';
comment on table public.purchase_lines is 'Purchase lines: qty in base units and line total. | written by: purchasing | phase: 5';
comment on table public.purchase_drafts is 'AI-extracted chit/voice drafts awaiting human confirmation. | written by: purchasing | phase: 5';
comment on table public.reference_prices is 'External reference prices (CSV import). | written by: purchasing | phase: 6';
comment on table public.stock_counts is 'Guided weekly / full / spot counts. | written by: inventory | phase: 5';
comment on table public.stock_count_lines is 'Counted quantity per ingredient. | written by: inventory | phase: 5';
comment on table public.waste_logs is 'Logged waste with reason; quantities only. | written by: inventory | phase: 5';
comment on table public.transfers is 'Branch-to-branch transfers with send/receive confirmation. | written by: inventory | phase: 5';
comment on table public.transfer_lines is 'Transfer quantities sent and received. | written by: inventory | phase: 5';
