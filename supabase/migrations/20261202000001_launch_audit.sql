-- Launch audit (ADR 0066): what the last review before the first restaurant found, fixed.
--
--  1. Sizes. A dish's sizes (Half, Large) used the whole dish's ingredients: a half plate took a full plate
--     of mutton from stock and was costed as a full plate. `item_variants.portion_bps` says how much of the
--     dish a size is (half = 5000); a size with a recipe of its own still uses that recipe.
--  2. Prices. A weighted price looks back 14 days, but a voided or back-dated purchase only re-priced its own
--     day: the days after it kept the wrong price (a ৳40,000 chicken typo stayed in the cost until the next
--     chicken purchase). Now every later day it touched is worked out again, and a voided purchase re-costs
--     the sales it priced.
--  3. Salaries. A month without salary entries counted no staff cost until the owner pressed "copy last
--     month's pay": profit and break-even were wrong from the 1st of every month. A person still working
--     here now carries their last pay into a month that has none for them.
--  4. Cash shortages. The ৳1,000 floor was for the whole period, so a long period added up honest ±৳50
--     mistakes until a clean cashier crossed it (the clean café in the golden checks). The floor is now per
--     week of the period; a one-week scan is unchanged.
--  5. A new zero-input leak: orders that went to the kitchen but were never paid or cancelled. The food left
--     the shelf and no money was recorded — the oldest till trick there is (take the cash, leave the bill
--     open).

-- ---------------------------------------------------------------------------------------------
-- 1. Sizes use part of the dish
-- ---------------------------------------------------------------------------------------------
alter table public.item_variants
  add column portion_bps integer not null default 10000 check (portion_bps between 1000 and 50000);
comment on column public.item_variants.portion_bps is
  'How much of the dish''s ingredients one of this size uses, in basis points of the dish (half = 5000, '
  'large = 15000). Used when the size has no recipe of its own (ADR 0066).';

