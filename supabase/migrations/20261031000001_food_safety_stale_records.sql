-- ADR 0043 amendment: an old purchase record is not expired food.
--
-- A restaurant whose newest recorded purchase of an item is weeks old has either used it up or stopped
-- recording the bazar. In both cases there is no out-of-date food to protect anyone from, and stopping the
-- dish only punishes the record-keeping. So a date stops a dish only for 7 days after it passes. Past that
-- the item is listed quietly as "no recent purchase recorded". A hold by staff always blocks, however old.

create function private.food_safety_stale_days() returns integer
language sql immutable set search_path = '' as $$
  select 7
$$;

create or replace function private.m_blocked_ingredients(p_org uuid, p_branch uuid, p_today date)
returns table (ingredient_id uuid, reason text, expired_on date, hold_id uuid, note text)
language sql stable security definer set search_path = '' as $$
  select h.ingredient_id, 'held'::text, null::date, h.id, h.reason
    from public.ingredient_holds h
   where h.org_id = p_org and h.branch_id = p_branch and h.released_at is null
  union all
  select n.ingredient_id, 'expired', n.expires_on, null::uuid, null::text
    from (
      select distinct on (l.ingredient_id) l.ingredient_id, l.expires_on
        from private.m_lots(p_org, array[p_branch]) l
       where l.received_on <= p_today
       order by l.ingredient_id, l.received_on desc, l.expires_on desc nulls first
    ) n
   where n.expires_on < p_today
     and n.expires_on >= p_today - private.food_safety_stale_days()
     and coalesce((select s.food_safety_block_expired from public.org_settings s where s.org_id = p_org), true)
     and not exists (select 1 from public.ingredient_holds h
                      where h.org_id = p_org and h.branch_id = p_branch and h.ingredient_id = n.ingredient_id
                        and h.released_at is null)
$$;

-- p_all = true: every lot probably still in the kitchen with its date, for the "All dates" list. Default: only
-- those within 2 days of their date or past it. Status gains 'fresh' (more than 2 days left).
drop function public.metric_food_safety(uuid, uuid, timestamptz);
create function public.metric_food_safety(p_org uuid, p_branch uuid, p_now timestamptz, p_all boolean default false)
returns table (branch_id uuid, ingredient_id uuid, name text, name_bn text, base text, lot_kind text, lot_id uuid,
               received_on date, lot_qty numeric, expires_on date, days_left integer, on_shelf_qty numeric,
               estimated boolean, is_newest boolean, status text, as_of date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := private.business_date(p_now, private.org_cutoff(p_org));
  v_scope uuid[] := private.stock_scope(p_org, p_branch);
begin
  return query
    with st as (
      select * from private.m_stock(p_org, v_scope, v_date)
    ), est as (
      select * from private.m_stock_estimate(p_org, v_scope, v_date)
    ), onhand as (
      select coalesce(s.branch_id, e.branch_id) as branch_id, coalesce(s.ingredient_id, e.ingredient_id) as ingredient_id,
             greatest(coalesce(case when s.last_count_date is not null then s.stock_qty else e.est_qty end, 0), 0) as q,
             s.last_count_date is null as est
        from st s
        full join est e on e.branch_id = s.branch_id and e.ingredient_id = s.ingredient_id
    ), lots as (
      select l.*,
             row_number() over w as rn,
             coalesce(sum(l.qty) over (w rows between unbounded preceding and 1 preceding), 0) as newer_qty
        from private.m_lots(p_org, v_scope) l
       where l.received_on <= v_date
      window w as (partition by l.branch_id, l.ingredient_id
                   order by l.received_on desc, l.expires_on desc nulls first, l.lot_id)
    ), shelf as (
      select l.*, greatest(least(l.qty, coalesce(o.q, 0) - l.newer_qty), 0) as left_qty, coalesce(o.est, true) as est,
             private.business_date(p_now, private.branch_cutoff(p_org, l.branch_id)) as today
        from lots l
        left join onhand o on o.branch_id = l.branch_id and o.ingredient_id = l.ingredient_id
    )
    select s.branch_id, s.ingredient_id, i.name, i.name_bn, i.base::text, s.lot_kind, s.lot_id, s.received_on, s.qty,
           s.expires_on, s.expires_on - s.today, s.left_qty, s.est, s.rn = 1,
           case when s.expires_on < s.today then 'expired' when s.expires_on = s.today then 'today'
                when s.expires_on - s.today <= 2 then 'soon' else 'fresh' end,
           s.today
      from shelf s
      join public.ingredients i on i.org_id = p_org and i.id = s.ingredient_id
     where s.expires_on is not null and (p_all or s.expires_on - s.today <= 2)
       and s.expires_on >= s.today - private.food_safety_stale_days()
       and (s.left_qty > 0 or s.rn = 1)
     order by s.expires_on, i.name;
end $$;

-- food_safety.stale: items whose newest lot at a branch passed its date more than 7 days ago.
create function public.metric_food_safety_stale(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (ingredient_id uuid, name text, name_bn text, last_received date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := private.stock_scope(p_org, p_branch);
begin
  return query
    select n.ingredient_id, i.name, i.name_bn, max(n.received_on)
      from unnest(v_scope) u
     cross join lateral (
       select distinct on (l.ingredient_id) l.ingredient_id, l.received_on, l.expires_on
         from private.m_lots(p_org, array[u]) l
        where l.received_on <= private.business_date(p_now, private.branch_cutoff(p_org, u))
        order by l.ingredient_id, l.received_on desc, l.expires_on desc nulls first
     ) n
      join public.ingredients i on i.org_id = p_org and i.id = n.ingredient_id
     where n.expires_on < private.business_date(p_now, private.branch_cutoff(p_org, u)) - private.food_safety_stale_days()
     group by n.ingredient_id, i.name, i.name_bn
     order by i.name;
end $$;

revoke execute on function private.food_safety_stale_days() from public, anon, authenticated;
revoke execute on function public.metric_food_safety_stale(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.metric_food_safety_stale(uuid, uuid, timestamptz) to authenticated, service_role;
revoke execute on function public.metric_food_safety(uuid, uuid, timestamptz, boolean) from public, anon;
grant execute on function public.metric_food_safety(uuid, uuid, timestamptz, boolean) to authenticated, service_role;

comment on function public.metric_food_safety is
  'food_safety.lots: lots near or past their date, or with p_all every lot probably still in the kitchen, with what is probably left (stock roles). ADR 0043.';

comment on function public.metric_food_safety_stale is
  'food_safety.stale: items with no recent purchase recorded, whose newest lot is over 7 days past its date (stock roles). ADR 0043.';
