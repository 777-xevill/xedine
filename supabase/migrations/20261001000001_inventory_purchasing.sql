-- Phase 5 (ADR 0018): purchasing, inventory and waste — the minimum inputs that unlock real food-cost truth.
--
-- Stock maths follows METRICS.md "Inventory" with one SQL implementation each. Quantities are base units
-- (g, ml, pcs); "usage" is in *bought* quantity: a recipe line of 90 g at 90% yield uses 100 g, the same
-- rule private.recipe_unit_cost prices. Purchases carry prices, so managers never read them (ADR 0007);
-- stock quantities derived from them are not money and reach every stock role.
--
-- Every stock-moving write goes through an audited RPC (CLAUDE.md #5). AI purchase drafts sit in
-- purchase_drafts and cannot touch stock until a person confirms them (CLAUDE.md #4).

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------
alter table public.org_settings
  -- The guided weekly count is due on this weekday (0 = Sunday … 6 = Saturday; a closing count).
  add column count_weekday smallint not null default 0 check (count_weekday between 0 and 6),
  -- How many of the costliest ingredients the guided count asks for (ROADMAP: top 10–15).
  add column guided_count_size smallint not null default 12 check (guided_count_size between 5 and 40);

-- METRICS.md "Costing": unit cost = weighted average paid price over 14 days, or the last price paid.
alter table public.org_cost_settings
  add column unit_cost_method text not null default 'weighted_14d'
    check (unit_cost_method in ('weighted_14d', 'last'));

-- The business day a transfer left and arrived, set by the RPCs (branch cutoff), so stock maths can
-- index them instead of converting timestamps row by row.
alter table public.transfers
  add column sent_on date,
  add column received_on date;
create index transfers_sent_on_idx on public.transfers (org_id, from_branch_id, sent_on);
create index transfers_received_on_idx on public.transfers (org_id, to_branch_id, received_on);
create index transfer_lines_parent_idx on public.transfer_lines (org_id, transfer_id);

create index stock_counts_counted_on_idx on public.stock_counts (org_id, branch_id, counted_on);
create index stock_count_lines_parent_idx on public.stock_count_lines (org_id, stock_count_id);
create index purchase_drafts_review_idx on public.purchase_drafts (org_id, branch_id, status, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Stock-moving tables are written only through the audited RPCs below (like the POS tables, ADR 0014).
-- purchase_drafts stays directly writable: a draft moves nothing.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['purchases', 'purchase_lines', 'stock_counts', 'stock_count_lines', 'waste_logs'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('revoke insert, update, delete, truncate on table public.%I from authenticated', t);
    update private.policy_registry
       set write_roles = '{}', allow_delete = false,
           notes = 'written only by the audited Phase 5 RPCs (ADR 0018)'
     where table_name = t;
  end loop;
end $$;

drop policy if exists transfers_insert on public.transfers;
drop policy if exists transfers_update on public.transfers;
drop policy if exists transfer_lines_insert on public.transfer_lines;
drop policy if exists transfer_lines_update on public.transfer_lines;
revoke insert, update, delete, truncate on table public.transfers from authenticated;
revoke insert, update, delete, truncate on table public.transfer_lines from authenticated;
update private.policy_registry
   set notes = 'visible from either branch; written only by send_transfer / receive_transfer (ADR 0018)'
 where table_name = 'transfers';
update private.policy_registry
   set notes = 'follows the parent transfer; written only by send_transfer / receive_transfer (ADR 0018)'
 where table_name = 'transfer_lines';

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create function private.branch_cutoff(p_org uuid, p_branch uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select b.cutoff_minutes from public.branches b where b.org_id = p_org and b.id = p_branch),
    (select s.default_cutoff_minutes from public.org_settings s where s.org_id = p_org),
    240)
$$;

-- The branches a caller may read stock for: metric_scope, narrowed to the stock roles (cashiers sell,
-- they do not count). Jobs (service role) see every branch of the explicit org.
create function private.stock_scope(p_org uuid, p_branch uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid[] := private.metric_scope(p_org, p_branch);
begin
  if private.is_service_role() then return v; end if;
  select coalesce(array_agg(b), '{}') into v from unnest(v) as b
   where private.can_access_branch_role(p_org, b,
           array['owner', 'manager', 'kitchen', 'purchaser', 'accountant']::public.app_role[]);
  if cardinality(v) = 0 then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return v;
end $$;

-- The active recipe for an item (a variant's own first) — the rule private.item_unit_cost uses.
create function private.active_recipe(p_org uuid, p_item uuid, p_variant uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.recipes r
   where r.org_id = p_org and r.menu_item_id = p_item and r.status = 'active'
     and (r.variant_id is not distinct from p_variant or r.variant_id is null)
   order by (r.variant_id is not distinct from p_variant) desc
   limit 1
$$;

-- One portion of a recipe as bought ingredients: Σ line qty ÷ yield ÷ portions, sub-recipes walked down
-- (a sub-recipe line's qty is portions of it). Five levels at most, as in recipe_unit_cost.
create function private.recipe_explode(p_org uuid, p_recipe uuid)
returns table (ingredient_id uuid, qty numeric)
language sql stable security definer set search_path = '' as $$
  with recursive walk (recipe_id, factor, depth) as (
    select p_recipe, 1::numeric, 0
    union all
    select rl.sub_recipe_id, w.factor * rl.qty_base * 100 / rl.yield_pct / r.yield_portions, w.depth + 1
      from walk w
      join public.recipes r on r.org_id = p_org and r.id = w.recipe_id
      join public.recipe_lines rl on rl.org_id = p_org and rl.recipe_id = w.recipe_id
     where rl.sub_recipe_id is not null and w.depth < 5
  )
  select rl.ingredient_id, sum(w.factor * rl.qty_base * 100 / rl.yield_pct / r.yield_portions)
    from walk w
    join public.recipes r on r.org_id = p_org and r.id = w.recipe_id
    join public.recipe_lines rl on rl.org_id = p_org and rl.recipe_id = w.recipe_id
   where rl.ingredient_id is not null
   group by rl.ingredient_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Stock movements by branch, business day and ingredient (METRICS.md "Inventory"):
--   usage        usage.theoretical — completed orders' active lines × the recipe they were costed with
--                (the sale-time snapshot's recipe, else the item's active recipe), in bought quantity
--   waste        waste.logged — ingredient waste as entered; menu-item waste exploded through its recipe
--   purchase     confirmed purchases (qty and what was paid)
--   transfer_out sent from the branch (on the day it left)
--   transfer_in  received by the branch (the received quantity, on the day it arrived)
-- ---------------------------------------------------------------------------------------------
create function private.m_stock_moves(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (branch_id uuid, business_date date, ingredient_id uuid, kind text, qty numeric, value_poisha bigint)
language sql stable security definer set search_path = '' as $$
  with sold as (
    select oi.branch_id, o.business_date, oi.menu_item_id, oi.variant_id, c.recipe_id as snap,
           sum(oi.quantity) as qty
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
      left join public.order_item_costs c on c.order_item_id = oi.id
     where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
       and o.order_status = 'completed' and o.business_date between p_from and p_to
       and oi.menu_item_id is not null
     group by 1, 2, 3, 4, 5
  ), sold_r as (
    select s.branch_id, s.business_date, s.qty,
           coalesce(s.snap, private.active_recipe(p_org, s.menu_item_id, s.variant_id)) as recipe_id
      from sold s
  ), item_waste as (
    select w.branch_id, w.business_date, sum(w.qty_portions) as qty,
           private.active_recipe(p_org, w.menu_item_id, null) as recipe_id
      from public.waste_logs w
     where w.org_id = p_org and w.branch_id = any (p_branches) and w.business_date between p_from and p_to
       and w.ingredient_id is null and w.menu_item_id is not null and w.qty_portions is not null
     group by w.branch_id, w.business_date, w.menu_item_id
  )
  select r.branch_id, r.business_date, e.ingredient_id, 'usage'::text, sum(r.qty * e.qty), null::bigint
    from sold_r r cross join lateral private.recipe_explode(p_org, r.recipe_id) e
   where r.recipe_id is not null
   group by 1, 2, 3
  union all
  select w.branch_id, w.business_date, w.ingredient_id, 'waste', sum(w.qty_base), null
    from public.waste_logs w
   where w.org_id = p_org and w.branch_id = any (p_branches) and w.business_date between p_from and p_to
     and w.ingredient_id is not null and w.qty_base is not null
   group by 1, 2, 3
  union all
  select r.branch_id, r.business_date, e.ingredient_id, 'waste', sum(r.qty * e.qty), null
    from item_waste r cross join lateral private.recipe_explode(p_org, r.recipe_id) e
   where r.recipe_id is not null
   group by 1, 2, 3
  union all
  select p.branch_id, p.purchased_on, pl.ingredient_id, 'purchase', sum(pl.qty_base), sum(pl.line_total_poisha)::bigint
    from public.purchases p
    join public.purchase_lines pl on pl.org_id = p.org_id and pl.purchase_id = p.id
   where p.org_id = p_org and p.branch_id = any (p_branches) and p.status = 'confirmed'
     and p.purchased_on between p_from and p_to
   group by 1, 2, 3
  union all
  select t.from_branch_id, t.sent_on, tl.ingredient_id, 'transfer_out', sum(tl.qty_base_sent), null
    from public.transfers t
    join public.transfer_lines tl on tl.org_id = t.org_id and tl.transfer_id = t.id
   where t.org_id = p_org and t.from_branch_id = any (p_branches)
     and t.status in ('sent', 'received', 'disputed') and t.sent_on between p_from and p_to
   group by 1, 2, 3
  union all
  select t.to_branch_id, t.received_on, tl.ingredient_id, 'transfer_in', sum(coalesce(tl.qty_base_received, 0)), null
    from public.transfers t
    join public.transfer_lines tl on tl.org_id = t.org_id and tl.transfer_id = t.id
   where t.org_id = p_org and t.to_branch_id = any (p_branches)
     and t.status in ('received', 'disputed') and t.received_on between p_from and p_to
   group by 1, 2, 3
$$;

-- stock.theoretical = last count + purchases + transfers in − transfers out − usage.theoretical − waste,
-- everything after the ingredient's last submitted count up to and including p_date (a count on day D is
-- that day's closing stock). Never counted = unknown, not zero. days_of_cover = stock ÷ average daily
-- usage over the 14 days to p_date; bands 🟢 ≥ 7 · 🟡 3–6.99 · 🔴 < 3 unless the ingredient overrides them.
create function private.m_stock(p_org uuid, p_branches uuid[], p_date date)
returns table (
  branch_id uuid, ingredient_id uuid, last_count_date date, last_count_qty numeric,
  purchases_qty numeric, transfers_in_qty numeric, transfers_out_qty numeric, usage_qty numeric,
  waste_qty numeric, stock_qty numeric, in_transit_qty numeric, usage_14d_qty numeric,
  days_of_cover numeric, band text
) language sql stable security definer set search_path = '' as $$
  with last_count as (
    select distinct on (sc.branch_id, l.ingredient_id) sc.branch_id, l.ingredient_id, sc.counted_on,
           l.counted_qty_base as qty
      from public.stock_counts sc
      join public.stock_count_lines l on l.org_id = sc.org_id and l.stock_count_id = sc.id
     where sc.org_id = p_org and sc.branch_id = any (p_branches) and sc.status = 'submitted'
       and sc.counted_on <= p_date
     order by sc.branch_id, l.ingredient_id, sc.counted_on desc, sc.submitted_at desc nulls last
  ), since as (
    select m.branch_id, m.ingredient_id,
           sum(m.qty) filter (where m.kind = 'purchase') as purchases,
           sum(m.qty) filter (where m.kind = 'transfer_in') as t_in,
           sum(m.qty) filter (where m.kind = 'transfer_out') as t_out,
           sum(m.qty) filter (where m.kind = 'usage') as usage,
           sum(m.qty) filter (where m.kind = 'waste') as waste
      from private.m_stock_moves(p_org, p_branches,
             coalesce((select min(counted_on) from last_count), p_date) + 1, p_date) m
      join last_count lc on lc.branch_id = m.branch_id and lc.ingredient_id = m.ingredient_id
     where m.business_date > lc.counted_on
     group by 1, 2
  ), use14 as (
    select m.branch_id, m.ingredient_id, sum(m.qty) as qty
      from private.m_stock_moves(p_org, p_branches, p_date - 13, p_date) m
     where m.kind = 'usage'
     group by 1, 2
  ), transit as (
    select t.to_branch_id as branch_id, tl.ingredient_id, sum(tl.qty_base_sent) as qty
      from public.transfers t
      join public.transfer_lines tl on tl.org_id = t.org_id and tl.transfer_id = t.id
     where t.org_id = p_org and t.to_branch_id = any (p_branches) and t.status = 'sent' and t.sent_on <= p_date
     group by 1, 2
  ), grid as (
    select b.id as branch_id, i.id as ingredient_id, i.cover_green_days, i.cover_red_days
      from unnest(p_branches) as b (id)
      cross join public.ingredients i
     where i.org_id = p_org and i.is_active
  ), s as (
    select g.branch_id, g.ingredient_id, g.cover_green_days, g.cover_red_days,
           lc.counted_on, lc.qty as count_qty,
           coalesce(x.purchases, 0) as purchases, coalesce(x.t_in, 0) as t_in, coalesce(x.t_out, 0) as t_out,
           coalesce(x.usage, 0) as usage, coalesce(x.waste, 0) as waste,
           lc.qty + coalesce(x.purchases, 0) + coalesce(x.t_in, 0) - coalesce(x.t_out, 0)
             - coalesce(x.usage, 0) - coalesce(x.waste, 0) as stock,
           coalesce(tr.qty, 0) as transit, coalesce(u.qty, 0) as use14
      from grid g
      left join last_count lc on lc.branch_id = g.branch_id and lc.ingredient_id = g.ingredient_id
      left join since x on x.branch_id = g.branch_id and x.ingredient_id = g.ingredient_id
      left join use14 u on u.branch_id = g.branch_id and u.ingredient_id = g.ingredient_id
      left join transit tr on tr.branch_id = g.branch_id and tr.ingredient_id = g.ingredient_id
  )
  select s.branch_id, s.ingredient_id, s.counted_on, s.count_qty, s.purchases, s.t_in, s.t_out, s.usage,
         s.waste, s.stock, s.transit, s.use14,
         case when s.stock is not null and s.use14 > 0 then round(s.stock * 14 / s.use14, 2) end,
         case when s.stock is null or s.use14 <= 0 then 'none'
              when s.stock * 14 >= coalesce(s.cover_green_days, 7) * s.use14 then 'green'
              when s.stock * 14 < coalesce(s.cover_red_days, 3) * s.use14 then 'red'
              else 'yellow' end
    from s
   where s.counted_on is not null or s.use14 > 0 or s.transit > 0
   order by s.branch_id, s.ingredient_id
$$;

-- Usage variance between two counts (METRICS.md): per branch and ingredient, the opening count is the
-- latest submitted count on or before p_from, the closing count the latest after it and on or before p_to
-- (so a missed weekly count simply widens the period).
--   usage.actual   = opening + purchases + transfers in − transfers out − closing
--   variance.qty   = usage.actual − usage.theoretical − waste.logged   (positive = more went than should)
--   variance.value = variance.qty × the ingredient's unit cost on the closing day
create function private.m_variance(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (
  branch_id uuid, ingredient_id uuid, opening_date date, opening_qty numeric, closing_date date,
  closing_qty numeric, purchases_qty numeric, purchases_poisha bigint, transfers_in_qty numeric,
  transfers_out_qty numeric, usage_theoretical_qty numeric, waste_qty numeric, usage_actual_qty numeric,
  variance_qty numeric, unit_cost numeric, usage_theoretical_poisha bigint, waste_poisha bigint,
  variance_poisha bigint
) language sql stable security definer set search_path = '' as $$
  with lines as (
    select sc.branch_id, l.ingredient_id, sc.counted_on, l.counted_qty_base as qty, sc.submitted_at
      from public.stock_counts sc
      join public.stock_count_lines l on l.org_id = sc.org_id and l.stock_count_id = sc.id
     where sc.org_id = p_org and sc.branch_id = any (p_branches) and sc.status = 'submitted'
       and sc.counted_on <= p_to
  ), opening as (
    select distinct on (branch_id, ingredient_id) branch_id, ingredient_id, counted_on, qty
      from lines where counted_on <= p_from
     order by branch_id, ingredient_id, counted_on desc, submitted_at desc nulls last
  ), closing as (
    select distinct on (l.branch_id, l.ingredient_id) l.branch_id, l.ingredient_id, l.counted_on, l.qty
      from lines l join opening o on o.branch_id = l.branch_id and o.ingredient_id = l.ingredient_id
     where l.counted_on > o.counted_on
     order by l.branch_id, l.ingredient_id, l.counted_on desc, l.submitted_at desc nulls last
  ), pairs as (
    select o.branch_id, o.ingredient_id, o.counted_on as open_on, o.qty as open_qty,
           c.counted_on as close_on, c.qty as close_qty
      from opening o join closing c on c.branch_id = o.branch_id and c.ingredient_id = o.ingredient_id
  ), moves as (
    select p.branch_id, p.ingredient_id,
           sum(m.qty) filter (where m.kind = 'purchase') as purchases,
           sum(m.value_poisha) filter (where m.kind = 'purchase') as purchases_value,
           sum(m.qty) filter (where m.kind = 'transfer_in') as t_in,
           sum(m.qty) filter (where m.kind = 'transfer_out') as t_out,
           sum(m.qty) filter (where m.kind = 'usage') as usage,
           sum(m.qty) filter (where m.kind = 'waste') as waste
      from pairs p
      join private.m_stock_moves(p_org, p_branches, coalesce((select min(open_on) from pairs), p_to) + 1, p_to) m
        on m.branch_id = p.branch_id and m.ingredient_id = p.ingredient_id
       and m.business_date > p.open_on and m.business_date <= p.close_on
     group by 1, 2
  ), v as (
    select p.*, coalesce(m.purchases, 0) as purchases, coalesce(m.purchases_value, 0) as purchases_value,
           coalesce(m.t_in, 0) as t_in, coalesce(m.t_out, 0) as t_out, coalesce(m.usage, 0) as usage,
           coalesce(m.waste, 0) as waste,
           p.open_qty + coalesce(m.purchases, 0) + coalesce(m.t_in, 0) - coalesce(m.t_out, 0) - p.close_qty as actual,
           private.ingredient_unit_cost(p_org, p.ingredient_id, p.close_on) as unit_cost
      from pairs p left join moves m on m.branch_id = p.branch_id and m.ingredient_id = p.ingredient_id
  )
  select v.branch_id, v.ingredient_id, v.open_on, v.open_qty, v.close_on, v.close_qty, v.purchases,
         v.purchases_value::bigint, v.t_in, v.t_out, v.usage, v.waste, v.actual, v.actual - v.usage - v.waste,
         v.unit_cost, round(v.usage * v.unit_cost)::bigint, round(v.waste * v.unit_cost)::bigint,
         round((v.actual - v.usage - v.waste) * v.unit_cost)::bigint
    from v
   order by v.branch_id, v.ingredient_id
$$;

-- Discipline score (METRICS.md), per branch per open business day, 0–100: bazar entries recorded (25) ·
-- waste log touched (15) · cash close done (20) · scheduled count done (25, full marks on a day with no
-- count due) · recipe coverage ≥ 90% (15). A day with no orders and no shifts is closed and not scored.
create function private.m_discipline(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (
  branch_id uuid, business_date date, open_day boolean, count_due boolean, bazar integer, waste integer,
  cash_close integer, count integer, coverage integer, score integer
) language sql stable security definer set search_path = '' as $$
  with days as (
    select b.id as branch_id, d::date as business_date
      from unnest(p_branches) as b (id)
      cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  ), cfg as (
    select coalesce((select count_weekday from public.org_settings where org_id = p_org), 0) as wd
  ), sales as (
    select oi.branch_id, o.business_date, sum(oi.net_poisha) as net,
           coalesce(sum(oi.net_poisha) filter (where c.order_item_id is not null), 0) as costed
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
      left join public.order_item_costs c on c.order_item_id = oi.id
     where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
       and o.order_status = 'completed' and o.business_date between p_from and p_to
     group by 1, 2
  ), shifts as (
    select sh.branch_id,
           coalesce(sh.business_date, private.business_date(sh.opened_at, private.branch_cutoff(p_org, sh.branch_id))) as business_date,
           count(*) as n, count(*) filter (where sh.status <> 'closed') as open_n
      from public.shifts sh
     where sh.org_id = p_org and sh.branch_id = any (p_branches)
       and coalesce(sh.business_date, private.business_date(sh.opened_at, private.branch_cutoff(p_org, sh.branch_id)))
           between p_from and p_to
     group by 1, 2
  ), scored as (
    select d.branch_id, d.business_date,
           (s.net is not null or sh.n is not null) as open_day,
           extract(dow from d.business_date)::integer = cfg.wd as count_due,
           case when exists (select 1 from public.purchases p where p.org_id = p_org and p.branch_id = d.branch_id
                              and p.purchased_on = d.business_date and p.status = 'confirmed') then 25 else 0 end as bazar,
           case when exists (select 1 from public.waste_logs w where w.org_id = p_org and w.branch_id = d.branch_id
                              and w.business_date = d.business_date) then 15 else 0 end as waste,
           case when coalesce(sh.n, 0) > 0 and sh.open_n = 0 then 20 else 0 end as cash_close,
           case when extract(dow from d.business_date)::integer <> cfg.wd then 25
                when exists (select 1 from public.stock_counts c where c.org_id = p_org and c.branch_id = d.branch_id
                              and c.counted_on = d.business_date and c.status = 'submitted') then 25 else 0 end as count,
           case when coalesce(s.net, 0) <= 0 or s.costed * 10 >= s.net * 9 then 15 else 0 end as coverage
      from days d cross join cfg
      left join sales s on s.branch_id = d.branch_id and s.business_date = d.business_date
      left join shifts sh on sh.branch_id = d.branch_id and sh.business_date = d.business_date
  )
  select s.branch_id, s.business_date, s.open_day, s.count_due,
         case when s.open_day then s.bazar end, case when s.open_day then s.waste end,
         case when s.open_day then s.cash_close end, case when s.open_day then s.count end,
         case when s.open_day then s.coverage end,
         case when s.open_day then s.bazar + s.waste + s.cash_close + s.count + s.coverage end
    from scored s
   order by s.branch_id, s.business_date
$$;

-- Waste leaderboard: what was thrown away, why, and what it cost (value uses the price of that day).
create function private.m_waste_board(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (
  branch_id uuid, reason_code_id uuid, reason_label text, reason_label_bn text, ingredient_id uuid,
  menu_item_id uuid, name text, name_bn text, base text, entries bigint, qty_base numeric,
  qty_portions numeric, value_poisha bigint
) language sql stable security definer set search_path = '' as $$
  select w.branch_id, w.reason_code_id, rc.label, rc.label_bn, w.ingredient_id, w.menu_item_id,
         coalesce(i.name, mi.name), coalesce(i.name_bn, mi.name_bn), i.base::text,
         count(*), sum(w.qty_base), sum(w.qty_portions),
         round(sum(case when w.ingredient_id is not null
                        then w.qty_base * private.ingredient_unit_cost(p_org, w.ingredient_id, w.business_date)
                        else w.qty_portions * (select c.unit_cost
                                                 from private.item_unit_cost(p_org, w.menu_item_id, null, w.business_date) c)
                   end))::bigint
    from public.waste_logs w
    left join public.reason_codes rc on rc.org_id = w.org_id and rc.id = w.reason_code_id
    left join public.ingredients i on i.org_id = w.org_id and i.id = w.ingredient_id
    left join public.menu_items mi on mi.org_id = w.org_id and mi.id = w.menu_item_id
   where w.org_id = p_org and w.branch_id = any (p_branches) and w.business_date between p_from and p_to
     and (w.ingredient_id is not null or w.menu_item_id is not null)
   group by w.branch_id, w.reason_code_id, rc.label, rc.label_bn, w.ingredient_id, w.menu_item_id,
            coalesce(i.name, mi.name), coalesce(i.name_bn, mi.name_bn), i.base
   order by 13 desc nulls last, 11 desc nulls last
$$;

-- ---------------------------------------------------------------------------------------------
-- Purchases. A confirmed purchase refreshes the ingredient's unit cost from what was actually paid
-- (METRICS.md "Costing"): weighted average over the 14 days to the purchase day across the org, or the
-- last price paid. Stored as history (paid ÷ quantity, exact), so recipe costs from that day use it.
-- ---------------------------------------------------------------------------------------------
create function private.refresh_ingredient_cost(p_org uuid, p_ingredient uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_method text := coalesce((select unit_cost_method from public.org_cost_settings where org_id = p_org), 'weighted_14d');
  v_paid numeric;
  v_qty numeric;
begin
  if v_method = 'last' then
    select pl.line_total_poisha, pl.qty_base into v_paid, v_qty
      from public.purchase_lines pl join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
     where pl.org_id = p_org and pl.ingredient_id = p_ingredient and p.status = 'confirmed' and p.purchased_on <= p_date
     order by p.purchased_on desc, p.confirmed_at desc nulls last
     limit 1;
  else
    select sum(pl.line_total_poisha), sum(pl.qty_base) into v_paid, v_qty
      from public.purchase_lines pl join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
     where pl.org_id = p_org and pl.ingredient_id = p_ingredient and p.status = 'confirmed'
       and p.purchased_on between p_date - 13 and p_date;
  end if;
  if v_qty is null or v_qty <= 0 then
    -- Nothing paid in the window (e.g. the only purchase was voided): the day falls back to earlier history.
    delete from public.ingredient_price_history
     where org_id = p_org and ingredient_id = p_ingredient and effective_from = p_date and source = 'purchases';
    return;
  end if;
  insert into public.ingredient_price_history (org_id, ingredient_id, effective_from, cost_poisha, per_base_qty, source)
  values (p_org, p_ingredient, p_date, v_paid::bigint, v_qty, 'purchases')
  on conflict (org_id, ingredient_id, effective_from)
  do update set cost_poisha = excluded.cost_poisha, per_base_qty = excluded.per_base_qty, source = 'purchases';
end $$;

create function private.find_or_create_supplier(p_org uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text := left(btrim(coalesce(p_name, '')), 120);
begin
  if v_name = '' then return null; end if;
  select id into v_id from public.suppliers where org_id = p_org and lower(name) = lower(v_name);
  if v_id is null then
    insert into public.suppliers (org_id, name) values (p_org, v_name) returning id into v_id;
  end if;
  return v_id;
end $$;

-- p_lines: [{ingredient_id, qty_base > 0, line_total_poisha >= 0, note?}]
create function private.write_purchase(
  p_org uuid, p_branch uuid, p_supplier uuid, p_purchased_on date, p_lines jsonb,
  p_source public.purchase_source, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_today date := private.business_date(now(), private.branch_cutoff(p_org, p_branch));
  v_line jsonb;
  v_ing uuid;
  v_qty numeric;
  v_total bigint;
  v_sum bigint := 0;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_purchased_on is null or p_purchased_on > v_today or p_purchased_on < v_today - 90 then
    raise exception 'the purchase date must be within the last 90 days' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'a purchase needs 1–100 lines' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.purchases (org_id, branch_id, supplier_id, purchased_on, source, status, total_poisha, notes,
    entered_by, confirmed_by, confirmed_at)
  values (p_org, p_branch, p_supplier, p_purchased_on, p_source, 'confirmed', 0, left(nullif(btrim(p_notes), ''), 1000),
    (select auth.uid()), (select auth.uid()), now())
  returning id into v_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing := nullif(v_line ->> 'ingredient_id', '')::uuid;
    v_qty := (v_line ->> 'qty_base')::numeric;
    v_total := (v_line ->> 'line_total_poisha')::bigint;
    if v_ing is null or not exists (select 1 from public.ingredients where org_id = p_org and id = v_ing) then
      raise exception 'each line needs a known ingredient' using errcode = 'invalid_parameter_value';
    end if;
    if v_qty is null or v_qty <= 0 or v_total is null or v_total < 0 then
      raise exception 'each line needs a positive quantity and a price' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.purchase_lines (org_id, branch_id, purchase_id, ingredient_id, qty_base, line_total_poisha, note)
    values (p_org, p_branch, v_id, v_ing, v_qty, v_total, left(nullif(btrim(v_line ->> 'note'), ''), 300));
    v_sum := v_sum + v_total;
  end loop;
  update public.purchases set total_poisha = v_sum where id = v_id;
  perform private.refresh_ingredient_cost(p_org, x.ingredient_id, p_purchased_on)
     from (select distinct ingredient_id from public.purchase_lines where org_id = p_org and purchase_id = v_id) x;
  perform private.write_audit(p_org, p_branch, 'purchase.record', 'purchase', v_id::text, null,
    jsonb_build_object('purchased_on', p_purchased_on, 'source', p_source, 'total_poisha', v_sum,
                       'lines', jsonb_array_length(p_lines), 'supplier_id', p_supplier), null, null, null);
  return v_id;
end $$;

create function public.record_purchase(
  p_org uuid, p_branch uuid, p_supplier uuid, p_supplier_name text, p_purchased_on date, p_lines jsonb,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return private.write_purchase(p_org, p_branch,
    coalesce(p_supplier, private.find_or_create_supplier(p_org, p_supplier_name)),
    p_purchased_on, p_lines, 'form', p_notes);
end $$;

-- The app asks before spending an org's AI allowance on reading a chit for this branch.
create function public.can_record_purchase(p_org uuid, p_branch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_access_branch_role(p_org, p_branch, array['owner', 'purchaser']::public.app_role[])
$$;

-- A person confirms an AI (photo / voice / text) draft, usually after correcting it. Only now does it
-- become a purchase and move stock.
create function public.confirm_purchase_draft(
  p_draft uuid, p_supplier uuid, p_supplier_name text, p_purchased_on date, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  d public.purchase_drafts;
  v_id uuid;
begin
  select * into d from public.purchase_drafts where id = p_draft for update;
  if not found or not private.can_access_branch_role(d.org_id, d.branch_id, array['owner', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if d.status <> 'pending_review' then
    raise exception 'this draft was already reviewed' using errcode = 'invalid_parameter_value';
  end if;
  v_id := private.write_purchase(d.org_id, d.branch_id,
    coalesce(p_supplier, private.find_or_create_supplier(d.org_id, p_supplier_name)),
    p_purchased_on, p_lines, d.source, null);
  update public.purchase_drafts set status = 'confirmed', purchase_id = v_id where id = p_draft;
  perform private.write_audit(d.org_id, d.branch_id, 'purchase.confirm_draft', 'purchase', v_id::text,
    jsonb_build_object('draft', p_draft, 'extracted', d.extracted), p_lines, null, null, null);
  return v_id;
end $$;

create function public.discard_purchase_draft(p_draft uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.purchase_drafts;
begin
  select * into d from public.purchase_drafts where id = p_draft for update;
  if not found or not private.can_access_branch_role(d.org_id, d.branch_id, array['owner', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if d.status <> 'pending_review' then
    raise exception 'this draft was already reviewed' using errcode = 'invalid_parameter_value';
  end if;
  update public.purchase_drafts set status = 'discarded' where id = p_draft;
  perform private.write_audit(d.org_id, d.branch_id, 'purchase.discard_draft', 'purchase_draft', p_draft::text,
    null, null, left(nullif(btrim(p_reason), ''), 500), null, null);
end $$;

-- Only the owner voids a purchase (a wrong entry); the reason is required and the cost refreshes.
create function public.void_purchase(p_purchase uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.purchases;
begin
  select * into p from public.purchases where id = p_purchase for update;
  if not found or not private.has_role(p.org_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'a reason is required' using errcode = 'invalid_parameter_value';
  end if;
  if p.status <> 'confirmed' then
    raise exception 'only a confirmed purchase can be voided' using errcode = 'invalid_parameter_value';
  end if;
  update public.purchases set status = 'void' where id = p_purchase;
  perform private.refresh_ingredient_cost(p.org_id, x.ingredient_id, p.purchased_on)
     from (select distinct ingredient_id from public.purchase_lines where org_id = p.org_id and purchase_id = p_purchase) x;
  perform private.write_audit(p.org_id, p.branch_id, 'purchase.void', 'purchase', p_purchase::text,
    jsonb_build_object('status', 'confirmed', 'total_poisha', p.total_poisha), jsonb_build_object('status', 'void'),
    left(btrim(p_reason), 500), null, null);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Stock counts: a guided weekly count of the costliest ingredients (blind — the sheet never shows the
-- expected quantity), or a full / spot count. Lines are editable while the count is open; submitting
-- is final and audited. A later count on the same day supersedes it.
-- ---------------------------------------------------------------------------------------------
create function public.start_stock_count(p_org uuid, p_branch uuid, p_kind public.stock_count_kind, p_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, private.business_date(now(), private.branch_cutoff(p_org, p_branch)));
  v_id uuid;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_date > private.business_date(now(), private.branch_cutoff(p_org, p_branch)) then
    raise exception 'a count cannot be in the future' using errcode = 'invalid_parameter_value';
  end if;
  select id into v_id from public.stock_counts
   where org_id = p_org and branch_id = p_branch and counted_on = v_date and kind = p_kind and status = 'open';
  if v_id is null then
    insert into public.stock_counts (org_id, branch_id, counted_on, kind, status, counted_by)
    values (p_org, p_branch, v_date, p_kind, 'open', (select auth.uid()))
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- The ingredients to count: every active ingredient, the guided ones flagged and ranked by the value
-- the branch used in the last 28 days (quantity × unit cost; the value itself is never returned).
create function public.stock_count_sheet(p_count uuid)
returns table (ingredient_id uuid, name text, name_bn text, base text, suggested boolean, rank integer,
               counted_qty numeric, note text)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.stock_counts;
  v_n integer;
begin
  select * into c from public.stock_counts where id = p_count;
  if not found or not private.can_access_branch_role(c.org_id, c.branch_id,
       array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(guided_count_size, 12) into v_n from public.org_settings where org_id = c.org_id;
  return query
    with used as (
      select m.ingredient_id, sum(m.qty) as qty
        from private.m_stock_moves(c.org_id, array[c.branch_id], c.counted_on - 27, c.counted_on) m
       where m.kind = 'usage'
       group by 1
    ), ranked as (
      select i.id, i.name, i.name_bn, i.base::text as base,
             row_number() over (order by coalesce(u.qty * private.ingredient_unit_cost(c.org_id, i.id, c.counted_on), 0) desc,
                                         coalesce(u.qty, 0) desc, i.name)::integer as rk
        from public.ingredients i
        left join used u on u.ingredient_id = i.id
       where i.org_id = c.org_id and i.is_active
    )
    select r.id, r.name, r.name_bn, r.base, r.rk <= coalesce(v_n, 12), r.rk, l.counted_qty_base, l.note
      from ranked r
      left join public.stock_count_lines l on l.org_id = c.org_id and l.stock_count_id = c.id and l.ingredient_id = r.id
     order by r.rk;
end $$;

create function public.save_count_line(p_count uuid, p_ingredient uuid, p_qty numeric, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.stock_counts;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found or not private.can_access_branch_role(c.org_id, c.branch_id,
       array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if c.status <> 'open' then
    raise exception 'this count was already submitted' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.ingredients where org_id = c.org_id and id = p_ingredient) then
    raise exception 'unknown ingredient' using errcode = 'invalid_parameter_value';
  end if;
  if p_qty is null then
    delete from public.stock_count_lines where org_id = c.org_id and stock_count_id = p_count and ingredient_id = p_ingredient;
    return;
  end if;
  if p_qty < 0 then
    raise exception 'a count cannot be negative' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.stock_count_lines (org_id, branch_id, stock_count_id, ingredient_id, counted_qty_base, note)
  values (c.org_id, c.branch_id, p_count, p_ingredient, p_qty, left(nullif(btrim(p_note), ''), 300))
  on conflict (stock_count_id, ingredient_id)
  do update set counted_qty_base = excluded.counted_qty_base, note = excluded.note;
end $$;

create function public.submit_stock_count(p_count uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.stock_counts;
  v_lines integer;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found or not private.can_access_branch_role(c.org_id, c.branch_id,
       array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if c.status <> 'open' then
    raise exception 'this count was already submitted' using errcode = 'invalid_parameter_value';
  end if;
  select count(*) into v_lines from public.stock_count_lines where org_id = c.org_id and stock_count_id = p_count;
  if v_lines = 0 then
    raise exception 'count at least one ingredient' using errcode = 'invalid_parameter_value';
  end if;
  update public.stock_counts set status = 'submitted', submitted_at = now(), counted_by = (select auth.uid())
   where id = p_count;
  perform private.write_audit(c.org_id, c.branch_id, 'stock.count_submit', 'stock_count', p_count::text, null,
    jsonb_build_object('counted_on', c.counted_on, 'kind', c.kind, 'lines', v_lines), null, null, null);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Waste log: an ingredient (base units) or a menu item (portions), with a waste reason. From the KDS,
-- the kitchen's staff session is checked like any other device action.
-- ---------------------------------------------------------------------------------------------
create function public.log_waste(
  p_org uuid, p_branch uuid, p_ingredient uuid, p_menu_item uuid, p_qty numeric, p_reason uuid,
  p_note text default null, p_source public.waste_source default 'mobile', p_device uuid default null,
  p_staff uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'kitchen']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_device is not null then
    perform private.verify_staff_session(p_org, p_device, p_staff);
  end if;
  if (p_ingredient is null) = (p_menu_item is null) then
    raise exception 'log an ingredient or a menu item' using errcode = 'invalid_parameter_value';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'the quantity must be positive' using errcode = 'invalid_parameter_value';
  end if;
  if p_reason is null or not exists (select 1 from public.reason_codes r where r.org_id = p_org and r.id = p_reason
                                      and r.kind = 'waste' and r.is_active) then
    raise exception 'pick a waste reason' using errcode = 'invalid_parameter_value';
  end if;
  if p_ingredient is not null and not exists (select 1 from public.ingredients where org_id = p_org and id = p_ingredient) then
    raise exception 'unknown ingredient' using errcode = 'invalid_parameter_value';
  end if;
  if p_menu_item is not null and not exists (select 1 from public.menu_items where org_id = p_org and id = p_menu_item) then
    raise exception 'unknown menu item' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.waste_logs (org_id, branch_id, ingredient_id, menu_item_id, qty_base, qty_portions, reason_code_id,
    note, source, logged_by_staff_id, logged_by_user, logged_at, business_date)
  values (p_org, p_branch, p_ingredient, p_menu_item,
    case when p_ingredient is not null then p_qty end, case when p_menu_item is not null then p_qty end,
    p_reason, left(nullif(btrim(p_note), ''), 300), p_source, p_staff, (select auth.uid()), now(),
    private.business_date(now(), private.branch_cutoff(p_org, p_branch)))
  returning id into v_id;
  perform private.write_audit(p_org, p_branch, 'stock.waste', 'waste_log', v_id::text, null,
    jsonb_build_object('ingredient_id', p_ingredient, 'menu_item_id', p_menu_item, 'qty', p_qty,
                       'reason_code_id', p_reason, 'source', p_source), null, p_device, p_staff);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Transfers between branches: the sender records what left, the receiving branch confirms what
-- arrived. A short (or long) receipt is "disputed" and stays visible; stock follows what was received.
-- ---------------------------------------------------------------------------------------------
-- A branch manager sees only their own branch (RLS on branches), but must be able to name where goods
-- go: the org's other active branches, names only, for anyone who may send.
create function public.transfer_destinations(p_org uuid)
returns table (id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.branches b where b.org_id = p_org
                  and private.can_access_branch_role(p_org, b.id,
                        array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[])) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query select b.id, b.name from public.branches b where b.org_id = p_org and b.is_active order by b.name;
end $$;

-- p_lines: [{ingredient_id, qty_base > 0}]
create function public.send_transfer(p_org uuid, p_from uuid, p_to uuid, p_lines jsonb, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_line jsonb;
  v_ing uuid;
  v_qty numeric;
begin
  if not private.can_access_branch_role(p_org, p_from, array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_to is null or p_to = p_from or not exists (select 1 from public.branches where org_id = p_org and id = p_to) then
    raise exception 'pick another branch of this organization' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 50 then
    raise exception 'a transfer needs 1–50 lines' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.transfers (org_id, from_branch_id, to_branch_id, status, sent_at, sent_by, sent_on, notes)
  values (p_org, p_from, p_to, 'sent', now(), (select auth.uid()),
    private.business_date(now(), private.branch_cutoff(p_org, p_from)), left(nullif(btrim(p_notes), ''), 500))
  returning id into v_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing := nullif(v_line ->> 'ingredient_id', '')::uuid;
    v_qty := (v_line ->> 'qty_base')::numeric;
    if v_ing is null or not exists (select 1 from public.ingredients where org_id = p_org and id = v_ing) then
      raise exception 'each line needs a known ingredient' using errcode = 'invalid_parameter_value';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'each line needs a positive quantity' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.transfer_lines (org_id, transfer_id, ingredient_id, qty_base_sent)
    values (p_org, v_id, v_ing, v_qty);
  end loop;
  perform private.write_audit(p_org, p_from, 'stock.transfer_send', 'transfer', v_id::text, null,
    jsonb_build_object('to_branch_id', p_to, 'lines', p_lines), null, null, null);
  return v_id;
end $$;

-- p_lines: [{line_id, qty_base_received >= 0}]; a line left out arrived in full.
create function public.receive_transfer(p_transfer uuid, p_lines jsonb default '[]'::jsonb, p_note text default null)
returns public.transfer_status language plpgsql security definer set search_path = '' as $$
declare
  t public.transfers;
  v_status public.transfer_status;
begin
  select * into t from public.transfers where id = p_transfer for update;
  if not found or not private.can_access_branch_role(t.org_id, t.to_branch_id,
       array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if t.status <> 'sent' then
    raise exception 'this transfer is not waiting to be received' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
              where (x ->> 'qty_base_received')::numeric < 0
                 or not exists (select 1 from public.transfer_lines l where l.org_id = t.org_id and l.transfer_id = t.id
                                  and l.id = (x ->> 'line_id')::uuid)) then
    raise exception 'unknown line or negative quantity' using errcode = 'invalid_parameter_value';
  end if;
  update public.transfer_lines l
     set qty_base_received = coalesce(
           (select (x ->> 'qty_base_received')::numeric from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
             where (x ->> 'line_id')::uuid = l.id limit 1),
           l.qty_base_sent)
   where l.org_id = t.org_id and l.transfer_id = t.id;
  v_status := case when exists (select 1 from public.transfer_lines l where l.org_id = t.org_id and l.transfer_id = t.id
                                  and l.qty_base_received <> l.qty_base_sent)
                   then 'disputed' else 'received' end;
  update public.transfers
     set status = v_status, received_at = now(), received_by = (select auth.uid()),
         received_on = private.business_date(now(), private.branch_cutoff(t.org_id, t.to_branch_id)),
         notes = coalesce(nullif(btrim(p_note), ''), notes)
   where id = p_transfer;
  perform private.write_audit(t.org_id, t.to_branch_id, 'stock.transfer_receive', 'transfer', p_transfer::text,
    jsonb_build_object('status', 'sent'), jsonb_build_object('status', v_status, 'lines', p_lines),
    nullif(btrim(p_note), ''), null, null);
  return v_status;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public metric wrappers. Quantities: the stock roles of the branch. Money (purchase value, variance
-- ৳, waste ৳): null unless the caller can see money — the numbers are withheld in SQL, not hidden in UI.
-- ---------------------------------------------------------------------------------------------
create function public.metric_stock_status(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (
  branch_id uuid, ingredient_id uuid, name text, name_bn text, base text, last_count_date date,
  last_count_qty numeric, purchases_qty numeric, transfers_in_qty numeric, transfers_out_qty numeric,
  usage_qty numeric, waste_qty numeric, stock_qty numeric, in_transit_qty numeric, usage_14d_qty numeric,
  days_of_cover numeric, band text, as_of date
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := private.business_date(p_now, private.org_cutoff(p_org));
begin
  return query
    select s.branch_id, s.ingredient_id, i.name, i.name_bn, i.base::text, s.last_count_date, s.last_count_qty,
           s.purchases_qty, s.transfers_in_qty, s.transfers_out_qty, s.usage_qty, s.waste_qty, s.stock_qty,
           s.in_transit_qty, s.usage_14d_qty, s.days_of_cover, s.band, v_date
      from private.m_stock(p_org, private.stock_scope(p_org, p_branch), v_date) s
      join public.ingredients i on i.org_id = p_org and i.id = s.ingredient_id
     order by case s.band when 'red' then 0 when 'yellow' then 1 when 'green' then 2 else 3 end, i.name;
end $$;

create function public.metric_stock_variance(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (
  branch_id uuid, ingredient_id uuid, name text, name_bn text, base text, opening_date date,
  opening_qty numeric, closing_date date, closing_qty numeric, purchases_qty numeric, purchases_poisha bigint,
  transfers_in_qty numeric, transfers_out_qty numeric, usage_theoretical_qty numeric, waste_qty numeric,
  usage_actual_qty numeric, variance_qty numeric, variance_bps integer, usage_theoretical_poisha bigint,
  waste_poisha bigint, variance_poisha bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_money boolean := private.is_service_role() or private.can_see_money(p_org);
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 366 then
    raise exception 'pick two count dates, at most a year apart' using errcode = 'invalid_parameter_value';
  end if;
  return query
    select v.branch_id, v.ingredient_id, i.name, i.name_bn, i.base::text, v.opening_date, v.opening_qty,
           v.closing_date, v.closing_qty, v.purchases_qty, case when v_money then v.purchases_poisha end,
           v.transfers_in_qty, v.transfers_out_qty, v.usage_theoretical_qty, v.waste_qty, v.usage_actual_qty,
           v.variance_qty,
           case when v.usage_theoretical_qty > 0 then round(v.variance_qty * 10000 / v.usage_theoretical_qty)::integer end,
           case when v_money then v.usage_theoretical_poisha end, case when v_money then v.waste_poisha end,
           case when v_money then v.variance_poisha end
      from private.m_variance(p_org, private.stock_scope(p_org, p_branch), p_from, p_to) v
      join public.ingredients i on i.org_id = p_org and i.id = v.ingredient_id
     order by abs(coalesce(v.variance_poisha, 0)) desc, abs(v.variance_qty) desc;
end $$;

create function public.metric_discipline(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (
  branch_id uuid, business_date date, open_day boolean, count_due boolean, bazar integer, waste integer,
  cash_close integer, count integer, coverage integer, score integer
) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'pick a range of at most three months' using errcode = 'invalid_parameter_value';
  end if;
  return query select * from private.m_discipline(p_org, private.metric_scope(p_org, p_branch), p_from, p_to);
end $$;

create function public.metric_waste_board(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (
  branch_id uuid, reason_code_id uuid, reason_label text, reason_label_bn text, ingredient_id uuid,
  menu_item_id uuid, name text, name_bn text, base text, entries bigint, qty_base numeric,
  qty_portions numeric, value_poisha bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_money boolean := private.is_service_role() or private.can_see_money(p_org);
  v_scope uuid[];
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'pick a range of at most a year' using errcode = 'invalid_parameter_value';
  end if;
  v_scope := private.metric_scope(p_org, p_branch);
  if not private.is_service_role() then
    select coalesce(array_agg(b), '{}') into v_scope from unnest(v_scope) b
     where private.can_access_branch_role(p_org, b, array['owner', 'manager', 'kitchen', 'accountant']::public.app_role[]);
    if cardinality(v_scope) = 0 then
      raise exception 'not allowed' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return query
    select w.branch_id, w.reason_code_id, w.reason_label, w.reason_label_bn, w.ingredient_id, w.menu_item_id,
           w.name, w.name_bn, w.base, w.entries, w.qty_base, w.qty_portions,
           case when v_money then w.value_poisha end
      from private.m_waste_board(p_org, v_scope, p_from, p_to) w;
end $$;

-- ---------------------------------------------------------------------------------------------
-- New organizations also get waste reasons (and existing ones now). Same body as Phase 1 plus waste.
-- ---------------------------------------------------------------------------------------------
create or replace function public.ensure_org_defaults(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_bn boolean;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'only the owner can set up defaults' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(default_locale = 'bn', true) into v_bn from public.org_settings where org_id = p_org;

  insert into public.channels (org_id, name, kind)
  select p_org, v.name, v.kind::public.channel_kind
    from (values
      (case when v_bn then 'ডাইন-ইন' else 'Dine-in' end, 'dine_in'),
      (case when v_bn then 'টেকঅ্যাওয়ে' else 'Takeaway' end, 'takeaway'),
      (case when v_bn then 'নিজস্ব ডেলিভারি' else 'Own delivery' end, 'own_delivery'),
      ('foodpanda', 'foodpanda'),
      ('Pathao Food', 'pathao_food')
    ) as v(name, kind)
   where not exists (select 1 from public.channels c where c.org_id = p_org and c.kind = v.kind::public.channel_kind)
  on conflict (org_id, name) do nothing;

  insert into public.reason_codes (org_id, kind, code, label, label_bn, requires_manager_approval)
  values
    (p_org, 'void', 'wrong_item', 'Wrong item entered', 'ভুল আইটেম দেওয়া হয়েছে', false),
    (p_org, 'void', 'customer_changed', 'Customer changed their mind', 'গ্রাহক মত বদলেছেন', false),
    (p_org, 'void', 'kitchen_issue', 'Kitchen could not make it', 'রান্নাঘর বানাতে পারেনি', false),
    (p_org, 'discount', 'regular', 'Regular customer', 'নিয়মিত গ্রাহক', false),
    (p_org, 'discount', 'complaint', 'Service complaint', 'সেবা নিয়ে অভিযোগ', false),
    (p_org, 'discount', 'staff_meal', 'Staff meal', 'স্টাফের খাবার', true),
    (p_org, 'discount', 'owner_guest', 'Owner''s guest', 'মালিকের অতিথি', true),
    (p_org, 'refund', 'quality', 'Food quality complaint', 'খাবারের মান নিয়ে অভিযোগ', false),
    (p_org, 'refund', 'wrong_order', 'Wrong order served', 'ভুল অর্ডার পরিবেশন', false),
    (p_org, 'refund', 'overcharged', 'Customer was overcharged', 'গ্রাহকের কাছ থেকে বেশি নেওয়া হয়েছে', false)
  on conflict (org_id, kind, code) do nothing;
  perform private.add_waste_reasons(p_org);

  insert into public.stations (org_id, branch_id, name)
  select p_org, b.id, case when v_bn then 'রান্নাঘর' else 'Kitchen' end
    from public.branches b where b.org_id = p_org
  on conflict (org_id, branch_id, name) do nothing;

  perform private.write_audit(p_org, null, 'org.defaults', 'organization', p_org::text, null, null, null);
end $$;

create function private.add_waste_reasons(p_org uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.reason_codes (org_id, kind, code, label, label_bn)
  values
    (p_org, 'waste', 'spoiled', 'Spoiled / expired', 'নষ্ট / মেয়াদোত্তীর্ণ'),
    (p_org, 'waste', 'overcooked', 'Overcooked or burnt', 'বেশি রান্না বা পুড়ে গেছে'),
    (p_org, 'waste', 'dropped', 'Dropped or spilled', 'পড়ে গেছে বা ছড়িয়ে গেছে'),
    (p_org, 'waste', 'leftover', 'Cooked but not sold', 'রান্না হয়েছে কিন্তু বিক্রি হয়নি'),
    (p_org, 'waste', 'returned', 'Returned by customer', 'গ্রাহক ফেরত দিয়েছেন')
  on conflict (org_id, kind, code) do nothing
$$;

select private.add_waste_reasons(o.id) from public.organizations o;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname in ('branch_cutoff', 'stock_scope', 'active_recipe', 'recipe_explode',
              'm_stock_moves', 'm_stock', 'm_variance', 'm_discipline', 'm_waste_board', 'refresh_ingredient_cost',
              'find_or_create_supplier', 'write_purchase', 'add_waste_reasons'))
        or (n.nspname = 'public' and p.proname in ('record_purchase', 'can_record_purchase', 'confirm_purchase_draft', 'discard_purchase_draft',
              'void_purchase', 'start_stock_count', 'stock_count_sheet', 'save_count_line', 'submit_stock_count',
              'log_waste', 'transfer_destinations', 'send_transfer', 'receive_transfer', 'metric_stock_status', 'metric_stock_variance',
              'metric_discipline', 'metric_waste_board', 'ensure_org_defaults'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

comment on function public.record_purchase is 'Owner/purchaser records a bazar purchase; refreshes unit cost; audited. Phase 5.';
comment on function public.confirm_purchase_draft is 'A person confirms an AI purchase draft into a purchase (the only way a draft moves stock). Phase 5.';
comment on function public.metric_stock_status is 'stock.theoretical and stock.days_of_cover per ingredient (quantities; stock roles). Phase 5.';
comment on function public.metric_stock_variance is 'usage.actual and variance between two counts (money columns only for owner/accountant). Phase 5.';
comment on function public.metric_discipline is 'Branch discipline score per business day (METRICS.md). Phase 5.';
comment on function public.metric_waste_board is 'Waste by reason and item/ingredient; value only for owner/accountant. Phase 5.';
