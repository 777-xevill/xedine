-- Phase 3 (ADR 0016): recipes, costing and menu profit intelligence.
--
-- Cost never sits on a row a manager can read (ADR 0007, ADR 0012 §3): ingredient prices live in
-- ingredient_costs / ingredient_price_history and a sale's recipe cost in order_item_costs, all
-- owner/accountant-only. Every figure has one SQL implementation (METRICS.md "Costing", "Menu engineering").

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
alter table public.org_cost_settings add column target_food_cost_bps integer
  check (target_food_cost_bps between 0 and 10000);

-- What an ingredient cost from a given business day on (manual now; purchases write here in Phase 5).
create table public.ingredient_price_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  ingredient_id uuid not null,
  effective_from date not null,
  cost_poisha bigint not null check (cost_poisha >= 0),
  per_base_qty numeric not null default 1000 check (per_base_qty > 0),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (org_id, ingredient_id, effective_from),
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete cascade
);
create index ingredient_price_history_idx on public.ingredient_price_history (org_id, ingredient_id, effective_from desc);

-- The recipe cost of a sold line, frozen at sale time (METRICS.md: "snapshot stored on order_items at
-- sale time" — kept beside the line in the Phase 0 table, not on it, so managers never see it). The
-- extra columns let costing queries and evidence stay on this money-gated table.
alter table public.order_item_costs
  add column branch_id uuid,
  add column order_id uuid,
  add column menu_item_id uuid,
  add column business_date date,
  add column cost_poisha bigint not null default 0 check (cost_poisha >= 0),
  add foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade;
alter table public.order_item_costs alter column cost_poisha drop default;
create index order_item_costs_branch_date_idx on public.order_item_costs (org_id, branch_id, business_date);
create index order_item_costs_item_date_idx on public.order_item_costs (org_id, menu_item_id, business_date);

-- AI (or pasted) recipe drafts: never a recipe until a person approves them (CLAUDE.md #4).
create table public.recipe_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  menu_item_id uuid,
  item_name text not null,
  -- {yield_portions, lines: [{ingredient, base: g|ml|pcs, qty_base, yield_pct}], notes}
  payload jsonb not null,
  status public.draft_status not null default 'pending_review',
  model text,
  prompt_key text,
  prompt_version integer,
  created_by uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  recipe_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete cascade,
  foreign key (org_id, recipe_id) references public.recipes (org_id, id) on delete set null (recipe_id)
);
create index recipe_drafts_org_idx on public.recipe_drafts (org_id, status, created_at desc);
create trigger recipe_drafts_touch before update on public.recipe_drafts for each row execute function private.touch_updated_at();

do $$
declare
  v_money public.app_role[] := array['owner', 'accountant']::public.app_role[];
  v_owner public.app_role[] := array['owner']::public.app_role[];
begin
  perform private.apply_policies('ingredient_price_history', 'org', v_money, v_owner, false, 'money-gated (ADR 0007)');
  -- The chef (kitchen) edits drafts; only the owner approves them into recipes (approve_recipe_draft).
  perform private.apply_policies('recipe_drafts', 'org', array['owner', 'manager', 'kitchen']::public.app_role[],
    array['owner', 'kitchen']::public.app_role[], true, 'drafts only; approval is an audited owner RPC');
end $$;

comment on table public.ingredient_price_history is
  'What an ingredient cost from a business day on (manual; purchases from P5). Money-gated. | written by: recipes | phase: 3';
comment on table public.recipe_drafts is
  'AI or pasted recipe drafts awaiting a person''s approval. | written by: recipes | phase: 3';

-- A manual cost change is also history, so a later recipe-cost question has the price of that day.
create function private.record_ingredient_cost() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ingredient_price_history (org_id, ingredient_id, effective_from, cost_poisha, per_base_qty, source)
  values (new.org_id, new.ingredient_id, private.business_date(now(), private.org_cutoff(new.org_id)),
          new.manual_cost_poisha, new.per_base_qty, 'manual')
  on conflict (org_id, ingredient_id, effective_from)
  do update set cost_poisha = excluded.cost_poisha, per_base_qty = excluded.per_base_qty, source = 'manual';
  return new;
end $$;
create trigger ingredient_costs_history after insert or update on public.ingredient_costs
  for each row execute function private.record_ingredient_cost();
create trigger ingredient_costs_audit after insert or update on public.ingredient_costs
  for each row execute function private.audit_row_change('ingredient_cost');

-- ---------------------------------------------------------------------------------------------
-- Costing (METRICS.md "Costing"). Unit costs are numeric poisha per base unit; a figure shown to a
-- person is rounded once, to whole poisha, at the item level.
-- ---------------------------------------------------------------------------------------------
create function private.ingredient_unit_cost(p_org uuid, p_ingredient uuid, p_date date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select h.cost_poisha::numeric / h.per_base_qty from public.ingredient_price_history h
      where h.org_id = p_org and h.ingredient_id = p_ingredient and h.effective_from <= p_date
      order by h.effective_from desc limit 1),
    (select c.manual_cost_poisha::numeric / c.per_base_qty from public.ingredient_costs c
      where c.org_id = p_org and c.ingredient_id = p_ingredient))
