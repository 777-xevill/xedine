-- ADR 0030: remaining stock without counting first; ADR 0029 amended: no "how much is left?" questions.
--
-- 1. The founder: asking the purchaser how much is left is not the purchaser's job. The check
--    questions (stock_checks, the 07:00 job, the chat_* check functions) are removed. The days a lot
--    was bought for stay, as a countdown on the Stock page.
-- 2. stock.estimate: an item nobody has counted at a branch shows what the records say is left since
--    it was first bought there (bought − used by recipes − written-down waste), marked as an estimate,
--    instead of "unknown". The count-based stock maths (private.m_stock) is unchanged, so the Stock
--    Guard, hiding an item and the bazar list still treat a never-counted item as unknown.
-- 3. Average daily use (and so days left) is over the last 14 days, or over the days since the item
--    was first bought, counted or received at the branch when that is fewer — a new item's 4 days of
--    use are not spread over 14.

-- ---------------------------------------------------------------------------------------------
-- 1. Remove the check questions
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('xedine-stock-checks');
    exception when others then
      raise notice 'no xedine-stock-checks schedule to remove: %', sqlerrm;
    end;
  end if;
end $$;
delete from public.job_schedules where job = 'stock_checks';

drop function public.job_stock_checks(uuid, timestamptz);
drop function public.chat_stock_checks_after_purchase(public.chat_channel, text, uuid);
drop function public.chat_stock_check_sent(public.chat_channel, text, uuid[], bigint);
drop function public.chat_await_stock_check(public.chat_channel, text, uuid);
drop function public.chat_answer_stock_check(public.chat_channel, text, uuid, numeric);
drop function private.chat_own_check(public.chat_links, uuid);
drop function private.open_stock_check(uuid, uuid, uuid, uuid, date, numeric, smallint, date, text, uuid);
drop function public.metric_stock_lots(uuid, uuid, timestamptz);
drop table public.stock_checks;
delete from private.policy_registry where table_name = 'stock_checks';
alter table public.chat_links drop constraint chat_links_org_id_id_key;

-- The lots, without checks: running (today ≤ its last day) or ended (shown for 7 days after).
drop function private.m_stock_lots(uuid, uuid[], timestamptz);
create function private.m_stock_lots(p_org uuid, p_branches uuid[], p_now timestamptz)
returns table (
  branch_id uuid, ingredient_id uuid, bought_on date, qty numeric, for_days smallint, ends_on date,
  days_left integer, status text, prev_for_days smallint, prev_lasted_days integer, as_of date
) language sql stable security definer set search_path = '' as $$
  with days as (
    select pl.branch_id, pl.ingredient_id, p.purchased_on, sum(pl.qty_base) as qty,
           (array_agg(pl.for_days order by p.confirmed_at desc nulls last, pl.id desc)
              filter (where pl.for_days is not null))[1] as for_days
      from public.purchase_lines pl
      join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
     where pl.org_id = p_org and pl.branch_id = any (p_branches) and p.status = 'confirmed'
     group by 1, 2, 3
  ), ranked as (
    select d.*, row_number() over (partition by d.branch_id, d.ingredient_id order by d.purchased_on desc) as rn,
           lead(d.purchased_on) over (partition by d.branch_id, d.ingredient_id order by d.purchased_on desc) as prev_on,
           lead(d.for_days) over (partition by d.branch_id, d.ingredient_id order by d.purchased_on desc) as prev_days
      from days d
  ), lots as (
    select r.branch_id, r.ingredient_id, r.purchased_on, r.qty, r.for_days, r.prev_on, r.prev_days,
           private.business_date(p_now, private.branch_cutoff(p_org, r.branch_id)) as today
      from ranked r
     where r.rn = 1 and r.for_days is not null
  )
  select l.branch_id, l.ingredient_id, l.purchased_on, l.qty, l.for_days,
         l.purchased_on + l.for_days - 1,
         greatest(l.purchased_on + l.for_days - l.today, 0),
         case when l.today <= l.purchased_on + l.for_days - 1 then 'running' else 'ended' end,
         l.prev_days,
         case when l.prev_days is not null then l.purchased_on - l.prev_on end,
         l.today
    from lots l
    join public.ingredients i on i.org_id = p_org and i.id = l.ingredient_id and i.is_active
   where l.purchased_on <= l.today
     and l.today <= l.purchased_on + l.for_days - 1 + 7
$$;
revoke execute on function private.m_stock_lots(uuid, uuid[], timestamptz) from public, anon, authenticated;

