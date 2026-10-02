-- ADR 0030, refined: "used" and "a day" come from the same days, so the Stock page row adds up —
-- "Used 1.2 kg in 4 days · about 300 g a day" — and days left = what is left ÷ that daily average.
--   since_on       = the first of the last D days (D = 14, or the days since the item was first bought,
--                    counted or received at the branch when fewer)
--   used_since_qty = usage.theoretical over those D days (recipes of the dishes sold)
--   avg_daily_qty  = used_since_qty ÷ D
-- Before this, "used" ran from the last count and included waste, while the average ran over D days.

create or replace function public.metric_stock_status(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (
  branch_id uuid, ingredient_id uuid, name text, name_bn text, base text, last_count_date date,
  last_count_qty numeric, purchases_qty numeric, transfers_in_qty numeric, transfers_out_qty numeric,
  usage_qty numeric, waste_qty numeric, stock_qty numeric, in_transit_qty numeric, usage_14d_qty numeric,
  days_of_cover numeric, band text, as_of date, estimated boolean, since_on date, used_since_qty numeric,
  avg_daily_qty numeric
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := private.business_date(p_now, private.org_cutoff(p_org));
  v_scope uuid[] := private.stock_scope(p_org, p_branch);
begin
  return query
    with st as (
      select * from private.m_stock(p_org, v_scope, v_date)
    ), est as (
      select * from private.m_stock_estimate(p_org, v_scope, v_date)
    ), keys as (
      select s.branch_id, s.ingredient_id from st s
      union
      select e.branch_id, e.ingredient_id from est e
    ), first_seen as (
      -- The first day the item was bought, counted or received at the branch.
      select x.branch_id, x.ingredient_id, min(x.d) as d
        from (
          select p.branch_id, pl.ingredient_id, p.purchased_on as d
            from public.purchase_lines pl
            join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
           where pl.org_id = p_org and p.branch_id = any (v_scope) and p.status = 'confirmed'
          union all
          select sc.branch_id, l.ingredient_id, sc.counted_on
            from public.stock_counts sc
            join public.stock_count_lines l on l.org_id = sc.org_id and l.stock_count_id = sc.id
           where sc.org_id = p_org and sc.branch_id = any (v_scope) and sc.status = 'submitted'
          union all
          select t.to_branch_id, tl.ingredient_id, t.received_on
            from public.transfers t
            join public.transfer_lines tl on tl.org_id = t.org_id and tl.transfer_id = t.id
           where t.org_id = p_org and t.to_branch_id = any (v_scope) and t.status in ('received', 'disputed')
        ) x
       where x.d <= v_date
       group by 1, 2
    ), daily as (
      select m.branch_id, m.ingredient_id, m.business_date, sum(m.qty) as qty
        from private.m_stock_moves(p_org, v_scope, v_date - 13, v_date) m
       where m.kind = 'usage'
       group by 1, 2, 3
    ), rows as (
      select k.branch_id, k.ingredient_id, s.last_count_date, s.last_count_qty, s.purchases_qty,
             s.transfers_in_qty, s.transfers_out_qty, s.usage_qty, s.waste_qty, s.in_transit_qty,
             s.usage_14d_qty,
             s.last_count_date is null and e.est_qty is not null as estimated,
             case when s.last_count_date is not null then s.stock_qty else e.est_qty end as stock,
             -- D = 14, or fewer when the item was first seen less than 14 days ago (today included).
             case when f.d is null then 14 else least(14, greatest(v_date - f.d + 1, 1)) end as d
        from keys k
        left join st s on s.branch_id = k.branch_id and s.ingredient_id = k.ingredient_id
        left join est e on e.branch_id = k.branch_id and e.ingredient_id = k.ingredient_id
        left join first_seen f on f.branch_id = k.branch_id and f.ingredient_id = k.ingredient_id
    ), with_use as (
      select r.*,
             coalesce((select sum(dl.qty) from daily dl
                        where dl.branch_id = r.branch_id and dl.ingredient_id = r.ingredient_id
                          and dl.business_date > v_date - r.d), 0) as use_d
        from rows r
    )
    select w.branch_id, w.ingredient_id, i.name, i.name_bn, i.base::text, w.last_count_date, w.last_count_qty,
           coalesce(w.purchases_qty, 0), coalesce(w.transfers_in_qty, 0), coalesce(w.transfers_out_qty, 0),
           coalesce(w.usage_qty, 0), coalesce(w.waste_qty, 0), w.stock, coalesce(w.in_transit_qty, 0),
           coalesce(w.usage_14d_qty, 0),
           case when w.stock is not null and w.use_d > 0 then round(w.stock * w.d / w.use_d, 2) end,
           case when w.stock is null or w.use_d <= 0 then 'none'
                when w.stock * w.d >= coalesce(i.cover_green_days, 7) * w.use_d then 'green'
                when w.stock * w.d < coalesce(i.cover_red_days, 3) * w.use_d then 'red'
                else 'yellow' end,
           v_date, w.estimated, v_date - w.d + 1, w.use_d,
           case when w.use_d > 0 then w.use_d / w.d end
      from with_use w
      join public.ingredients i on i.org_id = p_org and i.id = w.ingredient_id and i.is_active
     order by case
                when w.stock is null or w.use_d <= 0 then 3
                when w.stock * w.d < coalesce(i.cover_red_days, 3) * w.use_d then 0
                when w.stock * w.d >= coalesce(i.cover_green_days, 7) * w.use_d then 2
                else 1 end,
              i.name;
end $$;