$$;

-- recipe.cost per portion: Σ(line qty ÷ yield × unit cost) ÷ portions. A sub-recipe line's qty is in
-- portions of that sub-recipe. Null when any ingredient has no price: an incomplete cost is not a cost.
create function private.recipe_unit_cost(p_org uuid, p_recipe uuid, p_date date, p_depth integer default 0)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  v_yield numeric;
  v_total numeric := 0;
  v_line record;
  v_unit numeric;
begin
  if p_depth > 5 then
    raise exception 'sub-recipes nest more than five deep' using errcode = 'invalid_parameter_value';
  end if;
  select yield_portions into v_yield from public.recipes where org_id = p_org and id = p_recipe;
  if v_yield is null then return null; end if;
  for v_line in select * from public.recipe_lines where org_id = p_org and recipe_id = p_recipe loop
    v_unit := case when v_line.ingredient_id is not null
                   then private.ingredient_unit_cost(p_org, v_line.ingredient_id, p_date)
                   else private.recipe_unit_cost(p_org, v_line.sub_recipe_id, p_date, p_depth + 1) end;
    if v_unit is null then return null; end if;
    v_total := v_total + v_line.qty_base * 100 / v_line.yield_pct * v_unit;
  end loop;
  return v_total / v_yield;
end $$;

-- The active recipe for an item (a variant's own recipe first, then the item's) and its cost that day.
create function private.item_unit_cost(p_org uuid, p_item uuid, p_variant uuid, p_date date)
returns table (recipe_id uuid, unit_cost numeric)
language sql stable security definer set search_path = '' as $$
  select r.id, private.recipe_unit_cost(p_org, r.id, p_date)
    from public.recipes r
   where r.org_id = p_org and r.menu_item_id = p_item and r.status = 'active'
     and (r.variant_id is not distinct from p_variant or r.variant_id is null)
   order by (r.variant_id is not distinct from p_variant) desc
   limit 1
$$;

-- Snapshot at sale. A bulk load (the seed) sets xedine.bulk_load and backfills in one statement instead.
create function private.snapshot_item_cost() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_date date;
  v_cost record;
begin
  if new.menu_item_id is null or coalesce(current_setting('xedine.bulk_load', true), '') = 'on' then
    return new;
  end if;
  select business_date into v_date from public.orders where org_id = new.org_id and id = new.order_id;
  select * into v_cost from private.item_unit_cost(new.org_id, new.menu_item_id, new.variant_id, v_date);
  if v_cost.unit_cost is null then return new; end if;
  insert into public.order_item_costs (order_item_id, org_id, branch_id, order_id, menu_item_id, business_date,
    recipe_id, unit_cost_poisha, cost_poisha)
  values (new.id, new.org_id, new.branch_id, new.order_id, new.menu_item_id, v_date, v_cost.recipe_id,
    round(v_cost.unit_cost)::bigint, round(v_cost.unit_cost * new.quantity)::bigint)
  on conflict (order_item_id) do nothing;
  return new;
end $$;
create trigger order_items_cost_snapshot after insert on public.order_items
  for each row execute function private.snapshot_item_cost();

