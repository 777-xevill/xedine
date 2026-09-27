-- Phase 9 — Branch Intelligence & Industry Benchmarking (ROADMAP Phase 9, METRICS.md "Benchmarks", ADR 0022).
--   Branches: a league table per branch, the gap to the best branch in ৳, a money-free manager scorecard,
--   like-for-like item comparisons and a transfer audit.
--   Benchmarks: opt-in, monthly percentile snapshots with k ≥ 5 restaurants per cell (and ≥ 5 outside it),
--   compared with the org's own month; labelled "industry reference" ranges when no peer cell exists.

-- ---------------------------------------------------------------------------------------------
-- League: one row per branch. Every figure comes from an existing metric function; this only puts them
-- side by side. Cost figures (food cost %, labour, waste value, unexplained usage) are money.
-- ---------------------------------------------------------------------------------------------
create function private.m_branch_league(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (
  branch_id uuid, days_open integer, orders bigint, gross_poisha bigint, net_poisha bigint, aov_poisha bigint,
  net_per_day_poisha bigint, discounts_poisha bigint, discount_bps integer, void_after_kot_poisha bigint,
  void_bps integer, delivery_share_bps integer, ticket_median_seconds numeric, ratings bigint, rating_avg numeric,
  first_return_30d_bps integer, discipline_avg integer, tfc_pct_bps integer, coverage_bps integer,
  labour_poisha bigint, labour_bps integer, waste_poisha bigint, waste_bps integer,
  bridge_net_poisha bigint, unexplained_poisha bigint, unexplained_bps integer
) language sql stable security definer set search_path = '' as $$
  with s as (
    select * from private.m_sales(p_org, p_branches, p_from, p_to) x where x.branch_id is not null
  ), days as (
    select o.branch_id, count(distinct o.business_date)::integer as n,
           coalesce(sum(o.net_poisha) filter (where c.kind in ('own_delivery', 'foodpanda', 'pathao_food')), 0) as delivery,
           coalesce(sum(o.net_poisha), 0) as net
      from public.orders o join public.channels c on c.org_id = o.org_id and c.id = o.channel_id
     where o.org_id = p_org and o.branch_id = any (p_branches) and o.order_status = 'completed'
       and o.business_date between p_from and p_to
     group by o.branch_id
  ), v as (
    select x.branch_id, sum(x.void_after_kot_poisha) as voids
      from private.m_staff_exceptions(p_org, p_branches, p_from, p_to) x group by x.branch_id
  ), t as (
    select x.branch_id, percentile_cont(0.5) within group (order by x.ticket_seconds) as med
      from private.m_ticket_times(p_org, p_branches, p_from, p_to) x group by x.branch_id
  ), r as (
    select x.branch_id, count(*) as n, avg(x.rating) as avg_rating from (
      select f.branch_id, f.rating::numeric as rating from public.feedback f
       where f.org_id = p_org and f.branch_id = any (p_branches) and f.rating is not null and f.submitted_at is not null
         and private.business_date(f.submitted_at, private.org_cutoff(p_org)) between p_from and p_to
      union all
      select rv.branch_id, rv.rating from public.reviews rv
       where rv.org_id = p_org and rv.branch_id = any (p_branches) and rv.rating is not null
         and private.business_date(rv.reviewed_at, private.org_cutoff(p_org)) between p_from and p_to
    ) x group by x.branch_id
  ), d as (
    select x.branch_id, round(avg(x.score))::integer as score
      from private.m_discipline(p_org, p_branches, p_from, p_to) x where x.open_day group by x.branch_id
  ), fc as (
    select * from private.m_food_cost(p_org, p_branches, p_from, p_to) x where x.branch_id is not null
  ), lab as (
    select o.branch_id, sum(o.labour_daily_poisha)::bigint as labour
      from generate_series(p_from, p_to, interval '1 day') g(day)
      cross join lateral private.m_daily_overheads(p_org, p_branches, g.day::date) o
     where o.branch_id is not null group by o.branch_id
  ), w as (
    select x.branch_id, sum(x.value_poisha)::bigint as waste
      from private.m_waste_board(p_org, p_branches, p_from, p_to) x group by x.branch_id
  ), br as (
    select * from private.m_variance_bridge(p_org, p_branches, p_from, p_to) x where x.branch_id is not null
  )
  select b.id, coalesce(days.n, 0), s.orders_completed, s.gross_poisha, s.net_poisha, s.aov_poisha,
         case when coalesce(days.n, 0) > 0 then round(s.net_poisha::numeric / days.n)::bigint end,
         s.discounts_poisha,
         case when s.gross_poisha > 0 then round(s.discounts_poisha * 10000.0 / s.gross_poisha)::integer end,
         coalesce(v.voids, 0)::bigint,
         case when s.gross_poisha > 0 then round(coalesce(v.voids, 0) * 10000.0 / s.gross_poisha)::integer end,
         case when days.net > 0 then round(days.delivery * 10000.0 / days.net)::integer end,
         round(t.med), coalesce(r.n, 0), round(r.avg_rating, 1),
         cs.first_return_30d_bps, d.score, fc.tfc_pct_bps, fc.coverage_bps,
         coalesce(lab.labour, 0),
         case when s.net_poisha > 0 then round(coalesce(lab.labour, 0) * 10000.0 / s.net_poisha)::integer end,
         coalesce(w.waste, 0),
         case when s.net_poisha > 0 then round(coalesce(w.waste, 0) * 10000.0 / s.net_poisha)::integer end,
         br.net_sales_poisha, br.unexplained_poisha, br.unexplained_pct_of_sales_bps
    from public.branches b
    join s on s.branch_id = b.id
    left join days on days.branch_id = b.id
    left join v on v.branch_id = b.id
    left join t on t.branch_id = b.id
    left join r on r.branch_id = b.id
    left join d on d.branch_id = b.id
    left join fc on fc.branch_id = b.id
    left join lab on lab.branch_id = b.id
    left join w on w.branch_id = b.id
    left join br on br.branch_id = b.id
    left join lateral private.m_customer_summary(p_org, array[b.id], p_to) cs on true
   where b.org_id = p_org and b.id = any (p_branches)
$$;

-- ---------------------------------------------------------------------------------------------
-- Gap to the best branch, in ৳: for each rate where lower is better, what this branch would have kept at
-- the best branch's rate on its own sales. Food cost % is left out (it follows the menu mix, not the
-- branch's discipline; like-for-like compares items instead). Needs two branches with the figure.
-- ---------------------------------------------------------------------------------------------
create function private.m_branch_gaps(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (branch_id uuid, component text, branch_bps integer, best_bps integer, best_branch_id uuid,
               base_poisha bigint, gap_poisha bigint)
language sql stable security definer set search_path = '' as $$
  with l as (select * from private.m_branch_league(p_org, p_branches, p_from, p_to)),
  c as (
    select l.branch_id, 'unexplained'::text as component, l.unexplained_poisha::numeric as amount,
           l.bridge_net_poisha::numeric as base from l where l.unexplained_poisha is not null
    union all select l.branch_id, 'waste', l.waste_poisha, l.net_poisha from l
    union all select l.branch_id, 'labour', l.labour_poisha, l.net_poisha from l where l.labour_poisha > 0
    union all select l.branch_id, 'discounts', l.discounts_poisha, l.gross_poisha from l
    union all select l.branch_id, 'voids', l.void_after_kot_poisha, l.gross_poisha from l
  ), r as (
    select c.*, c.amount / c.base as rate from c where c.base > 0
  ), best as (
    select distinct on (r.component) r.component, r.rate, r.branch_id, count(*) over (partition by r.component) as n
      from r order by r.component, r.rate, r.branch_id
  )
  -- The gap is exact: this branch's amount minus what it would have been at the best branch's rate.
  select r.branch_id, r.component, round(r.rate * 10000)::integer, round(best.rate * 10000)::integer, best.branch_id,
         r.base::bigint, greatest(0, round(r.amount - best.rate * r.base))::bigint
    from r join best on best.component = r.component
   where best.n >= 2
$$;

create function public.metric_branch_league(p_org uuid, p_from date, p_to date)
returns table (
  branch_id uuid, days_open integer, orders bigint, net_poisha bigint, aov_poisha bigint, net_per_day_poisha bigint,
  discount_bps integer, void_bps integer, delivery_share_bps integer, ticket_median_seconds numeric, ratings bigint,
  rating_avg numeric, first_return_30d_bps integer, discipline_avg integer, tfc_pct_bps integer, coverage_bps integer,
  labour_bps integer, waste_bps integer, unexplained_bps integer, gap_poisha bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[];
  v_money boolean;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'pick a period of at most 93 days' using errcode = 'invalid_parameter_value';
  end if;
  if not private.is_service_role()
     and not private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_scope := private.metric_scope(p_org, null);
  v_money := private.is_service_role() or private.can_see_money(p_org);
  return query
    select l.branch_id, l.days_open, l.orders, l.net_poisha, l.aov_poisha, l.net_per_day_poisha, l.discount_bps,
           l.void_bps, l.delivery_share_bps, l.ticket_median_seconds, l.ratings, l.rating_avg, l.first_return_30d_bps,
           l.discipline_avg,
           case when v_money then l.tfc_pct_bps end, case when v_money then l.coverage_bps end,
           case when v_money then l.labour_bps end, case when v_money then l.waste_bps end,
           case when v_money then l.unexplained_bps end,
           case when v_money then (select coalesce(sum(g.gap_poisha), 0)::bigint
                                     from private.m_branch_gaps(p_org, v_scope, p_from, p_to) g
                                    where g.branch_id = l.branch_id) end
      from private.m_branch_league(p_org, v_scope, p_from, p_to) l
     order by l.net_poisha desc;
end $$;

create function public.metric_branch_gaps(p_org uuid, p_from date, p_to date)
returns table (branch_id uuid, component text, branch_bps integer, best_bps integer, best_branch_id uuid,
               base_poisha bigint, gap_poisha bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'pick a period of at most 93 days' using errcode = 'invalid_parameter_value';
  end if;
  perform private.require_money(p_org);
  return query
    select g.* from private.m_branch_gaps(p_org, private.metric_scope(p_org, null), p_from, p_to) g
     order by g.gap_poisha desc;
end $$;

-- Manager scorecard: money-free measures for one branch, each with its rank among the org's branches.
-- Other branches' values are never returned — only where this branch stands (ADR 0007, ADR 0022 §3).
create function public.metric_branch_scorecard(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (measure text, value numeric, better text, rank integer, branches integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_all uuid[];
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'pick a period of at most 93 days' using errcode = 'invalid_parameter_value';
  end if;
  if p_branch is null or not (private.is_service_role() or (
       private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[])
       and private.can_access_branch(p_org, p_branch))) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(array_agg(b.id), '{}') into v_all from public.branches b where b.org_id = p_org;
  return query
    with l as (select * from private.m_branch_league(p_org, v_all, p_from, p_to)),
    m as (
      select l.branch_id, 'orders_per_day'::text as measure,
             case when l.days_open > 0 then round(l.orders::numeric / l.days_open, 1) end as value, 'higher'::text as better from l
      union all select l.branch_id, 'net_per_day', l.net_per_day_poisha, 'higher' from l
      union all select l.branch_id, 'aov', l.aov_poisha, 'higher' from l
      union all select l.branch_id, 'ticket_minutes', round(l.ticket_median_seconds / 60.0, 1), 'lower' from l
      union all select l.branch_id, 'rating', l.rating_avg, 'higher' from l
      union all select l.branch_id, 'first_return', l.first_return_30d_bps, 'higher' from l
      union all select l.branch_id, 'discipline', l.discipline_avg, 'higher' from l
      union all select l.branch_id, 'discount_rate', l.discount_bps, 'lower' from l
      union all select l.branch_id, 'void_rate', l.void_bps, 'lower' from l
    ), ranked as (
      select m.*,
             case when m.value is not null then
               (rank() over (partition by m.measure, m.value is null
                             order by case when m.better = 'higher' then -m.value else m.value end))::integer end as rk,
             (count(m.value) over (partition by m.measure))::integer as n
        from m
    )
    select r.measure, r.value, r.better, r.rk, r.n from ranked r where r.branch_id = p_branch
     order by array_position(array['net_per_day', 'orders_per_day', 'aov', 'ticket_minutes', 'rating',
                                   'first_return', 'discipline', 'discount_rate', 'void_rate'], r.measure);
end $$;

-- Like-for-like: the same menu items side by side — units per open day and the average price realised.
create function public.metric_like_for_like(p_org uuid, p_from date, p_to date, p_limit integer default 20)
returns table (menu_item_id uuid, name text, name_bn text, branch_id uuid, qty bigint, per_day numeric,
               avg_net_poisha bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[];
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'pick a period of at most 93 days' using errcode = 'invalid_parameter_value';
  end if;
  if not private.is_service_role()
     and not private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_scope := private.metric_scope(p_org, null);
  return query
    with days as (
      select o.branch_id, count(distinct o.business_date) as n from public.orders o
       where o.org_id = p_org and o.branch_id = any (v_scope) and o.order_status = 'completed'
         and o.business_date between p_from and p_to group by o.branch_id
    ), x as (
      select oi.menu_item_id, oi.branch_id, sum(oi.quantity)::bigint as qty, sum(oi.net_poisha) as net
        from public.order_items oi join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
       where oi.org_id = p_org and oi.branch_id = any (v_scope) and oi.status = 'active' and oi.menu_item_id is not null
         and o.order_status = 'completed' and o.business_date between p_from and p_to
       group by oi.menu_item_id, oi.branch_id
    ), common as (
      select x.menu_item_id, sum(x.qty) as total from x group by x.menu_item_id having count(*) >= 2
       order by sum(x.qty) desc limit greatest(1, least(coalesce(p_limit, 20), 100))
    )
    select x.menu_item_id, mi.name, mi.name_bn, x.branch_id, x.qty, round(x.qty::numeric / days.n, 1),
           round(x.net / x.qty)::bigint
      from x join common on common.menu_item_id = x.menu_item_id
      join days on days.branch_id = x.branch_id
      join public.menu_items mi on mi.org_id = p_org and mi.id = x.menu_item_id
     order by common.total desc, mi.name, x.branch_id;
end $$;

-- Transfer audit: every transfer touching the caller's branches, with what arrived and how long it took.
create function public.metric_transfer_audit(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (transfer_id uuid, from_branch_id uuid, to_branch_id uuid, status text, sent_on date, received_on date,
               days_to_receive integer, lines integer, short_lines integer, value_sent_poisha bigint,
               value_short_poisha bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[];
  v_money boolean;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'pick a period of at most a year' using errcode = 'invalid_parameter_value';
  end if;
  if not private.is_service_role()
     and not private.has_role(p_org, array['owner', 'manager', 'purchaser', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_scope := private.metric_scope(p_org, p_branch);
  v_money := private.is_service_role() or private.can_see_money(p_org);
  return query
    with t as (
      select tr.*, private.business_date(tr.sent_at, private.org_cutoff(p_org)) as sent_day,
             private.business_date(tr.received_at, private.org_cutoff(p_org)) as recv_day
        from public.transfers tr
       where tr.org_id = p_org and tr.status <> 'draft' and tr.sent_at is not null
         and (tr.from_branch_id = any (v_scope) or tr.to_branch_id = any (v_scope))
    ), l as (
      select tl.transfer_id, count(*)::integer as n,
             count(*) filter (where tl.qty_base_received is not null
                                and tl.qty_base_received < tl.qty_base_sent * 0.98)::integer as short,
             round(sum(tl.qty_base_sent * coalesce(private.ingredient_unit_cost(p_org, tl.ingredient_id, t.sent_day), 0)))::bigint as sent_value,
             round(sum(greatest(0, tl.qty_base_sent - coalesce(tl.qty_base_received, tl.qty_base_sent))
                       * coalesce(private.ingredient_unit_cost(p_org, tl.ingredient_id, t.sent_day), 0)))::bigint as short_value
        from public.transfer_lines tl join t on t.id = tl.transfer_id
       where tl.org_id = p_org group by tl.transfer_id
    )
    select t.id, t.from_branch_id, t.to_branch_id, t.status::text, t.sent_day, t.recv_day, t.recv_day - t.sent_day,
           coalesce(l.n, 0), coalesce(l.short, 0),
           case when v_money then l.sent_value end, case when v_money then l.short_value end
      from t left join l on l.transfer_id = t.id
     where t.sent_day between p_from and p_to
     order by (t.status = 'sent') desc, (coalesce(l.short, 0) > 0 or t.status = 'disputed') desc, t.sent_at desc;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Benchmarks (METRICS.md). An org's own monthly figures; which orgs may be pooled; the monthly job.
-- Cells use two dimensions only — cuisine and branch band (1 / 2–5 / 6+) — because five dimensions
-- would leave every cell empty at the early customer count (ROADMAP reality check, ADR 0022 §4).
-- ---------------------------------------------------------------------------------------------
create function private.branch_band(p_branches bigint) returns text
language sql immutable set search_path = '' as $$
  select case when p_branches <= 1 then '1' when p_branches <= 5 then '2-5' else '6+' end
$$;

create function private.org_benchmark_values(p_org uuid, p_from date, p_to date)
returns table (metric_id text, value numeric)
language sql stable security definer set search_path = '' as $$
  with b as (select coalesce(array_agg(x.id), '{}') as ids from public.branches x where x.org_id = p_org),
  l as (select l.* from b, private.m_branch_league(p_org, b.ids, p_from, p_to) l),
  fc as (select f.* from b, private.m_food_cost(p_org, b.ids, p_from, p_to) f where f.branch_id is null),
  cs as (select c.* from b, private.m_customer_summary(p_org, b.ids, p_to) c),
  agg as (
    select sum(l.net_poisha) as net, sum(l.orders) as orders, sum(l.days_open) as branch_days,
           sum(l.labour_poisha) as labour, sum(l.ratings) as ratings,
           sum(l.rating_avg * l.ratings) as rating_sum,
           sum(l.net_poisha * l.delivery_share_bps) as delivery_weighted
      from l
  )
  select 'food_cost.theoretical_pct', fc.tfc_pct_bps::numeric from fc where fc.coverage_bps >= 9000
  union all select 'labour.pct', round(agg.labour * 10000.0 / agg.net) from agg where agg.net > 0 and agg.labour > 0
  union all select 'sales.net_per_branch_day', round(agg.net::numeric / agg.branch_days) from agg where agg.branch_days > 0
  union all select 'orders.aov', round(agg.net::numeric / agg.orders) from agg where agg.orders > 0
  union all select 'rating.avg', round(agg.rating_sum / agg.ratings, 1) from agg where agg.ratings >= 20
  union all select 'visits.first_return_rate', cs.first_return_30d_bps::numeric from cs
   where cs.first_timers >= 30 and cs.first_return_30d_bps is not null
  union all select 'channel.delivery_share', round(agg.delivery_weighted / agg.net) from agg where agg.net > 0
$$;

-- Pooled only if the owner opted in and the org has ≥ 30 trading days in the 90 days to the period end
-- and trades in the period itself. Demo orgs are never pooled.
create function private.benchmark_eligible(p_org uuid, p_from date, p_to date) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.benchmark_opt_in from public.org_settings s where s.org_id = p_org), false)
     and not coalesce((select o.slug like 'demo-%' from public.organizations o where o.id = p_org), false)
     and (select count(distinct o.business_date) from public.orders o
           where o.org_id = p_org and o.order_status = 'completed' and o.business_date between p_to - 89 and p_to) >= 30
     and exists (select 1 from public.orders o where o.org_id = p_org and o.order_status = 'completed'
                  and o.business_date between p_from and p_to)
$$;

create function public.job_benchmark_snapshot(p_period date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_from date := date_trunc('month', p_period)::date;
  v_to date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_rows integer;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  delete from public.benchmark_snapshots where period = v_from and not is_reference;
  with orgs as (
    select o.id, nullif(lower(btrim(p.cuisine)), '') as cuisine,
           private.branch_band((select count(*) from public.branches b where b.org_id = o.id)) as band
      from public.organizations o left join public.org_profile p on p.org_id = o.id
     where private.benchmark_eligible(o.id, v_from, v_to)
  ), vals as (
    select o.id as org_id, o.cuisine, o.band, v.metric_id, v.value
      from orgs o cross join lateral private.org_benchmark_values(o.id, v_from, v_to) v
     where v.value is not null
  ), cells as (
    -- level 0: everyone; level 1: one dimension; level 2: both.
    select 0 as level, v.metric_id, null::text as cuisine, null::text as band, v.org_id, v.value from vals v
    union all select 1, v.metric_id, v.cuisine, null, v.org_id, v.value from vals v where v.cuisine is not null
    union all select 1, v.metric_id, null, v.band, v.org_id, v.value from vals v
    union all select 2, v.metric_id, v.cuisine, v.band, v.org_id, v.value from vals v where v.cuisine is not null
  ), stats as (
    select c.level, c.metric_id, c.cuisine, c.band, count(distinct c.org_id) as k,
           percentile_cont(0.25) within group (order by c.value) as p25,
           percentile_cont(0.5) within group (order by c.value) as p50,
           percentile_cont(0.75) within group (order by c.value) as p75
      from cells c group by c.level, c.metric_id, c.cuisine, c.band
  ), safe as (
    -- k ≥ 5 in the cell, and the rest of every parent cell is empty or ≥ 5 too, so two published cells
    -- can never be differenced down to fewer than five restaurants.
    select s.* from stats s
     where s.k >= 5
       and not exists (
         select 1 from stats p
          where p.metric_id = s.metric_id and p.level = s.level - 1
            and (p.level = 0
                 or (p.cuisine = s.cuisine and p.band is null)
                 or (p.band = s.band and p.cuisine is null))
            and p.k - s.k between 1 and 4)
  )
  insert into public.benchmark_snapshots (period, segment, metric_id, p25, p50, p75, k, is_reference, source_note)
  select v_from,
         jsonb_strip_nulls(jsonb_build_object('cuisine', s.cuisine, 'branch_band', s.band)),
         s.metric_id, round(s.p25::numeric, 1), round(s.p50::numeric, 1), round(s.p75::numeric, 1), s.k, false,
         'Xedine restaurants that opted in'
    from safe s;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke execute on function public.job_benchmark_snapshot(date) from public, anon, authenticated;
grant execute on function public.job_benchmark_snapshot(date) to service_role;

-- The org's last full month against the most specific safe cell (cuisine + band → cuisine → band → all),
-- else the labelled industry reference. Peer cells are shown only to orgs that opted in (give to get).
create function public.metric_benchmarks(p_org uuid, p_now timestamptz)
returns table (metric_id text, own_value numeric, period date, segment jsonb, p25 numeric, p50 numeric, p75 numeric,
               k integer, is_reference boolean, source_note text, better text, place text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_asof date;
  v_to date;
  v_from date;
  v_cuisine text;
  v_band text;
  v_opt boolean;
begin
  if not private.is_service_role() and not private.can_see_money(p_org) then
    raise exception 'benchmarks are for the owner and accountant' using errcode = 'insufficient_privilege';
  end if;
  v_asof := private.business_date(p_now, private.org_cutoff(p_org));
  v_to := (date_trunc('month', v_asof) - interval '1 day')::date;
  v_from := date_trunc('month', v_to)::date;
  select nullif(lower(btrim(p.cuisine)), '') into v_cuisine from public.org_profile p where p.org_id = p_org;
  v_band := private.branch_band((select count(*) from public.branches b where b.org_id = p_org));
  v_opt := coalesce((select s.benchmark_opt_in from public.org_settings s where s.org_id = p_org), false);
  return query
    with own as (select * from private.org_benchmark_values(p_org, v_from, v_to)),
    ids as (
      select unnest(array['food_cost.theoretical_pct', 'labour.pct', 'sales.net_per_branch_day', 'orders.aov',
                          'rating.avg', 'visits.first_return_rate', 'channel.delivery_share']) as metric_id
    ), pick as (
      select i.metric_id, (
        select b from public.benchmark_snapshots b
         where b.metric_id = i.metric_id and (
                 (v_opt and not b.is_reference and b.period <= v_from and (
                    b.segment = jsonb_strip_nulls(jsonb_build_object('cuisine', v_cuisine, 'branch_band', v_band))
                    or (v_cuisine is not null and b.segment = jsonb_build_object('cuisine', v_cuisine))
                    or b.segment = jsonb_build_object('branch_band', v_band)
                    or b.segment = '{}'::jsonb))
                 or b.is_reference)
         order by b.is_reference, b.period desc,
                  case when b.segment ? 'cuisine' and b.segment ? 'branch_band' then 0
                       when b.segment ? 'cuisine' then 1 when b.segment ? 'branch_band' then 2 else 3 end
         limit 1) as b
        from ids i
    )
    select p.metric_id, own.value, (p.b).period, (p.b).segment, (p.b).p25, (p.b).p50, (p.b).p75, (p.b).k,
           coalesce((p.b).is_reference, false), (p.b).source_note,
           case when p.metric_id in ('food_cost.theoretical_pct', 'labour.pct') then 'lower'
                when p.metric_id = 'channel.delivery_share' then 'neutral' else 'higher' end,
           case when own.value is null or (p.b).p25 is null then null
                when own.value < (p.b).p25 then 'below_p25'
                when own.value < (p.b).p50 then 'p25_p50'
                when own.value <= (p.b).p75 then 'p50_p75'
                else 'above_p75' end
      from pick p left join own on own.metric_id = p.metric_id;
end $$;

-- Signed-in users only (the functions check roles themselves); private helpers are for definer code only.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname in ('m_branch_league', 'm_branch_gaps', 'branch_band',
              'org_benchmark_values', 'benchmark_eligible'))
        or (n.nspname = 'public' and p.proname in ('metric_branch_league', 'metric_branch_gaps',
              'metric_branch_scorecard', 'metric_like_for_like', 'metric_transfer_audit', 'metric_benchmarks'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

comment on function public.metric_branch_league is 'Branch league table (M13); cost columns null for non-money roles. Phase 9.';
comment on function public.metric_branch_gaps is 'Gap to the best branch in ৳ per component (money). Phase 9.';
comment on function public.metric_branch_scorecard is 'Money-free manager scorecard: values and ranks for one branch only. Phase 9.';
comment on function public.metric_like_for_like is 'Common items across branches: units per open day and average price realised. Phase 9.';
comment on function public.metric_transfer_audit is 'Transfers with shortfalls and time to receive; values money-gated. Phase 9.';
comment on function public.job_benchmark_snapshot is 'Monthly percentile snapshots, k >= 5 per cell and per complement (service role). Phase 9.';
comment on function public.metric_benchmarks is 'The org''s last full month vs the most specific safe peer cell or the labelled reference. Phase 9.';

-- Monthly snapshot: 04:00 Dhaka on the 2nd (22:00 UTC on the 1st).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('xedine-benchmarks', '0 22 1 * *', $cmd$select private.dispatch_job('benchmarks')$cmd$);
    exception when others then
      raise notice 'could not create the pg_cron schedule: %', sqlerrm;
    end;
  end if;
end $$;