-- How much of a recipe one plate of a size takes: the size's share when the recipe is the dish's own,
-- else (a recipe written for that size) all of it.
create function private.size_factor(p_org uuid, p_recipe uuid, p_variant uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when p_variant is not null
                   and (select r.variant_id from public.recipes r where r.org_id = p_org and r.id = p_recipe) is null
              then coalesce((select v.portion_bps from public.item_variants v
                              where v.org_id = p_org and v.id = p_variant), 10000) / 10000.0
              else 1 end
$$;

-- Cost of one of a dish (or one of its sizes) on a day: the size's own recipe, else the dish's recipe times
-- the size's share of it.
create or replace function private.item_unit_cost(p_org uuid, p_item uuid, p_variant uuid, p_date date)
returns table (recipe_id uuid, unit_cost numeric)
language sql stable security definer set search_path = '' as $$
  select r.id,
         private.recipe_unit_cost(p_org, r.id, p_date)
           * case when r.variant_id is null and p_variant is not null
                  then coalesce((select v.portion_bps from public.item_variants v
                                  where v.org_id = p_org and v.id = p_variant), 10000) / 10000.0
                  else 1 end
    from public.recipes r
   where r.org_id = p_org and r.menu_item_id = p_item and r.status = 'active'
     and (r.variant_id is not distinct from p_variant or r.variant_id is null)
   order by (r.variant_id is not distinct from p_variant) desc
   limit 1
$$;

-- What the till took from stock: plates sold (`qty`) and how much of the dish's recipe they used
-- (`portions`: two half plates are one portion). Same rules as before for which lines count (ADR 0037).
drop function private.m_sold_for_stock(uuid, uuid[], date, date);
create function private.m_sold_for_stock(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (branch_id uuid, business_date date, menu_item_id uuid, recipe_id uuid, qty numeric, portions numeric)
language sql stable security definer set search_path = '' as $$
  select x.branch_id, x.business_date, x.menu_item_id, x.recipe_id, sum(x.qty),
         sum(x.qty * case when r.variant_id is null then coalesce(v.portion_bps, 10000) / 10000.0 else 1 end)
    from (
      select s.branch_id, s.business_date, s.menu_item_id, s.variant_id,
             coalesce(s.snap, private.active_recipe(p_org, s.menu_item_id, s.variant_id)) as recipe_id, s.qty
        from (
          select oi.branch_id, o.business_date, oi.menu_item_id, oi.variant_id, c.recipe_id as snap,
                 sum(oi.quantity)::numeric as qty
            from public.order_items oi
            join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
            left join public.order_item_costs c on c.order_item_id = oi.id
           where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
             and o.order_status <> 'cancelled' and o.business_date between p_from and p_to
             and oi.menu_item_id is not null
           group by 1, 2, 3, 4, 5
        ) s
    ) x
    left join public.recipes r on r.org_id = p_org and r.id = x.recipe_id
    left join public.item_variants v on v.org_id = p_org and v.id = x.variant_id
   group by 1, 2, 3, 4
$$;

create or replace function private.m_stock_moves(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (branch_id uuid, business_date date, ingredient_id uuid, kind text, qty numeric, value_poisha bigint)
language sql stable security definer set search_path = '' as $$
  with sold_r as (
    select s.branch_id, s.business_date, s.recipe_id, sum(s.portions) as qty
      from private.m_sold_for_stock(p_org, p_branches, p_from, p_to) s
     group by 1, 2, 3
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

-- Stock → Used: `dishes` stays the plates sold; the ingredient used follows the portions.
create or replace function public.metric_stock_used(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (ingredient_id uuid, name text, name_bn text, base text, menu_item_id uuid, item_name text,
               item_name_bn text, dishes numeric, qty numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := private.stock_scope(p_org, p_branch);
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'pick a period of at most 93 days' using errcode = 'invalid_parameter_value';
  end if;
  return query
    with sold as (
      select s.menu_item_id, s.recipe_id, sum(s.qty) as dishes, sum(s.portions) as portions
        from private.m_sold_for_stock(p_org, v_scope, p_from, p_to) s
       group by 1, 2
    ), used as (
      select s.menu_item_id, e.ingredient_id, sum(s.dishes) as dishes, sum(s.portions * e.qty) as qty
        from sold s cross join lateral private.recipe_explode(p_org, s.recipe_id) e
       where s.recipe_id is not null
       group by 1, 2
    ), out_rows as (
      select u.ingredient_id, null::uuid as menu_item_id, null::numeric as dishes, sum(u.qty) as qty, 0 as k
        from used u group by u.ingredient_id
      union all
      select u.ingredient_id, u.menu_item_id, u.dishes, u.qty, 1 from used u
      union all
      select null::uuid, s.menu_item_id, sum(s.dishes), null::numeric, 2
        from sold s where s.recipe_id is null group by s.menu_item_id
    )
    select o.ingredient_id, i.name, i.name_bn, i.base::text, o.menu_item_id, mi.name, mi.name_bn,
           o.dishes, o.qty
      from out_rows o
      left join public.ingredients i on i.org_id = p_org and i.id = o.ingredient_id
      left join public.menu_items mi on mi.org_id = p_org and mi.id = o.menu_item_id
     order by (o.ingredient_id is null), i.name, o.ingredient_id, o.k, o.qty desc nulls last,
              o.dishes desc nulls last, mi.name;
end $$;

-- The stock leak's evidence (which dishes took the ingredient, what voided dishes took) by portions too.
create or replace function private.detect_stock(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (
    select (c ->> 'usage_min_rate_bps')::numeric as min_rate, (c ->> 'usage_allowance_bps')::numeric as allowance,
           (c ->> 'count_uncertainty_bps')::numeric as band_bps, (c ->> 'min_impact_poisha')::bigint as min_impact,
           (c ->> 'transfer_pair_min_ratio_x100')::numeric / 100 as pair_ratio
      from (select private.detector_config(p_org) as c) x
  ), br as (
    select coalesce(array_agg(b.id), '{}') as ids from public.branches b where b.org_id = p_org
  ), v as (
    select m.*, private.ingredient_unit_cost(p_org, m.ingredient_id, m.opening_date) as s,
           m.variance_qty * 10000 / m.usage_theoretical_qty as rate_bps
      from private.m_variance(p_org, (select ids from br), p_from, p_to) m
     where m.usage_theoretical_qty > 0
  ), based as (
    -- The baseline: what the other branches, where their own rate is normal, lose on this ingredient.
    select v.*,
           least(greatest(coalesce(
             (select sum(p.variance_qty) / nullif(sum(p.usage_theoretical_qty), 0)
                from v p cross join cfg
               where p.ingredient_id = v.ingredient_id and p.branch_id <> v.branch_id
                 and abs(p.rate_bps) < cfg.min_rate),
             (select allowance from cfg) / 10000), 0), (select min_rate from cfg) / 10000) as baseline,
           (v.opening_qty + v.closing_qty) * coalesce(v.s, 0) * (select band_bps from cfg) / 10000 as band
      from v
  ), scored as (
    select b.*, b.variance_qty - b.usage_theoretical_qty * b.baseline as excess_qty
      from based b
  ), pos as (
    select s.* from scored s cross join cfg
     where s.s is not null and s.rate_bps >= cfg.min_rate and abs(s.variance_qty * s.s) > s.band
  ), neg as (
    select s.* from scored s cross join cfg
     where s.s is not null and s.rate_bps <= -cfg.min_rate and abs(s.variance_qty * s.s) > s.band
  ), pairs as (
    select distinct on (p.branch_id, p.ingredient_id)
           p.branch_id as from_branch, n.branch_id as to_branch, p.ingredient_id, p.s,
           p.excess_qty as from_excess, -n.excess_qty as to_deficit, p.variance_qty as from_var,
           n.variance_qty as to_var, p.usage_theoretical_qty as from_used, n.usage_theoretical_qty as to_used,
           p.rate_bps as from_rate, n.rate_bps as to_rate, greatest(p.opening_date, n.opening_date) as open_on,
           least(p.closing_date, n.closing_date) as close_on,
           least(abs(p.variance_qty), abs(n.variance_qty)) / greatest(abs(p.variance_qty), abs(n.variance_qty)) as ratio
      from pos p join neg n on n.ingredient_id = p.ingredient_id and n.branch_id <> p.branch_id
     cross join cfg
     where least(abs(p.variance_qty), abs(n.variance_qty)) >= cfg.pair_ratio * greatest(abs(p.variance_qty), abs(n.variance_qty))
     order by p.branch_id, p.ingredient_id, abs(abs(p.variance_qty) - abs(n.variance_qty))
  ), lone as (
    select p.* from pos p
     where not exists (select 1 from pairs x where x.from_branch = p.branch_id and x.ingredient_id = p.ingredient_id)
  )
  select 'transfer.suspected'::text, x.from_branch, x.ingredient_id::text || ':' || x.to_branch::text,
         jsonb_build_object('ingredient_id', x.ingredient_id, 'ingredient_name', i.name,
                            'from_branch_id', x.from_branch, 'to_branch_id', x.to_branch, 'to_branch_name', tb.name),
         round((x.from_excess + x.to_deficit) / 2 * x.s)::bigint,
         (case when x.ratio >= 0.8 then 'high' else 'medium' end)::public.confidence_level,
         '["variance.usage_qty", "usage.actual"]'::jsonb,
         jsonb_build_object('period_start', x.open_on, 'period_end', x.close_on, 'base', i.base,
           'estimated_qty', round((x.from_excess + x.to_deficit) / 2, 1), 'unit_cost_x1000', round(x.s * 1000),
           'from_variance_qty', x.from_var, 'from_used_qty', x.from_used, 'from_rate_bps', round(x.from_rate),
           'to_variance_qty', x.to_var, 'to_used_qty', x.to_used, 'to_rate_bps', round(x.to_rate),
           'match_pct', round(x.ratio * 100)),
         '["record_transfers", "count_both_branches", "check_store_keys"]'::jsonb
    from pairs x cross join cfg
    join public.ingredients i on i.org_id = p_org and i.id = x.ingredient_id
    join public.branches tb on tb.org_id = p_org and tb.id = x.to_branch
   where round((x.from_excess + x.to_deficit) / 2 * x.s) >= cfg.min_impact
  union all
  select 'usage.unexplained', l.branch_id, l.ingredient_id::text,
         jsonb_build_object('ingredient_id', l.ingredient_id, 'ingredient_name', i.name),
         round(l.excess_qty * l.s)::bigint,
         (case when l.rate_bps >= 2 * cfg.min_rate then 'high' else 'medium' end)::public.confidence_level,
         '["variance.usage_qty", "usage.actual", "usage.theoretical"]'::jsonb,
         jsonb_build_object('period_start', l.opening_date, 'period_end', l.closing_date, 'base', i.base,
           'used_theoretical_qty', l.usage_theoretical_qty, 'used_actual_qty', l.usage_actual_qty,
           'waste_qty', l.waste_qty, 'variance_qty', l.variance_qty, 'rate_bps', round(l.rate_bps),
           'baseline_bps', round(l.baseline * 10000), 'excess_qty', round(l.excess_qty, 1),
           'unit_cost_x1000', round(l.s * 1000), 'band_poisha', round(l.band),
           'purchases_qty', l.purchases_qty, 'opening_qty', l.opening_qty, 'closing_qty', l.closing_qty,
           'suspects', sus.list, 'voided_dish_qty', coalesce(vd.qty, 0), 'pos_exceptions', coalesce(px.n, 0)),
         '["check_portions", "log_all_waste", "lock_the_store", "recount"]'::jsonb
    from lone l cross join cfg
    join public.ingredients i on i.org_id = p_org and i.id = l.ingredient_id
    -- The dishes that use this ingredient here, by their share of what recipes say was used.
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('menu_item_id', d.menu_item_id, 'name', d.name,
                                                   'share_bps', d.share) order by d.share desc), '[]'::jsonb) as list
        from (
          select g.menu_item_id, mi.name, round(sum(g.qty * private.size_factor(p_org, ar.rid, g.variant_id) * e.qty) * 10000
                                          / l.usage_theoretical_qty)::integer as share
            from (
              select oi.menu_item_id, oi.variant_id, sum(oi.quantity) as qty
                from public.order_items oi
                join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
               where oi.org_id = p_org and oi.branch_id = l.branch_id and oi.status = 'active'
                 and o.order_status = 'completed' and o.business_date > l.opening_date
                 and o.business_date <= l.closing_date and oi.menu_item_id is not null
               group by oi.menu_item_id, oi.variant_id
            ) g
            cross join lateral (select private.active_recipe(p_org, g.menu_item_id, g.variant_id) as rid) ar
            cross join lateral private.recipe_explode(p_org, ar.rid) e
            join public.menu_items mi on mi.org_id = p_org and mi.id = g.menu_item_id
           where e.ingredient_id = l.ingredient_id
           group by g.menu_item_id, mi.name
           order by 3 desc
           limit 3
        ) d
    ) sus
    -- Cooked, then voided after the kitchen ticket: the ingredient still went.
    left join lateral (
      select sum(g.qty * private.size_factor(p_org, ar.rid, g.variant_id) * e.qty) as qty
        from (
          select oi.menu_item_id, oi.variant_id, sum(oi.quantity) as qty
            from public.voids x
            join public.order_items oi on oi.org_id = x.org_id and oi.id = x.order_item_id
            join public.orders o on o.org_id = x.org_id and o.id = x.order_id
           where x.org_id = p_org and o.branch_id = l.branch_id and x.after_kot
             and o.business_date > l.opening_date and o.business_date <= l.closing_date
           group by oi.menu_item_id, oi.variant_id
        ) g
        cross join lateral (select private.active_recipe(p_org, g.menu_item_id, g.variant_id) as rid) ar
        cross join lateral private.recipe_explode(p_org, ar.rid) e
       where e.ingredient_id = l.ingredient_id
    ) vd on true
    -- POS exceptions already found at this branch in an overlapping period.
    left join lateral (
      select count(*)::integer as n from public.findings f
       where f.org_id = p_org and f.branch_id = l.branch_id and f.status <> 'dismissed'
         and f.type in ('void.after_kot', 'discount.rate', 'refund.rate', 'cash.share', 'cash.over_short')
         and f.period_start <= l.closing_date and f.period_end >= l.opening_date
    ) px on true
   where round(l.excess_qty * l.s) >= cfg.min_impact
$$;

-- The owner says how much of the dish a size uses (the menu is the owner's; audited: it moves stock and cost). Stock
-- follows at once (it is worked out from the sales); the cost already stored on that size's past sales is
-- scaled to match, so the food cost of the days before tells the same story as their stock.
create function public.set_variant_portion(p_org uuid, p_variant uuid, p_portion_bps integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.item_variants;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_portion_bps is null or p_portion_bps < 1000 or p_portion_bps > 50000 then
    raise exception 'a size uses a tenth to five times the dish' using errcode = 'invalid_parameter_value';
  end if;
  select * into v from public.item_variants where org_id = p_org and id = p_variant for update;
  if not found then
    raise exception 'unknown size' using errcode = 'invalid_parameter_value';
  end if;
  if v.portion_bps = p_portion_bps then return; end if;
  update public.item_variants set portion_bps = p_portion_bps where org_id = p_org and id = p_variant;
  update public.order_item_costs c
     set unit_cost_poisha = round(c.unit_cost_poisha * p_portion_bps::numeric / v.portion_bps)::bigint,
         cost_poisha = round(c.cost_poisha * p_portion_bps::numeric / v.portion_bps)::bigint
    from public.order_items oi, public.recipes r
   where c.org_id = p_org and oi.org_id = p_org and oi.id = c.order_item_id and oi.variant_id = p_variant
     and r.org_id = p_org and r.id = c.recipe_id and r.variant_id is null;
  perform private.write_audit(p_org, null, 'menu.size_portion', 'item_variant', p_variant::text,
    jsonb_build_object('portion_bps', v.portion_bps), jsonb_build_object('portion_bps', p_portion_bps),
    null, null, null);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. A voided or back-dated purchase re-prices every day it touched
-- ---------------------------------------------------------------------------------------------
-- The one-day refresh, unchanged, under its own name.
create function private.refresh_ingredient_cost_day(p_org uuid, p_ingredient uuid, p_date date) returns void
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

-- The day itself, then (weighted price) every later day with a bazar price whose 14-day window holds it.
create or replace function private.refresh_ingredient_cost(p_org uuid, p_ingredient uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_method text := coalesce((select unit_cost_method from public.org_cost_settings where org_id = p_org), 'weighted_14d');
  d date;
begin
  perform private.refresh_ingredient_cost_day(p_org, p_ingredient, p_date);
  if v_method = 'last' then return; end if;
  for d in
    select h.effective_from from public.ingredient_price_history h
     where h.org_id = p_org and h.ingredient_id = p_ingredient and h.source = 'purchases'
       and h.effective_from > p_date and h.effective_from <= p_date + 13
     order by 1
  loop
    perform private.refresh_ingredient_cost_day(p_org, p_ingredient, d);
  end loop;
end $$;

-- The sales a wrong price costed get the corrected cost: every sale from p_from to today of a dish whose
-- sale-time recipe takes the ingredient (at any depth) is priced again with the same recipe on its own day.
-- A sale whose recipe can no longer be priced loses its cost (unknown, never guessed).
create function private.recost_sales_for_ingredient(p_org uuid, p_ingredient uuid, p_from date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_to date := private.business_date(now(), private.org_cutoff(p_org));
  v_n integer;
begin
  with keys as (
    select distinct c.recipe_id, c.business_date from public.order_item_costs c
     where c.org_id = p_org and c.business_date between p_from and v_to and c.recipe_id is not null
  ), hit as (
    select r.recipe_id from (select distinct k.recipe_id from keys k) r
     where exists (select 1 from private.recipe_explode(p_org, r.recipe_id) e where e.ingredient_id = p_ingredient)
  ), prices as (
    select k.recipe_id, k.business_date, private.recipe_unit_cost(p_org, k.recipe_id, k.business_date) as unit
      from keys k join hit h on h.recipe_id = k.recipe_id
  ), upd as (
    update public.order_item_costs c
       set unit_cost_poisha = round(p.unit * private.size_factor(p_org, p.recipe_id, oi.variant_id))::bigint,
           cost_poisha = round(p.unit * private.size_factor(p_org, p.recipe_id, oi.variant_id) * oi.quantity)::bigint
      from prices p, public.order_items oi
     where c.org_id = p_org and c.recipe_id = p.recipe_id and c.business_date = p.business_date
       and oi.org_id = p_org and oi.id = c.order_item_id and p.unit is not null
    returning 1
  ), del as (
    delete from public.order_item_costs c
     using prices p
     where c.org_id = p_org and c.recipe_id = p.recipe_id and c.business_date = p.business_date and p.unit is null
    returning 1
  )
  select (select count(*) from upd) + (select count(*) from del) into v_n;
  return v_n;
end $$;

create or replace function public.void_purchase(p_purchase uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.purchases;
  x record;
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
  for x in select distinct ingredient_id from public.purchase_lines where org_id = p.org_id and purchase_id = p_purchase loop
    perform private.refresh_ingredient_cost(p.org_id, x.ingredient_id, p.purchased_on);
    -- A wrong line (the usual reason to void) must not stay in the food cost of the days it priced.
    perform private.recost_sales_for_ingredient(p.org_id, x.ingredient_id, p.purchased_on);
  end loop;
  perform private.write_audit(p.org_id, p.branch_id, 'purchase.void', 'purchase', p_purchase::text,
    jsonb_build_object('status', 'confirmed', 'total_poisha', p.total_poisha), jsonb_build_object('status', 'void'),
    left(btrim(p_reason), 500), null, null);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Salaries carry over to a month that has none yet
-- ---------------------------------------------------------------------------------------------
create or replace function private.m_daily_overheads(p_org uuid, p_branches uuid[], p_date date)
returns table (branch_id uuid, labour_daily_poisha bigint, fixed_daily_poisha bigint)
language sql stable security definer set search_path = '' as $$
  with d as (
    select date_trunc('month', p_date)::date as month,
           extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::integer as days
  ), b as (select unnest(p_branches) as branch_id),
  pay as (
    -- Each person's pay for the month: their entry for it...
    select s.branch_id, s.salary_poisha + s.allowances_poisha as amount
      from public.salary_entries s cross join d
     where s.org_id = p_org and s.branch_id = any (p_branches) and s.month = d.month
    union all
    -- ...or, for someone still working here with no entry yet, their last pay of the year before.
    select st.branch_id, last.amount
      from public.staff st cross join d
      cross join lateral (
        select s.salary_poisha + s.allowances_poisha as amount
          from public.salary_entries s
         where s.org_id = p_org and s.staff_id = st.id and s.month < d.month
           and s.month >= (d.month - interval '12 months')::date
         order by s.month desc limit 1
      ) last
     where st.org_id = p_org and st.is_active and st.branch_id = any (p_branches)
       and not exists (select 1 from public.salary_entries s2
                        where s2.org_id = p_org and s2.staff_id = st.id and s2.month = d.month)
  )
  select b.branch_id,
         round(coalesce((select sum(p.amount) from pay p where p.branch_id = b.branch_id), 0)::numeric / d.days)::bigint,
         round(coalesce((select sum(f.monthly_poisha) from public.fixed_costs f
                          where f.org_id = p_org and f.branch_id = b.branch_id and f.effective_from <= p_date
                            and (f.effective_to is null or f.effective_to >= p_date)), 0)::numeric / d.days)::bigint
    from b cross join d
  union all
  select null::uuid, 0::bigint,
         round(coalesce((select sum(f.monthly_poisha) from public.fixed_costs f
                          where f.org_id = p_org and f.branch_id is null and f.effective_from <= p_date
                            and (f.effective_to is null or f.effective_to >= p_date)), 0)::numeric / d.days)::bigint
    from d
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Cash shortages: the floor is per week of the period
-- ---------------------------------------------------------------------------------------------
create or replace function private.detect_over_short(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (select private.detector_config(p_org) as c),
  s as (
    select sh.branch_id, sh.closed_by_staff_id as staff_id, count(*) as shifts,
           count(*) filter (where sh.over_short_poisha < 0) as short_shifts,
           sum(sh.over_short_poisha)::bigint as net_over_short
      from public.shifts sh
     where sh.org_id = p_org and sh.status = 'closed' and sh.closed_by_staff_id is not null
       and coalesce(sh.business_date, private.business_date(sh.opened_at, private.org_cutoff(p_org))) between p_from and p_to
     group by sh.branch_id, sh.closed_by_staff_id
  )
  select 'cash.over_short', s.branch_id, s.staff_id::text,
         jsonb_build_object('staff_id', s.staff_id, 'staff_name', st.display_name),
         -s.net_over_short,
         (case when s.short_shifts >= 6 then 'high' else 'medium' end)::public.confidence_level,
         '["cash.over_short"]'::jsonb,
         jsonb_build_object('shifts', s.shifts, 'short_shifts', s.short_shifts, 'net_over_short_poisha', s.net_over_short),
         '["recount_with_manager", "blind_cash_count", "talk_to_staff"]'::jsonb
    from s cross join cfg
    left join public.staff st on st.org_id = p_org and st.id = s.staff_id
   -- Honest mistakes go both ways and add up over a long period like a random walk; a shortage worth a
   -- look is the floor for every week the period covers.
   where -s.net_over_short >= (cfg.c ->> 'over_short_min_shortage_poisha')::bigint
                               * greatest(1, ceil((p_to - p_from + 1) / 7.0))
     and s.short_shifts >= (cfg.c ->> 'over_short_min_short_shifts')::integer
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Orders that went to the kitchen and were never paid or cancelled
-- ---------------------------------------------------------------------------------------------
create or replace function private.detector_defaults() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'peer_min_ratio_x100', 200, 'peer_min_z_x100', 300, 'peer_min_count', 5, 'min_impact_poisha', 50000,
    'cash_share_min_orders', 60, 'cash_share_min_gap_bps', 1500, 'cash_share_min_z_x100', 400,
    'over_short_min_shortage_poisha', 100000, 'over_short_min_short_shifts', 3, 'commission_min_bps', 1500,
    'margin_min_qty', 10, 'usage_min_rate_bps', 500, 'usage_allowance_bps', 200, 'count_uncertainty_bps', 100,
    'transfer_pair_min_ratio_x100', 50, 'price_drift_min_bps', 800, 'price_min_history', 3,
    -- Phase 8
    'slow_slot_min_orders', 12, 'slow_slot_min_ratio_x100', 150,
    'lapse_min_visits', 4, 'lapse_min_regulars', 20, 'lapse_min_rate_bps', 3000, 'lapse_min_peer_ratio_x100', 200,
    -- ADR 0066
    'unpaid_min_due_poisha', 50000
  )
$$;

create function private.detect_unpaid(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (select private.detector_config(p_org) as c),
  o as (
    select o.branch_id, o.staff_id, o.id, o.total_poisha - private.paid_poisha(p_org, o.id) as due
      from public.orders o
     where o.org_id = p_org and o.business_date between p_from and p_to
       and o.order_status not in ('completed', 'cancelled')
       and o.payment_status in ('unpaid', 'partially_paid')
       and exists (select 1 from public.order_items i
                    where i.org_id = p_org and i.order_id = o.id and i.status = 'active' and i.kot_sent_at is not null)
  ), s as (
    select o.branch_id, o.staff_id, count(*) as orders, sum(o.due)::bigint as due
      from o where o.due > 0
     group by o.branch_id, o.staff_id
  )
  select 'orders.left_unpaid', s.branch_id, coalesce(s.staff_id::text, 'unknown'),
         jsonb_build_object('staff_id', s.staff_id, 'staff_name', st.display_name),
         s.due,
         (case when s.orders >= 3 then 'high' else 'medium' end)::public.confidence_level,
         '["orders.left_unpaid"]'::jsonb,
         jsonb_build_object('orders', s.orders, 'due_poisha', s.due),
         '["close_or_cancel_unpaid", "spot_count_drawer", "talk_to_staff"]'::jsonb
    from s cross join cfg
    left join public.staff st on st.org_id = p_org and st.id = s.staff_id
   where s.due >= (cfg.c ->> 'unpaid_min_due_poisha')::bigint
$$;

create or replace function private.detect_all(p_org uuid, p_from date, p_to date, p_kinds text[])
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  select * from private.detect_staff_anomalies(p_org, p_from, p_to) where 'staff' = any (p_kinds)
  union all select * from private.detect_cash_share(p_org, p_from, p_to) where 'cash_share' = any (p_kinds)
  union all select * from private.detect_over_short(p_org, p_from, p_to) where 'over_short' = any (p_kinds)
  union all select * from private.detect_unpaid(p_org, p_from, p_to) where 'unpaid' = any (p_kinds)
  union all select * from private.detect_commission_drag(p_org, p_from, p_to) where 'commission' = any (p_kinds)
  union all select * from private.detect_margin(p_org, p_from, p_to) where 'margin' = any (p_kinds)
  union all select * from private.detect_stock(p_org, p_from, p_to) where 'stock' = any (p_kinds)
  union all select * from private.detect_price(p_org, p_from, p_to) where 'price' = any (p_kinds)
  union all select * from private.detect_transfers(p_org, p_from, p_to) where 'transfer' = any (p_kinds)
  union all select * from private.detect_service(p_org, p_from, p_to) where 'service' = any (p_kinds)
  union all select * from private.detect_lapse(p_org, p_from, p_to) where 'customers' = any (p_kinds)
$$;

-- The weekly till detectors now include unpaid orders, in the owner's scan and at the week's day close.
create or replace function public.scan_findings(p_org uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
  v_week_start integer := coalesce((select week_start from public.org_settings where org_id = p_org), 6);
  v_this_week date;
  v_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_period record;
  v_n integer := 0;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_this_week := v_today - ((extract(dow from v_today)::integer - v_week_start + 7) % 7);
  for k in 1..4 loop
    v_n := v_n + private.save_findings(p_org, v_this_week - 7 * k, v_this_week - 7 * k + 6,
                                       array['staff', 'cash_share', 'over_short', 'unpaid']);
  end loop;
  v_n := v_n + private.save_findings(p_org, v_month, (v_month + interval '1 month - 1 day')::date,
                                     array['commission', 'margin']);
  select * into v_period from private.stock_period(p_org, v_today);
  v_n := v_n + private.save_findings(p_org, v_period.from_date, v_period.to_date, array['stock', 'price', 'transfer']);
  -- Service over the last four full weeks; customers over the last eight.
  v_n := v_n + private.save_findings(p_org, v_this_week - 28, v_this_week - 1, array['service']);
  v_n := v_n + private.save_findings(p_org, v_this_week - 56, v_this_week - 1, array['customers']);
  perform private.refresh_insights(p_org, v_today);
  perform private.write_audit(p_org, null, 'findings.scan', 'finding', null, null,
    jsonb_build_object('findings', v_n), null, null, null);
  return v_n;
end $$;

create or replace function private.close_business_day(p_org uuid, p_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_completed integer;
  v_week_start integer := coalesce((select week_start from public.org_settings where org_id = p_org), 6);
  v_count_day integer := coalesce((select count_weekday from public.org_settings where org_id = p_org), 0);
  v_weekly integer := 0;
  v_monthly integer := 0;
  v_stock integer := 0;
  v_forecast integer := 0;
  v_period record;
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
    v_weekly := private.save_findings(p_org, p_date - 6, p_date, array['staff', 'cash_share', 'over_short', 'unpaid'])
              + private.save_findings(p_org, p_date - 27, p_date, array['service'])
              + private.save_findings(p_org, p_date - 55, p_date, array['customers']);
  end if;
  if extract(day from p_date + 1) = 1 then
    v_monthly := private.save_findings(p_org, date_trunc('month', p_date)::date, p_date, array['commission', 'margin']);
  end if;
  if extract(dow from p_date)::integer = v_count_day then
    select * into v_period from private.stock_period(p_org, p_date);
    v_stock := private.save_findings(p_org, v_period.from_date, v_period.to_date, array['stock', 'price', 'transfer']);
  end if;
  v_forecast := private.store_forecast(p_org, p_date + 1);
  return jsonb_build_object('completed_orders', v_completed, 'weekly_findings', v_weekly,
                            'monthly_findings', v_monthly, 'stock_findings', v_stock, 'forecast_rows', v_forecast);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname in ('item_unit_cost', 'm_sold_for_stock', 'm_stock_moves',
              'refresh_ingredient_cost_day', 'refresh_ingredient_cost', 'recost_sales_for_ingredient', 'size_factor',
              'm_daily_overheads', 'detect_over_short', 'detector_defaults', 'detect_unpaid', 'detect_all', 'detect_stock',
              'close_business_day'))
        or (n.nspname = 'public' and p.proname in ('metric_stock_used', 'void_purchase', 'scan_findings',
              'set_variant_portion'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

comment on function private.detect_unpaid is
  'orders.left_unpaid (ADR 0066): orders sent to the kitchen and neither paid nor cancelled, by who took them.';
comment on function private.recost_sales_for_ingredient is
  'After a purchase is voided: re-prices the sales its ingredient costed, each with its own sale-time recipe.';
comment on function public.set_variant_portion is
  'How much of the dish a size uses (half = 5000): owner only, audited; past costs of the size follow.';