-- Cost lines that were sold before a recipe existed (or loaded in bulk): one row per line, from the
-- recipe active now and the ingredient prices of each sale's day. Never overwrites a real snapshot.
create function private.backfill_item_costs(p_org uuid, p_from date, p_to date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  with keys as (
    select distinct oi.menu_item_id, oi.variant_id, o.business_date
      from public.order_items oi join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
     where oi.org_id = p_org and o.business_date between p_from and p_to and oi.menu_item_id is not null
  ), costs as (
    select k.menu_item_id, k.variant_id, k.business_date, c.recipe_id, c.unit_cost
      from keys k cross join lateral private.item_unit_cost(p_org, k.menu_item_id, k.variant_id, k.business_date) c
     where c.unit_cost is not null
  ), ins as (
    insert into public.order_item_costs (order_item_id, org_id, branch_id, order_id, menu_item_id, business_date,
      recipe_id, unit_cost_poisha, cost_poisha)
    select oi.id, oi.org_id, oi.branch_id, oi.order_id, oi.menu_item_id, o.business_date, c.recipe_id,
           round(c.unit_cost)::bigint, round(c.unit_cost * oi.quantity)::bigint
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
      join costs c on c.menu_item_id = oi.menu_item_id and c.variant_id is not distinct from oi.variant_id
                  and c.business_date = o.business_date
     where oi.org_id = p_org and o.business_date between p_from and p_to
    on conflict (order_item_id) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Food cost (METRICS.md): TFC = Σ snapshots of sold lines; TFC% = TFC ÷ sales.net of lines with a
-- recipe; coverage = that net ÷ all sales.net. Completed orders, active lines.
-- ---------------------------------------------------------------------------------------------
create function private.m_food_cost(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (branch_id uuid, net_poisha bigint, costed_net_poisha bigint, tfc_poisha bigint,
               tfc_pct_bps integer, coverage_bps integer)
language sql stable security definer set search_path = '' as $$
  with l as (
    select o.branch_id, oi.net_poisha as net, c.cost_poisha as cost
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
      left join public.order_item_costs c on c.order_item_id = oi.id
     where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
       and o.order_status = 'completed' and o.business_date between p_from and p_to
  ), g as (
    select l.branch_id, sum(l.net)::bigint as net,
           coalesce(sum(l.net) filter (where l.cost is not null), 0)::bigint as costed,
           coalesce(sum(l.cost), 0)::bigint as tfc
      from l group by grouping sets ((l.branch_id), ())
  )
  select g.branch_id, g.net, g.costed, g.tfc,
         case when g.costed > 0 then round(g.tfc * 10000.0 / g.costed)::integer end,
         case when g.net > 0 then round(g.costed * 10000.0 / g.net)::integer end
    from g order by g.branch_id nulls last
$$;

-- Menu engineering (Kasavana–Smith, METRICS.md). Popularity is high when an item's share of units is
-- at least 0.7 ÷ n, n = items sold in the period (ADR 0016 §3). Margin is high when the item's
-- contribution per unit is at least the unit-weighted average over costed items. Items with no recipe
-- are "unknown", never guessed.
create function private.m_menu_matrix(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (menu_item_id uuid, name text, qty bigint, net_poisha bigint, cost_poisha bigint,
               cm_poisha bigint, cm_per_unit_poisha bigint, food_cost_bps integer, popularity text,
               margin text, class text)
language sql stable security definer set search_path = '' as $$
  with l as (
    select oi.menu_item_id, oi.quantity, oi.net_poisha, c.cost_poisha,
           (c.order_item_id is not null) as costed
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
      left join public.order_item_costs c on c.order_item_id = oi.id
     where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
       and o.order_status = 'completed' and o.business_date between p_from and p_to
       and oi.menu_item_id is not null
  ), i as (
    select l.menu_item_id, sum(l.quantity)::bigint as qty, sum(l.net_poisha)::bigint as net,
           -- An item counts as costed only when every sold unit was.
           case when bool_and(l.costed) then sum(l.cost_poisha)::bigint end as cost
      from l group by l.menu_item_id
  ), totals as (
    select count(*) as n, sum(qty) as units,
           sum(net - cost) filter (where cost is not null) as cm_all,
           sum(qty) filter (where cost is not null) as costed_units
      from i
  )
  select i.menu_item_id, mi.name, i.qty, i.net, i.cost,
         i.net - i.cost,
         case when i.cost is not null then round((i.net - i.cost)::numeric / i.qty)::bigint end,
         case when i.cost is not null and i.net > 0 then round(i.cost * 10000.0 / i.net)::integer end,
         case when i.qty * t.n * 10 >= 7 * t.units then 'high' else 'low' end,
         case when i.cost is null then 'unknown'
              when (i.net - i.cost)::numeric / i.qty >= t.cm_all::numeric / t.costed_units then 'high'
              else 'low' end,
         case when i.cost is null then 'unknown'
              when i.qty * t.n * 10 >= 7 * t.units then
                case when (i.net - i.cost)::numeric / i.qty >= t.cm_all::numeric / t.costed_units then 'star' else 'plowhorse' end
              else
                case when (i.net - i.cost)::numeric / i.qty >= t.cm_all::numeric / t.costed_units then 'puzzle' else 'dog' end
         end
    from i cross join totals t
    left join public.menu_items mi on mi.org_id = p_org and mi.id = i.menu_item_id
   order by i.net desc
$$;

-- Price & portion simulator: what an item's contribution would be at another printed price and/or
-- portion size, and what that is worth at the last 28 days' volume. Deterministic, labelled a projection.
create function private.m_simulate_item(p_org uuid, p_item uuid, p_price bigint, p_portion_bps integer, p_date date)
returns table (current_price_poisha bigint, current_net_unit_poisha bigint, current_cost_poisha bigint,
               current_cm_poisha bigint, current_food_cost_bps integer, new_price_poisha bigint,
               new_net_unit_poisha bigint, new_cost_poisha bigint, new_cm_poisha bigint, new_food_cost_bps integer,
               qty_28d bigint, cm_change_28d_poisha bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg record;
  v_price bigint;
  v_cost numeric;
  v_new_price bigint := coalesce(p_price, 0);
  v_net_now bigint;
  v_net_new bigint;
  v_cost_now bigint;
  v_cost_new bigint;
  v_qty bigint;
begin
  if p_portion_bps is null or p_portion_bps <= 0 or p_portion_bps > 30000 then
    raise exception 'portion must be between 0%% and 300%%' using errcode = 'invalid_parameter_value';
  end if;
  select price_includes_vat, vat_rate_bps into v_cfg from public.org_settings where org_id = p_org;
  select base_price_poisha into v_price from public.menu_items where org_id = p_org and id = p_item;
  if v_price is null then raise exception 'unknown item' using errcode = 'invalid_parameter_value'; end if;
  if p_price is null then v_new_price := v_price; end if;
  select c.unit_cost into v_cost from private.item_unit_cost(p_org, p_item, null, p_date) c;
  if v_cost is null then raise exception 'this item has no costed recipe' using errcode = 'invalid_parameter_value'; end if;
  select a.net into v_net_now from private.compute_line_amounts(v_price, 0, v_cfg.price_includes_vat, v_cfg.vat_rate_bps, 0) a;
  select a.net into v_net_new from private.compute_line_amounts(v_new_price, 0, v_cfg.price_includes_vat, v_cfg.vat_rate_bps, 0) a;
  v_cost_now := round(v_cost)::bigint;
  v_cost_new := round(v_cost * p_portion_bps / 10000)::bigint;
  select coalesce(sum(oi.quantity), 0) into v_qty
    from public.order_items oi join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
   where oi.org_id = p_org and oi.menu_item_id = p_item and oi.status = 'active' and o.order_status = 'completed'
     and o.business_date between p_date - 28 and p_date - 1;
  return query select v_price, v_net_now, v_cost_now, v_net_now - v_cost_now,
    case when v_net_now > 0 then round(v_cost_now * 10000.0 / v_net_now)::integer end,
    v_new_price, v_net_new, v_cost_new, v_net_new - v_cost_new,
    case when v_net_new > 0 then round(v_cost_new * 10000.0 / v_net_new)::integer end,
    v_qty, ((v_net_new - v_cost_new) - (v_net_now - v_cost_now)) * v_qty;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Margin detectors (Phase 3). Both structural: they report money the menu loses, not a person.
--   margin.below_target — an item's food cost % over the org target; impact = cost above target.
--   channel.negative_margin — an item that loses money on a platform after its commission (S3 in full).
-- ---------------------------------------------------------------------------------------------
create function private.detect_margin(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (
    select private.detector_config(p_org) as c,
           (select target_food_cost_bps from public.org_cost_settings where org_id = p_org) as target
  ), l as (
    select o.branch_id, oi.menu_item_id, o.channel_id, oi.quantity, oi.net_poisha, c.cost_poisha
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
      join public.order_item_costs c on c.order_item_id = oi.id
     where oi.org_id = p_org and oi.status = 'active' and o.order_status = 'completed'
       and o.business_date between p_from and p_to
  ), by_item as (
    select l.branch_id, l.menu_item_id, sum(l.quantity)::bigint as qty, sum(l.net_poisha)::bigint as net,
           sum(l.cost_poisha)::bigint as cost
      from l group by l.branch_id, l.menu_item_id
  ), by_channel as (
    select l.branch_id, l.menu_item_id, l.channel_id, sum(l.quantity)::bigint as qty,
           sum(l.net_poisha)::bigint as net, sum(l.cost_poisha)::bigint as cost
      from l group by l.branch_id, l.menu_item_id, l.channel_id
  )
  select 'margin.below_target', b.branch_id, b.menu_item_id::text,
         jsonb_build_object('menu_item_id', b.menu_item_id, 'item_name', mi.name),
         b.cost - private.mul_bps(b.net, cfg.target),
         'high'::public.confidence_level,
         '["food_cost.theoretical_pct", "item.margin_pct"]'::jsonb,
         jsonb_build_object('qty', b.qty, 'net_poisha', b.net, 'cost_poisha', b.cost,
           'food_cost_bps', round(b.cost * 10000.0 / b.net), 'target_bps', cfg.target),
         '["raise_price", "trim_portion", "renegotiate_supplier"]'::jsonb
    from by_item b cross join cfg
    left join public.menu_items mi on mi.org_id = p_org and mi.id = b.menu_item_id
   where cfg.target is not null and b.net > 0
     and b.qty >= (cfg.c ->> 'margin_min_qty')::integer
     and b.cost * 10000 > b.net * cfg.target
     and b.cost - private.mul_bps(b.net, cfg.target) >= (cfg.c ->> 'min_impact_poisha')::bigint
  union all
  select 'channel.negative_margin', bc.branch_id, bc.menu_item_id::text || ':' || bc.channel_id::text,
         jsonb_build_object('menu_item_id', bc.menu_item_id, 'item_name', mi.name,
                            'channel_id', bc.channel_id, 'channel_name', ch.name),
         bc.cost + private.mul_bps(bc.net, cc.commission_bps) - bc.net,
         'high'::public.confidence_level,
         '["item.contribution_margin", "commission.value"]'::jsonb,
         jsonb_build_object('qty', bc.qty, 'net_poisha', bc.net, 'cost_poisha', bc.cost,
           'commission_bps', cc.commission_bps, 'commission_poisha', private.mul_bps(bc.net, cc.commission_bps)),
         '["raise_platform_prices", "remove_from_platform", "review_combo_margins"]'::jsonb
    from by_channel bc cross join cfg
    join public.channels ch on ch.org_id = p_org and ch.id = bc.channel_id
    join lateral (
      select x.commission_bps from public.channel_commissions x
       where x.org_id = p_org and x.channel_id = bc.channel_id and x.effective_from <= p_to
       order by x.effective_from desc limit 1
    ) cc on true
    left join public.menu_items mi on mi.org_id = p_org and mi.id = bc.menu_item_id
   where cc.commission_bps > 0
     and bc.qty >= (cfg.c ->> 'margin_min_qty')::integer
     and bc.cost + private.mul_bps(bc.net, cc.commission_bps) - bc.net >= (cfg.c ->> 'min_impact_poisha')::bigint
$$;

create or replace function private.detector_defaults() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'peer_min_ratio_x100', 200,
    'peer_min_z_x100', 300,
    'peer_min_count', 5,
    'min_impact_poisha', 50000,
    'cash_share_min_orders', 60,
    'cash_share_min_gap_bps', 1500,
    'cash_share_min_z_x100', 400,
    'over_short_min_shortage_poisha', 100000,
    'over_short_min_short_shifts', 3,
    'commission_min_bps', 1500,
    'margin_min_qty', 10
  )
$$;

create or replace function private.detect_all(p_org uuid, p_from date, p_to date, p_kinds text[])
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  select * from private.detect_staff_anomalies(p_org, p_from, p_to) where 'staff' = any (p_kinds)
  union all
  select * from private.detect_cash_share(p_org, p_from, p_to) where 'cash_share' = any (p_kinds)
  union all
  select * from private.detect_over_short(p_org, p_from, p_to) where 'over_short' = any (p_kinds)
  union all
  select * from private.detect_commission_drag(p_org, p_from, p_to) where 'commission' = any (p_kinds)
  union all
  select * from private.detect_margin(p_org, p_from, p_to) where 'margin' = any (p_kinds)
$$;

-- Margins are structural, like commission: the month close reports them.
create or replace function private.close_business_day(p_org uuid, p_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_completed integer;
  v_week_start integer := coalesce((select week_start from public.org_settings where org_id = p_org), 6);
  v_weekly integer := 0;
  v_monthly integer := 0;
begin
  with done as (
    update public.orders set order_status = 'completed'
     where org_id = p_org and business_date = p_date
       and order_status in ('sent_to_kitchen', 'preparing', 'ready', 'served', 'open')
       and payment_status = 'paid'
    returning id, org_id, branch_id
  ), ev as (
    insert into public.order_events (org_id, branch_id, order_id, event_type, meta)
    select org_id, branch_id, id, 'completed', '{"by": "day_close"}'::jsonb from done
    returning 1
  )
  select count(*) into v_completed from ev;

  if extract(dow from p_date + 1)::integer = v_week_start then
    v_weekly := private.save_findings(p_org, p_date - 6, p_date, array['staff', 'cash_share', 'over_short']);
  end if;
  if extract(day from p_date + 1) = 1 then
    v_monthly := private.save_findings(p_org, date_trunc('month', p_date)::date, p_date, array['commission', 'margin']);
  end if;
  return jsonb_build_object('completed_orders', v_completed, 'weekly_findings', v_weekly, 'monthly_findings', v_monthly);
end $$;

create or replace function public.scan_findings(p_org uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
  v_week_start integer := coalesce((select week_start from public.org_settings where org_id = p_org), 6);
  v_this_week date;
  v_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_n integer := 0;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_this_week := v_today - ((extract(dow from v_today)::integer - v_week_start + 7) % 7);
  for k in 1..4 loop
    v_n := v_n + private.save_findings(p_org, v_this_week - 7 * k, v_this_week - 7 * k + 6,
                                       array['staff', 'cash_share', 'over_short']);
  end loop;
  v_n := v_n + private.save_findings(p_org, v_month, (v_month + interval '1 month - 1 day')::date,
                                     array['commission', 'margin']);
  perform private.write_audit(p_org, null, 'findings.scan', 'finding', null, null,
    jsonb_build_object('findings', v_n), null, null, null);
  return v_n;
end $$;

-- Evidence rows for the two new finding types: the item's sales by day (and by channel).
create or replace function public.finding_events(p_finding uuid)
returns table (occurred_at timestamptz, business_date date, order_id uuid, order_number integer,
               kind text, value_poisha bigint, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare
  f public.findings;
  v_staff uuid;
  v_item uuid;
  v_channel uuid;
begin
  select * into f from public.findings where id = p_finding;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  perform private.require_money(f.org_id);
  v_staff := nullif(f.subject ->> 'staff_id', '')::uuid;
  v_item := nullif(f.subject ->> 'menu_item_id', '')::uuid;
  v_channel := nullif(f.subject ->> 'channel_id', '')::uuid;

  if f.type = 'void.after_kot' then
    return query
      select v.voided_at, o.business_date, o.id, o.order_number, 'void'::text, v.value_poisha,
             coalesce(rc.label, v.reason_note, '')
        from public.voids v join public.orders o on o.org_id = v.org_id and o.id = v.order_id
        left join public.reason_codes rc on rc.org_id = v.org_id and rc.id = v.reason_code_id
       where v.org_id = f.org_id and o.branch_id = f.branch_id and v.voided_by_staff_id = v_staff and v.after_kot
         and o.business_date between f.period_start and f.period_end
       order by v.voided_at;
  elsif f.type = 'discount.rate' then
    return query
      select d.created_at, o.business_date, o.id, o.order_number, 'discount'::text, d.amount_poisha,
             coalesce(rc.label, d.reason_note, '')
        from public.discounts d join public.orders o on o.org_id = d.org_id and o.id = d.order_id
        left join public.reason_codes rc on rc.org_id = d.org_id and rc.id = d.reason_code_id
       where d.org_id = f.org_id and o.branch_id = f.branch_id and d.applied_by_staff_id = v_staff
         and o.business_date between f.period_start and f.period_end
       order by d.created_at;
  elsif f.type = 'refund.rate' then
    return query
      select r.created_at, o.business_date, o.id, o.order_number, 'refund'::text, r.amount_poisha,
             coalesce(rc.label, r.reason_note, '')
        from public.refunds r join public.orders o on o.org_id = r.org_id and o.id = r.order_id
        left join public.reason_codes rc on rc.org_id = r.org_id and rc.id = r.reason_code_id
       where r.org_id = f.org_id and o.branch_id = f.branch_id and r.refunded_by_staff_id = v_staff
         and o.business_date between f.period_start and f.period_end
       order by r.created_at;
  elsif f.type = 'cash.over_short' then
    return query
      select sh.closed_at, sh.business_date, null::uuid, null::integer, 'shift'::text, sh.over_short_poisha, ''::text
        from public.shifts sh
       where sh.org_id = f.org_id and sh.branch_id = f.branch_id and sh.closed_by_staff_id = v_staff
         and sh.status = 'closed'
         and coalesce(sh.business_date, private.business_date(sh.opened_at, private.org_cutoff(f.org_id)))
             between f.period_start and f.period_end
       order by sh.closed_at;
  elsif f.type = 'commission.drag' then
    return query
      select min(o.placed_at), o.business_date, null::uuid, count(*)::integer, 'channel_day'::text,
             sum(o.net_poisha)::bigint, ''::text
        from public.orders o
       where o.org_id = f.org_id and o.branch_id = f.branch_id and o.channel_id = nullif(f.subject_key, '')::uuid
         and o.order_status = 'completed' and o.business_date between f.period_start and f.period_end
       group by o.business_date order by o.business_date;
  elsif f.type = 'cash.share' then
    return query
      select min(o.placed_at), o.business_date, null::uuid, count(*)::integer, 'staff_day'::text,
             coalesce(sum(o.total_poisha) filter (where exists (
               select 1 from public.payments p where p.org_id = o.org_id and p.order_id = o.id and p.method = 'cash')), 0)::bigint,
             ''::text
        from public.orders o
       where o.org_id = f.org_id and o.branch_id = f.branch_id and o.staff_id = v_staff
         and o.order_status = 'completed' and o.business_date between f.period_start and f.period_end
       group by o.business_date order by o.business_date;
  elsif f.type in ('margin.below_target', 'channel.negative_margin') then
    return query
      select min(o.placed_at), o.business_date, null::uuid, sum(oi.quantity)::integer, 'item_day'::text,
             sum(c.cost_poisha)::bigint, sum(oi.net_poisha)::text
        from public.order_items oi
        join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
        join public.order_item_costs c on c.order_item_id = oi.id
       where oi.org_id = f.org_id and o.branch_id = f.branch_id and oi.menu_item_id = v_item
         and oi.status = 'active' and o.order_status = 'completed'
         and (v_channel is null or o.channel_id = v_channel)
         and o.business_date between f.period_start and f.period_end
       group by o.business_date order by o.business_date;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Recipes: saving and approving are owner RPCs, audited, and always create a new active version.
-- ---------------------------------------------------------------------------------------------
-- p_lines: [{ingredient_id? | ingredient?: name, base?: g|ml|pcs, sub_recipe_id?, qty_base, yield_pct?}]
create function private.write_recipe(
  p_org uuid, p_item uuid, p_variant uuid, p_name text, p_yield numeric, p_lines jsonb,
  p_source public.recipe_source, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_recipe uuid;
  v_version integer;
  v_line jsonb;
  v_ingredient uuid;
  v_qty numeric;
  v_yield_pct numeric;
begin
  if p_yield is null or p_yield <= 0 then
    raise exception 'yield must be positive' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'a recipe needs at least one line' using errcode = 'invalid_parameter_value';
  end if;
  if p_item is not null and not exists (select 1 from public.menu_items where org_id = p_org and id = p_item) then
    raise exception 'unknown menu item' using errcode = 'invalid_parameter_value';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.recipes
   where org_id = p_org and menu_item_id is not distinct from p_item and variant_id is not distinct from p_variant;
  update public.recipes set status = 'archived'
   where org_id = p_org and menu_item_id is not distinct from p_item and variant_id is not distinct from p_variant
     and status = 'active' and p_item is not null;
  insert into public.recipes (org_id, menu_item_id, variant_id, name, yield_portions, status, source, version,
    created_by, approved_by, approved_at, notes)
  values (p_org, p_item, p_variant, p_name, p_yield, 'active', p_source, v_version,
    (select auth.uid()), (select auth.uid()), now(), left(nullif(btrim(p_notes), ''), 1000))
  returning id into v_recipe;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line ->> 'qty_base')::numeric;
    v_yield_pct := coalesce((v_line ->> 'yield_pct')::numeric, 100);
    if v_qty is null or v_qty <= 0 or v_yield_pct <= 0 or v_yield_pct > 100 then
      raise exception 'each line needs a positive quantity and a yield of 1–100%%' using errcode = 'invalid_parameter_value';
    end if;
    if nullif(v_line ->> 'sub_recipe_id', '') is not null then
      insert into public.recipe_lines (org_id, recipe_id, sub_recipe_id, qty_base, yield_pct)
      values (p_org, v_recipe, (v_line ->> 'sub_recipe_id')::uuid, v_qty, v_yield_pct);
      continue;
    end if;
    v_ingredient := nullif(v_line ->> 'ingredient_id', '')::uuid;
    if v_ingredient is null then
      -- A drafted ingredient is matched by name, or created (without a price: costing stays "incomplete"
      -- until someone enters one, never guessed).
      if nullif(btrim(v_line ->> 'ingredient'), '') is null then
        raise exception 'each line needs an ingredient' using errcode = 'invalid_parameter_value';
      end if;
      select id into v_ingredient from public.ingredients
       where org_id = p_org and lower(name) = lower(btrim(v_line ->> 'ingredient'));
      if v_ingredient is null then
        insert into public.ingredients (org_id, name, base)
        values (p_org, left(btrim(v_line ->> 'ingredient'), 120),
                coalesce(nullif(v_line ->> 'base', ''), 'g')::public.base_unit)
        returning id into v_ingredient;
      end if;
    end if;
    insert into public.recipe_lines (org_id, recipe_id, ingredient_id, qty_base, yield_pct)
    values (p_org, v_recipe, v_ingredient, v_qty, v_yield_pct);
  end loop;

  -- A sub-recipe loop would never cost; refuse it now rather than at the first sale.
  perform private.recipe_unit_cost(p_org, v_recipe, current_date);
  return v_recipe;
end $$;

create function public.save_recipe(
  p_org uuid, p_item uuid, p_variant uuid, p_name text, p_yield numeric, p_lines jsonb, p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_id := private.write_recipe(p_org, p_item, p_variant, p_name, p_yield, p_lines, 'manual', p_notes);
  -- Past sales of this item get a cost from now on; real snapshots are never overwritten.
  if p_item is not null then
    perform private.backfill_item_costs(p_org, current_date - 90, current_date);
  end if;
  return v_id;
end $$;

-- The only way a draft becomes a recipe: the owner approves it, possibly after the chef edited it.
create function public.approve_recipe_draft(p_draft uuid, p_payload jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  d public.recipe_drafts;
  v_payload jsonb;
  v_id uuid;
begin
  select * into d from public.recipe_drafts where id = p_draft for update;
  if not found or not private.has_role(d.org_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if d.status <> 'pending_review' then
    raise exception 'this draft was already reviewed' using errcode = 'invalid_parameter_value';
  end if;
  if d.menu_item_id is null then
    raise exception 'link the draft to a menu item first' using errcode = 'invalid_parameter_value';
  end if;
  v_payload := coalesce(p_payload, d.payload);
  v_id := private.write_recipe(d.org_id, d.menu_item_id, null, d.item_name,
    coalesce((v_payload ->> 'yield_portions')::numeric, 1), v_payload -> 'lines', 'ai_draft', v_payload ->> 'notes');
  update public.recipe_drafts
     set status = 'confirmed', payload = v_payload, reviewed_by = (select auth.uid()), reviewed_at = now(), recipe_id = v_id
   where id = p_draft;
  perform private.backfill_item_costs(d.org_id, current_date - 90, current_date);
  perform private.write_audit(d.org_id, null, 'recipe.approve_draft', 'recipe', v_id::text,
    jsonb_build_object('draft', p_draft), v_payload, null, null, null);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public wrappers (money-gated) and grants
-- ---------------------------------------------------------------------------------------------
create function public.metric_food_cost(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (branch_id uuid, net_poisha bigint, costed_net_poisha bigint, tfc_poisha bigint,
               tfc_pct_bps integer, coverage_bps integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_money(p_org);
  return query select * from private.m_food_cost(p_org, private.metric_scope(p_org, p_branch), p_from, p_to);
end $$;

create function public.metric_menu_matrix(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (menu_item_id uuid, name text, qty bigint, net_poisha bigint, cost_poisha bigint,
               cm_poisha bigint, cm_per_unit_poisha bigint, food_cost_bps integer, popularity text,
               margin text, class text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_money(p_org);
  return query select * from private.m_menu_matrix(p_org, private.metric_scope(p_org, p_branch), p_from, p_to);
end $$;

create function public.metric_simulate_item(p_org uuid, p_item uuid, p_price bigint, p_portion_bps integer, p_now timestamptz)
returns table (current_price_poisha bigint, current_net_unit_poisha bigint, current_cost_poisha bigint,
               current_cm_poisha bigint, current_food_cost_bps integer, new_price_poisha bigint,
               new_net_unit_poisha bigint, new_cost_poisha bigint, new_cm_poisha bigint, new_food_cost_bps integer,
               qty_28d bigint, cm_change_28d_poisha bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_money(p_org);
  return query select * from private.m_simulate_item(p_org, p_item, p_price, p_portion_bps,
    private.business_date(p_now, private.org_cutoff(p_org)));
end $$;

-- Recipe costs per portion today, for the recipe list, with the item's VAT-exclusive price and food
-- cost %. Sub-recipes (no menu item) have no price. Money-gated.
create function public.metric_recipe_costs(p_org uuid, p_now timestamptz)
returns table (recipe_id uuid, menu_item_id uuid, unit_cost_poisha bigint, complete boolean,
               price_poisha bigint, net_price_poisha bigint, food_cost_bps integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := private.business_date(p_now, private.org_cutoff(p_org));
  v_cfg record;
begin
  perform private.require_money(p_org);
  select price_includes_vat, vat_rate_bps into v_cfg from public.org_settings where org_id = p_org;
  return query
    with c as (
      select r.id, r.menu_item_id, private.recipe_unit_cost(p_org, r.id, v_date) as cost, mi.base_price_poisha as price
        from public.recipes r
        left join public.menu_items mi on mi.org_id = r.org_id and mi.id = r.menu_item_id
       where r.org_id = p_org and r.status = 'active'
    )
    select c.id, c.menu_item_id, round(c.cost)::bigint, c.cost is not null, c.price, a.net,
           case when c.cost is not null and a.net > 0 then round(round(c.cost) * 10000.0 / a.net)::integer end
      from c
      left join lateral private.compute_line_amounts(c.price, 0, v_cfg.price_includes_vat, v_cfg.vat_rate_bps, 0) a
        on c.price is not null;
end $$;

create function public.job_backfill_item_costs(p_org uuid, p_from date, p_to date) returns integer
language sql security definer set search_path = '' as $$
  select private.backfill_item_costs(p_org, p_from, p_to)
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname in ('record_ingredient_cost', 'ingredient_unit_cost', 'recipe_unit_cost',
              'item_unit_cost', 'snapshot_item_cost', 'backfill_item_costs', 'm_food_cost', 'm_menu_matrix',
              'm_simulate_item', 'detect_margin', 'write_recipe'))
        or (n.nspname = 'public' and p.proname in ('metric_food_cost', 'metric_menu_matrix', 'metric_simulate_item',
              'metric_recipe_costs', 'save_recipe', 'approve_recipe_draft', 'job_backfill_item_costs'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname like 'job\_%' then
      execute format('revoke execute on function %s from authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
    elsif f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

comment on function public.metric_food_cost is 'food_cost.theoretical, _pct and recipes.coverage_pct (money-gated). Phase 3.';
comment on function public.metric_menu_matrix is 'Kasavana–Smith menu engineering classes (money-gated). Phase 3.';
comment on function public.metric_simulate_item is 'Price and portion what-if for one item, at the last 28 days'' volume (money-gated). Phase 3.';
comment on function public.save_recipe is 'Owner saves a recipe as a new active version; audited by trigger. Phase 3.';
comment on function public.approve_recipe_draft is 'Owner approves a (possibly edited) draft into an active recipe. Phase 3.';

-- ---------------------------------------------------------------------------------------------
-- LLM gateway v0 (ADR 0016 §5): usage and cost per org, day, model and feature; the daily cap reads it.
-- ---------------------------------------------------------------------------------------------
create function public.record_ai_usage(
  p_org uuid, p_date date, p_model text, p_feature text, p_input bigint, p_output bigint,
  p_cache_read bigint, p_cache_write bigint, p_cost_usd_micros bigint
) returns void language sql security definer set search_path = '' as $$
  insert into public.ai_usage (org_id, usage_date, model, feature, requests, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, cost_usd_micros)
  values (p_org, p_date, p_model, p_feature, 1, p_input, p_output, p_cache_read, p_cache_write, p_cost_usd_micros)
  on conflict (org_id, usage_date, model, feature) do update set
    requests = public.ai_usage.requests + 1,
    input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
    cache_read_tokens = public.ai_usage.cache_read_tokens + excluded.cache_read_tokens,
    cache_write_tokens = public.ai_usage.cache_write_tokens + excluded.cache_write_tokens,
    cost_usd_micros = public.ai_usage.cost_usd_micros + excluded.cost_usd_micros
$$;
revoke execute on function public.record_ai_usage(uuid, date, text, text, bigint, bigint, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.record_ai_usage(uuid, date, text, text, bigint, bigint, bigint, bigint, bigint)
  to service_role;
comment on function public.record_ai_usage is 'LLM gateway only (service role): add one request''s tokens and cost. Phase 3.';