create function public.metric_stock_lots(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (
  branch_id uuid, ingredient_id uuid, name text, name_bn text, base text, bought_on date, qty numeric,
  for_days smallint, ends_on date, days_left integer, status text, prev_for_days smallint,
  prev_lasted_days integer, as_of date
) language sql stable security definer set search_path = '' as $$
  select m.branch_id, m.ingredient_id, i.name, i.name_bn, i.base::text, m.bought_on, m.qty, m.for_days,
         m.ends_on, m.days_left, m.status, m.prev_for_days, m.prev_lasted_days, m.as_of
    from private.m_stock_lots(p_org, private.stock_scope(p_org, p_branch), p_now) m
    join public.ingredients i on i.org_id = p_org and i.id = m.ingredient_id
   order by case m.status when 'running' then 0 else 1 end, m.ends_on, i.name
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. stock.estimate
-- ---------------------------------------------------------------------------------------------
-- For each item never counted at a branch, from the first day it was bought (or arrived) there up to
-- p_date: what came in (purchases + transfers in − transfers out), what went out (usage.theoretical +
-- waste.logged), and the difference — as if the shelf was empty before that first day.
create function private.m_stock_estimate(p_org uuid, p_branches uuid[], p_date date)
returns table (branch_id uuid, ingredient_id uuid, start_on date, in_qty numeric, used_qty numeric, est_qty numeric)
language sql stable security definer set search_path = '' as $$
  with counted as (
    select distinct sc.branch_id, l.ingredient_id
      from public.stock_counts sc
      join public.stock_count_lines l on l.org_id = sc.org_id and l.stock_count_id = sc.id
     where sc.org_id = p_org and sc.branch_id = any (p_branches) and sc.status = 'submitted'
       and sc.counted_on <= p_date
  ), arrivals as (
    select p.branch_id, pl.ingredient_id, p.purchased_on as d
      from public.purchase_lines pl
      join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
     where pl.org_id = p_org and p.branch_id = any (p_branches) and p.status = 'confirmed'
       and p.purchased_on <= p_date
    union all
    select t.to_branch_id, tl.ingredient_id, t.received_on
      from public.transfers t
      join public.transfer_lines tl on tl.org_id = t.org_id and tl.transfer_id = t.id
     where t.org_id = p_org and t.to_branch_id = any (p_branches) and t.status in ('received', 'disputed')
       and t.received_on <= p_date
  ), firsts as (
    select a.branch_id, a.ingredient_id, min(a.d) as start_on
      from arrivals a
     where not exists (select 1 from counted c where c.branch_id = a.branch_id and c.ingredient_id = a.ingredient_id)
     group by 1, 2
  ), moves as (
    select f.branch_id, f.ingredient_id,
           coalesce(sum(m.qty) filter (where m.kind in ('purchase', 'transfer_in')), 0)
             - coalesce(sum(m.qty) filter (where m.kind = 'transfer_out'), 0) as in_qty,
           coalesce(sum(m.qty) filter (where m.kind in ('usage', 'waste')), 0) as used_qty
      from firsts f
      join private.m_stock_moves(p_org, p_branches, coalesce((select min(x.start_on) from firsts x), p_date), p_date) m
        on m.branch_id = f.branch_id and m.ingredient_id = f.ingredient_id and m.business_date >= f.start_on
     group by 1, 2
  )
  select f.branch_id, f.ingredient_id, f.start_on, coalesce(m.in_qty, 0), coalesce(m.used_qty, 0),
         coalesce(m.in_qty, 0) - coalesce(m.used_qty, 0)
    from firsts f
    left join moves m on m.branch_id = f.branch_id and m.ingredient_id = f.ingredient_id
$$;
revoke execute on function private.m_stock_estimate(uuid, uuid[], date) from public, anon, authenticated;

-- metric_stock_status: as before for counted items; never-counted items that were bought get the
-- estimate as their stock (estimated = true). Plus, for every row: since when "used" is counted
-- (the day after the last count, or the first day bought), how much was used since then, and the
-- average daily use that days_of_cover and the band are worked out from.
drop function public.metric_stock_status(uuid, uuid, timestamptz);
create function public.metric_stock_status(p_org uuid, p_branch uuid, p_now timestamptz)
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
             case when s.last_count_date is not null then s.last_count_date + 1 else e.start_on end as since_on,
             case when s.last_count_date is not null then coalesce(s.usage_qty, 0) + coalesce(s.waste_qty, 0)
                  else e.used_qty end as used_since,
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
           v_date, w.estimated, w.since_on, w.used_since,
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

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('metric_stock_lots', 'metric_stock_status')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

comment on function public.metric_stock_lots is
  'stock.lot: per item, the latest lot bought, the days it was for and days left (quantities; stock roles). ADR 0029.';
comment on function public.metric_stock_status is
  'stock.theoretical, stock.estimate (never counted: from the first purchase, estimated = true), used since, average daily use and stock.days_of_cover per ingredient (quantities; stock roles). Phase 5, ADR 0030.';
