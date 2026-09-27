-- Phase 2 (ADR 0015): the metrics layer, flash P&L and the zero-input leak detectors.
--
-- Every figure in METRICS.md that Phase 2 needs has exactly one implementation here, as a
-- private.m_* function. Public wrappers (public.metric_*) only decide who may ask: branch access for
-- sales figures, can_see_money() for anything with cost, profit, commission or a finding's ৳ impact
-- (ADR 0007). The clock is always a parameter, never now(), so windows are testable (ADR 0006).
--
-- Detectors are SQL too, so the nightly job and the CI golden check against the seed run the same code.

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------
-- Per-org overrides of detector thresholds, merged over private.detector_defaults().
alter table public.org_settings add column detector_config jsonb not null default '{}'::jsonb;

-- A finding is about something: a staff member, a channel. subject_key makes re-running a detector
-- for the same period an update, not a duplicate.
alter table public.findings add column subject_key text not null default '';
alter table public.findings add column subject jsonb not null default '{}'::jsonb;
create unique index findings_dedupe_idx on public.findings
  (org_id, type, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), subject_key, period_start, period_end);

-- The detectors join voids/discounts/refunds to their order and group by staff.
create index if not exists voids_order_idx on public.voids (org_id, order_id);
create index if not exists discounts_order_idx on public.discounts (org_id, order_id);
create index if not exists refunds_order_idx on public.refunds (org_id, order_id);
create index if not exists orders_branch_date_staff_idx on public.orders (org_id, branch_id, business_date, staff_id);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
-- amount × bps, rounded half away from zero — the SQL twin of mulBps() in src/lib/money.
create function private.mul_bps(p_amount bigint, p_bps integer) returns bigint
language sql immutable parallel safe set search_path = '' as $$
  select round(p_amount::numeric * p_bps / 10000)::bigint
$$;

-- The branches a caller may read metrics for: one branch (checked) or every branch they can reach.
create function private.metric_scope(p_org uuid, p_branch uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid[];
begin
  if p_branch is not null then
    if not private.can_access_branch(p_org, p_branch) then
      raise exception 'not allowed' using errcode = 'insufficient_privilege';
    end if;
    return array[p_branch];
  end if;
  select coalesce(array_agg(b.id order by b.name), '{}') into v
    from public.branches b
   where b.org_id = p_org and private.can_access_branch(p_org, b.id);
  if cardinality(v) = 0 then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return v;
end $$;

create function private.require_money(p_org uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_see_money(p_org) then
    raise exception 'cost and profit figures are for the owner and accountant' using errcode = 'insufficient_privilege';
  end if;
end $$;

create function private.org_cutoff(p_org uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select default_cutoff_minutes from public.org_settings where org_id = p_org), 240)
$$;

-- METRICS.md "Item velocity" windows, resolved against an injected now. Rolling windows use timestamps
-- (last_2h); everything else uses business dates in Asia/Dhaka with the org's cutoff.
create function private.window_bounds(
  p_org uuid, p_window text, p_now timestamptz, p_from date default null, p_to date default null,
  out from_date date, out to_date date, out from_ts timestamptz, out to_ts timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
  v_week_start integer := coalesce((select week_start from public.org_settings where org_id = p_org), 6);
begin
  case p_window
    when 'last_2h' then
      from_date := private.business_date(p_now - interval '2 hours', private.org_cutoff(p_org));
      to_date := v_today; from_ts := p_now - interval '2 hours'; to_ts := p_now;
    when 'today' then from_date := v_today; to_date := v_today;
    when 'yesterday' then from_date := v_today - 1; to_date := v_today - 1;
    when 'last_7d' then from_date := v_today - 6; to_date := v_today;
    when 'week_to_date' then
      from_date := v_today - ((extract(dow from v_today)::integer - v_week_start + 7) % 7);
      to_date := v_today;
    when 'month_to_date' then from_date := date_trunc('month', v_today)::date; to_date := v_today;
    when 'last_30d' then from_date := v_today - 29; to_date := v_today;
    when 'custom' then
      if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
        raise exception 'a custom window needs from <= to, at most a year apart' using errcode = 'invalid_parameter_value';
      end if;
      from_date := p_from; to_date := p_to;
    else
      raise exception 'unknown window %', p_window using errcode = 'invalid_parameter_value';
  end case;
  -- Business-date windows stop at now: nothing "today" can have happened after it.
  if to_ts is null then to_ts := p_now; end if;
end $$;

-- The org's daypart for a moment (org_settings.dayparts; a part may wrap midnight, e.g. late 23–04).
create function private.daypart_of(p_ts timestamptz, p_dayparts jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce((
    select d ->> 'key'
      from jsonb_array_elements(p_dayparts) d
     where case
             when (d ->> 'start')::time <= (d ->> 'end')::time
               then (p_ts at time zone 'Asia/Dhaka')::time >= (d ->> 'start')::time
                and (p_ts at time zone 'Asia/Dhaka')::time < (d ->> 'end')::time
             else (p_ts at time zone 'Asia/Dhaka')::time >= (d ->> 'start')::time
                or (p_ts at time zone 'Asia/Dhaka')::time < (d ->> 'end')::time
           end
     limit 1), 'other')
$$;

-- ---------------------------------------------------------------------------------------------
-- Sales (METRICS.md "Sales"). Completed orders, by business_date. Refunds reduce sales.net by their
-- VAT-exclusive share of the refunded order (ADR 0015 §1), attributed to the refund's business date.
-- One row per branch plus a total row (branch_id null).
-- ---------------------------------------------------------------------------------------------
create function private.m_sales(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (
  branch_id uuid, orders_completed bigint, orders_cancelled bigint, gross_poisha bigint,
  discounts_poisha bigint, refunds_poisha bigint, net_poisha bigint, vat_poisha bigint,
  service_charge_poisha bigint, total_poisha bigint, covers bigint, covers_orders bigint, aov_poisha bigint
) language sql stable security definer set search_path = '' as $$
  with o as (
    select o.branch_id,
           count(*) filter (where o.order_status = 'completed') as done,
           count(*) filter (where o.order_status = 'cancelled') as cancelled,
           coalesce(sum(o.net_before_discount_poisha) filter (where o.order_status = 'completed'), 0) as gross,
           coalesce(sum(o.discount_net_poisha) filter (where o.order_status = 'completed'), 0) as disc,
           coalesce(sum(o.net_poisha) filter (where o.order_status = 'completed'), 0) as net,
           coalesce(sum(o.vat_poisha) filter (where o.order_status = 'completed'), 0) as vat,
           coalesce(sum(o.service_charge_poisha) filter (where o.order_status = 'completed'), 0) as svc,
           coalesce(sum(o.total_poisha) filter (where o.order_status = 'completed'), 0) as total,
           coalesce(sum(o.guests) filter (where o.order_status = 'completed'), 0) as covers,
           count(o.guests) filter (where o.order_status = 'completed') as covers_orders
      from public.orders o
     where o.org_id = p_org and o.branch_id = any (p_branches) and o.business_date between p_from and p_to
     group by o.branch_id
  ), r as (
    select r.branch_id,
           coalesce(sum(case when ord.total_poisha > 0
                             then round(r.amount_poisha::numeric * ord.net_poisha / ord.total_poisha)
                             else 0 end), 0)::bigint as refunded_net
      from public.refunds r
      join public.orders ord on ord.org_id = r.org_id and ord.id = r.order_id
     where r.org_id = p_org and r.branch_id = any (p_branches)
       and private.business_date(r.created_at, private.org_cutoff(p_org)) between p_from and p_to
     group by r.branch_id
  ), b as (
    select unnest(p_branches) as branch_id
  ), per as (
    select b.branch_id,
           coalesce(o.done, 0) as done, coalesce(o.cancelled, 0) as cancelled,
           coalesce(o.gross, 0) as gross, coalesce(o.disc, 0) as disc, coalesce(r.refunded_net, 0) as refunds,
           coalesce(o.net, 0) - coalesce(r.refunded_net, 0) as net,
           coalesce(o.vat, 0) as vat, coalesce(o.svc, 0) as svc, coalesce(o.total, 0) as total,
           coalesce(o.covers, 0) as covers, coalesce(o.covers_orders, 0) as covers_orders
      from b left join o on o.branch_id = b.branch_id left join r on r.branch_id = b.branch_id
  )
  select g.branch_id, g.done, g.cancelled, g.gross, g.disc, g.refunds, g.net, g.vat, g.svc, g.total,
         g.covers, g.covers_orders,
         case when g.done > 0 then round(g.net::numeric / g.done)::bigint end
    from (
      select per.branch_id, sum(done)::bigint as done, sum(cancelled)::bigint as cancelled,
             sum(gross)::bigint as gross, sum(disc)::bigint as disc, sum(refunds)::bigint as refunds,
             sum(net)::bigint as net, sum(vat)::bigint as vat, sum(svc)::bigint as svc,
             sum(total)::bigint as total, sum(covers)::bigint as covers,
             sum(covers_orders)::bigint as covers_orders
        from per
       group by grouping sets ((per.branch_id), ())
    ) g
   order by g.branch_id nulls last
$$;

-- sales.by_channel / by_daypart / by_payment_method / by_hour: splits of sales.net (completed orders).
-- A split-tender order's net is shared across its methods in proportion to what each paid (ADR 0015 §2).
create function private.m_sales_split(p_org uuid, p_branches uuid[], p_from date, p_to date, p_dimension text)
returns table (key text, label text, orders bigint, net_poisha bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dayparts jsonb := coalesce((select dayparts from public.org_settings where org_id = p_org), '[]'::jsonb);
begin
  if p_dimension = 'channel' then
    return query
      select coalesce(c.kind::text, 'unknown'), coalesce(c.name, ''), count(*)::bigint, sum(o.net_poisha)::bigint
        from public.orders o left join public.channels c on c.org_id = o.org_id and c.id = o.channel_id
       where o.org_id = p_org and o.branch_id = any (p_branches) and o.business_date between p_from and p_to
         and o.order_status = 'completed'
       group by c.kind, c.name order by 4 desc;
  elsif p_dimension in ('daypart', 'hour') then
    return query
      select x.k, x.k, count(*)::bigint, sum(x.net)::bigint
        from (
          select case when p_dimension = 'daypart' then private.daypart_of(o.placed_at, v_dayparts)
                      else lpad(extract(hour from o.placed_at at time zone 'Asia/Dhaka')::integer::text, 2, '0') end as k,
                 o.net_poisha as net
            from public.orders o
           where o.org_id = p_org and o.branch_id = any (p_branches) and o.business_date between p_from and p_to
             and o.order_status = 'completed'
        ) x
       group by x.k
       order by case when p_dimension = 'hour' then x.k end, sum(x.net) desc;
  elsif p_dimension = 'payment_method' then
    return query
      with paid as (
        select o.id, o.net_poisha, p.method, p.amount_poisha,
               sum(p.amount_poisha) over (partition by o.id) as order_paid
          from public.orders o join public.payments p on p.org_id = o.org_id and p.order_id = o.id
         where o.org_id = p_org and o.branch_id = any (p_branches) and o.business_date between p_from and p_to
           and o.order_status = 'completed'
      )
      select paid.method::text, paid.method::text, count(distinct paid.id)::bigint,
             sum(round(paid.net_poisha::numeric * paid.amount_poisha / nullif(paid.order_paid, 0)))::bigint
        from paid group by paid.method order by 4 desc;
  else
    raise exception 'unknown dimension %', p_dimension using errcode = 'invalid_parameter_value';
  end if;
end $$;

-- items.qty_sold (METRICS.md "Item velocity"): active lines of orders that were not cancelled, in the
-- window. Counts orders still in the kitchen too — "how many kebabs in the last 2 hours" means rung up.
create function private.m_item_qty(
  p_org uuid, p_branches uuid[], p_from_date date, p_to_date date, p_from_ts timestamptz, p_to_ts timestamptz,
  p_item uuid default null, p_channel uuid default null, p_daypart text default null
) returns table (menu_item_id uuid, name text, qty bigint, net_poisha bigint)
language sql stable security definer set search_path = '' as $$
  select oi.menu_item_id, coalesce(mi.name, min(oi.name_snapshot)), sum(oi.quantity)::bigint, sum(oi.net_poisha)::bigint
    from public.order_items oi
    join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
    left join public.menu_items mi on mi.org_id = oi.org_id and mi.id = oi.menu_item_id
   where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
     and o.order_status <> 'cancelled'
     and o.business_date between p_from_date and p_to_date
     and (p_from_ts is null or o.placed_at > p_from_ts)
     and (p_to_ts is null or o.placed_at <= p_to_ts)
     and (p_item is null or oi.menu_item_id = p_item)
     and (p_channel is null or o.channel_id = p_channel)
     and (p_daypart is null or private.daypart_of(o.placed_at,
            (select s.dayparts from public.org_settings s where s.org_id = p_org)) = p_daypart)
   group by oi.menu_item_id, mi.name
   order by 3 desc, 2
$$;

-- Pace: today's completed net so far against the same weekday of the last four weeks, up to the same
-- time of day. Drives the branch red/amber/green (ADR 0015 §4). Sales only, so managers see it too.
create function private.m_pace(p_org uuid, p_branches uuid[], p_now timestamptz)
returns table (branch_id uuid, today_net_poisha bigint, typical_net_poisha bigint, pace_bps integer, rag text)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select private.org_cutoff(p_org) as cutoff,
           private.business_date(p_now, private.org_cutoff(p_org)) as today
  ), elapsed as (
    -- Time since this business day started, applied to earlier days.
    select p_now - ((cfg.today::timestamp + make_interval(mins => cfg.cutoff)) at time zone 'Asia/Dhaka') as since_open,
           cfg.today, cfg.cutoff
      from cfg
  ), b as (select unnest(p_branches) as branch_id)
  select b.branch_id, t.net, h.avg_net,
         case when coalesce(h.avg_net, 0) > 0 then round(t.net * 10000.0 / h.avg_net)::integer end,
         case when coalesce(h.avg_net, 0) = 0 then 'none'
              when t.net * 100 >= h.avg_net * 95 then 'green'
              when t.net * 100 >= h.avg_net * 80 then 'amber'
              else 'red' end
    from b cross join elapsed e
    cross join lateral (
      select coalesce(sum(o.net_poisha), 0)::bigint as net from public.orders o
       where o.org_id = p_org and o.branch_id = b.branch_id and o.business_date = e.today
         and o.order_status = 'completed' and o.placed_at <= p_now
    ) t
    cross join lateral (
      select round(avg(d.net))::bigint as avg_net from (
        select k, (
          select coalesce(sum(o.net_poisha), 0) from public.orders o
           where o.org_id = p_org and o.branch_id = b.branch_id and o.business_date = e.today - 7 * k
             and o.order_status = 'completed'
             and o.placed_at <= ((e.today - 7 * k)::timestamp + make_interval(mins => e.cutoff)) at time zone 'Asia/Dhaka' + e.since_open
        ) as net
        from generate_series(1, 4) k
      ) d
      -- A closed day (Eid) is not "typical"; average only the days that traded.
      where exists (select 1 from public.orders o2 where o2.org_id = p_org and o2.branch_id = b.branch_id
                     and o2.business_date = e.today - 7 * d.k and o2.order_status = 'completed')
    ) h
$$;

-- ---------------------------------------------------------------------------------------------
-- Costs (METRICS.md "Costs & P&L"). Money-gated through the wrappers.
-- commission.value is rounded once per (branch, channel, period), not per order (ADR 0012 §7).
-- ---------------------------------------------------------------------------------------------
create function private.m_commission(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (
  branch_id uuid, channel_id uuid, channel_kind text, channel_name text, orders bigint, net_poisha bigint,
  commission_bps integer, commission_poisha bigint, fixed_fees_poisha bigint, funded_discount_poisha bigint,
  packaging_poisha bigint, total_poisha bigint
) language sql stable security definer set search_path = '' as $$
  with sales as (
    select o.branch_id, o.channel_id, count(*)::bigint as orders, sum(o.net_poisha)::bigint as net
      from public.orders o
     where o.org_id = p_org and o.branch_id = any (p_branches) and o.business_date between p_from and p_to
       and o.order_status = 'completed' and o.channel_id is not null
     group by o.branch_id, o.channel_id
  )
  select s.branch_id, s.channel_id, c.kind::text, c.name, s.orders, s.net,
         coalesce(cc.commission_bps, 0),
         private.mul_bps(s.net, coalesce(cc.commission_bps, 0)),
         coalesce(cc.fixed_fee_poisha, 0) * s.orders,
         private.mul_bps(s.net, coalesce(cc.restaurant_funded_discount_bps, 0)),
         coalesce(cc.packaging_poisha, 0) * s.orders,
         private.mul_bps(s.net, coalesce(cc.commission_bps, 0)) + coalesce(cc.fixed_fee_poisha, 0) * s.orders
           + private.mul_bps(s.net, coalesce(cc.restaurant_funded_discount_bps, 0))
    from sales s
    join public.channels c on c.org_id = p_org and c.id = s.channel_id
    left join lateral (
      select * from public.channel_commissions x
       where x.org_id = p_org and x.channel_id = s.channel_id and x.effective_from <= p_to
       order by x.effective_from desc limit 1
    ) cc on true
   order by s.branch_id, 12 desc
$$;

-- labour.daily and fixed.daily for one business day: monthly amounts ÷ days in that month, rounded once
-- per branch. Org-level fixed costs (no branch) belong to the org total only (ADR 0015 §3).
create function private.m_daily_overheads(p_org uuid, p_branches uuid[], p_date date)
returns table (branch_id uuid, labour_daily_poisha bigint, fixed_daily_poisha bigint)
language sql stable security definer set search_path = '' as $$
  with d as (
    select date_trunc('month', p_date)::date as month,
           extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::integer as days
  ), b as (select unnest(p_branches) as branch_id)
  select b.branch_id,
         round(coalesce((select sum(s.salary_poisha + s.allowances_poisha) from public.salary_entries s
                          where s.org_id = p_org and s.branch_id = b.branch_id and s.month = d.month), 0)::numeric / d.days)::bigint,
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

-- pnl.flash for one business day, per branch and in total. Until recipes exist (P3), COGS is the
-- owner-entered assumed_food_cost_bps × sales.net and is reported as cogs_basis = 'assumed' so the UI can
-- label it (CLAUDE.md #1). Break-even uses the trailing 28 days' variable ratio.
create function private.m_flash_pnl(p_org uuid, p_branches uuid[], p_date date)
returns table (
  branch_id uuid, net_poisha bigint, cogs_poisha bigint, cogs_basis text, assumed_food_cost_bps integer,
  commission_poisha bigint, labour_daily_poisha bigint, fixed_daily_poisha bigint,
  estimated_profit_poisha bigint, variable_ratio_bps integer, breakeven_sales_poisha bigint,
  breakeven_remaining_poisha bigint
) language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce((select assumed_food_cost_bps from public.org_cost_settings where org_id = p_org), 0) as food_bps
  ), today as (
    select s.branch_id, s.net_poisha as net from private.m_sales(p_org, p_branches, p_date, p_date) s
  ), comm as (
    select c.branch_id, sum(c.total_poisha)::bigint as total
      from private.m_commission(p_org, p_branches, p_date, p_date) c group by grouping sets ((c.branch_id), ())
  ), trail_sales as (
    select s.branch_id, s.net_poisha as net from private.m_sales(p_org, p_branches, p_date - 28, p_date - 1) s
  ), trail_comm as (
    select c.branch_id, sum(c.total_poisha)::bigint as total
      from private.m_commission(p_org, p_branches, p_date - 28, p_date - 1) c group by grouping sets ((c.branch_id), ())
  ), ovh as (
    select o.branch_id, o.labour_daily_poisha as labour, o.fixed_daily_poisha as fixed
      from private.m_daily_overheads(p_org, p_branches, p_date) o
  ), ovh_total as (
    select null::uuid as branch_id, sum(labour)::bigint as labour, sum(fixed)::bigint as fixed from ovh
  ), ovh_all as (
    select * from ovh where branch_id is not null union all select * from ovh_total
  ), rows_ as (
    select t.branch_id, t.net,
           private.mul_bps(t.net, cfg.food_bps) as cogs,
           coalesce(cm.total, 0) as commission,
           coalesce(ov.labour, 0) as labour, coalesce(ov.fixed, 0) as fixed,
           -- Variable costs as a share of sales over the last 28 days (assumed COGS + commission).
           case when coalesce(ts.net, 0) > 0
                then least(9999, cfg.food_bps + round(coalesce(tc.total, 0) * 10000.0 / ts.net)::integer)
                else cfg.food_bps end as var_bps,
           cfg.food_bps
      from today t cross join cfg
      left join comm cm on cm.branch_id is not distinct from t.branch_id
      left join trail_sales ts on ts.branch_id is not distinct from t.branch_id
      left join trail_comm tc on tc.branch_id is not distinct from t.branch_id
      left join ovh_all ov on ov.branch_id is not distinct from t.branch_id
  )
  select r.branch_id, r.net, r.cogs, 'assumed', r.food_bps, r.commission, r.labour, r.fixed,
         r.net - r.cogs - r.commission - r.labour - r.fixed,
         r.var_bps,
         round((r.labour + r.fixed) * 10000.0 / (10000 - r.var_bps))::bigint,
         greatest(0, round((r.labour + r.fixed) * 10000.0 / (10000 - r.var_bps))::bigint - r.net)
    from rows_ r
   order by r.branch_id nulls last
$$;

-- ---------------------------------------------------------------------------------------------
-- POS exceptions per staff member (METRICS.md "POS exceptions"). Every event is attributed to the
-- business date of its order, so a period's counts and its orders line up.
-- ---------------------------------------------------------------------------------------------
create function private.m_staff_exceptions(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (
  branch_id uuid, staff_id uuid, staff_name text, orders bigint, completed_net_poisha bigint,
  void_after_kot_count bigint, void_after_kot_poisha bigint, void_after_payment_count bigint,
  discount_count bigint, discount_poisha bigint, discount_no_reason_count bigint,
  refund_count bigint, refund_poisha bigint
) language sql stable security definer set search_path = '' as $$
  with ord as (
    select o.id, o.branch_id, o.staff_id, o.order_status, o.net_poisha
      from public.orders o
     where o.org_id = p_org and o.branch_id = any (p_branches) and o.business_date between p_from and p_to
  ), staff_orders as (
    select ord.branch_id, ord.staff_id, count(*)::bigint as orders,
           coalesce(sum(ord.net_poisha) filter (where ord.order_status = 'completed'), 0)::bigint as net
      from ord where ord.staff_id is not null group by ord.branch_id, ord.staff_id
  ), v as (
    select ord.branch_id, x.voided_by_staff_id as staff_id,
           count(*) filter (where x.after_kot)::bigint as kot_n,
           coalesce(sum(x.value_poisha) filter (where x.after_kot), 0)::bigint as kot_v,
           count(*) filter (where x.after_payment)::bigint as paid_n
      from public.voids x join ord on ord.id = x.order_id
     where x.org_id = p_org and x.voided_by_staff_id is not null
     group by ord.branch_id, x.voided_by_staff_id
  ), d as (
    select ord.branch_id, x.applied_by_staff_id as staff_id, count(*)::bigint as n,
           sum(x.amount_poisha)::bigint as v, count(*) filter (where x.reason_code_id is null)::bigint as no_reason
      from public.discounts x join ord on ord.id = x.order_id
     where x.org_id = p_org and x.applied_by_staff_id is not null
     group by ord.branch_id, x.applied_by_staff_id
  ), r as (
    select ord.branch_id, x.refunded_by_staff_id as staff_id, count(*)::bigint as n, sum(x.amount_poisha)::bigint as v
      from public.refunds x join ord on ord.id = x.order_id
     where x.org_id = p_org and x.refunded_by_staff_id is not null
     group by ord.branch_id, x.refunded_by_staff_id
  ), keys as (
    select branch_id, staff_id from staff_orders union select branch_id, staff_id from v
    union select branch_id, staff_id from d union select branch_id, staff_id from r
  )
  select k.branch_id, k.staff_id, st.display_name,
         coalesce(so.orders, 0), coalesce(so.net, 0),
         coalesce(v.kot_n, 0), coalesce(v.kot_v, 0), coalesce(v.paid_n, 0),
         coalesce(d.n, 0), coalesce(d.v, 0), coalesce(d.no_reason, 0),
         coalesce(r.n, 0), coalesce(r.v, 0)
    from keys k
    left join public.staff st on st.org_id = p_org and st.id = k.staff_id
    left join staff_orders so on so.branch_id = k.branch_id and so.staff_id = k.staff_id
    left join v on v.branch_id = k.branch_id and v.staff_id = k.staff_id
    left join d on d.branch_id = k.branch_id and d.staff_id = k.staff_id
    left join r on r.branch_id = k.branch_id and r.staff_id = k.staff_id
   order by k.branch_id, st.display_name
$$;

-- ---------------------------------------------------------------------------------------------
-- Detectors (METRICS.md "Findings"). Thresholds are config: defaults here, org overrides in
-- org_settings.detector_config. Each detector returns candidate findings and never writes.
-- ---------------------------------------------------------------------------------------------
create function private.detector_defaults() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    -- A staff member vs their peers at the same branch over the same period.
    'peer_min_ratio_x100', 200,       -- at least 2× the peers' value per order
    'peer_min_z_x100', 300,           -- and a Poisson z-score of at least 3 on the count
    'peer_min_count', 5,              -- and at least 5 events
    'min_impact_poisha', 50000,       -- and at least ৳500 of excess
    'cash_share_min_orders', 60,
    'cash_share_min_gap_bps', 1500,   -- 15 percentage points above the daypart-normalised expectation
    'cash_share_min_z_x100', 400,
    'over_short_min_shortage_poisha', 100000,  -- ৳1,000 net short
    'over_short_min_short_shifts', 3,
    'commission_min_bps', 1500        -- channels costing 15%+ of their sales
  )
$$;

create function private.detector_config(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.detector_defaults()
         || coalesce((select detector_config from public.org_settings where org_id = p_org), '{}'::jsonb)
$$;

-- Void, discount and refund anomalies: one rule, three event kinds (METRICS.md: z-score AND floor).
-- Impact = excess over the peers' value per order × this staff member's orders (seed manifest's
-- excessOverBaseline — the same definition the golden check uses).
create function private.detect_staff_anomalies(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (select private.detector_config(p_org) as c),
  branches as (select array_agg(b.id) as ids from public.branches b where b.org_id = p_org),
  ex as (select * from private.m_staff_exceptions(p_org, (select ids from branches), p_from, p_to)),
  kinds as (
    select 'void.after_kot'::text as type, e.branch_id, e.staff_id, e.staff_name, e.orders,
           e.void_after_kot_count as n, e.void_after_kot_poisha as v, 0::bigint as no_reason
      from ex e
    union all
    select 'discount.rate', e.branch_id, e.staff_id, e.staff_name, e.orders,
           e.discount_count, e.discount_poisha, e.discount_no_reason_count
      from ex e
    union all
    select 'refund.rate', e.branch_id, e.staff_id, e.staff_name, e.orders, e.refund_count, e.refund_poisha, 0
      from ex e
  ),
  peers as (
    select k.*,
           sum(k.orders) over w - k.orders as peer_orders,
           sum(k.n) over w - k.n as peer_n,
           sum(k.v) over w - k.v as peer_v
      from kinds k
    window w as (partition by k.type, k.branch_id)
  ),
  scored as (
    select p.*,
           case when p.peer_orders > 0 then p.peer_n::numeric * p.orders / p.peer_orders end as expected_n,
           case when p.peer_orders > 0 then round(p.v - p.peer_v::numeric * p.orders / p.peer_orders)::bigint end as excess
      from peers p
     where p.orders > 0
  ),
  judged as (
    select s.*,
           -- Peers with no events at all still give a baseline: a floor of half an event keeps z finite.
           (s.n - greatest(coalesce(s.expected_n, 0), 0.5)) / sqrt(greatest(coalesce(s.expected_n, 0), 0.5)) as z,
           case when s.peer_v > 0 and s.peer_orders > 0 and s.orders > 0
                then round(100.0 * (s.v::numeric / s.orders) / (s.peer_v::numeric / s.peer_orders))::integer end as ratio_x100
      from scored s
  )
  select j.type, j.branch_id, j.staff_id::text,
         jsonb_build_object('staff_id', j.staff_id, 'staff_name', j.staff_name),
         j.excess,
         (case when j.z >= 5 and j.n >= 20 then 'high' when j.z >= 3 then 'medium' else 'low' end)::public.confidence_level,
         jsonb_build_array(case j.type when 'void.after_kot' then 'void.after_kot.count'
                                       when 'discount.rate' then 'discount.rate' else 'refund.rate' end),
         jsonb_build_object(
           'orders', j.orders, 'count', j.n, 'value_poisha', j.v, 'without_reason', j.no_reason,
           'peer_orders', j.peer_orders, 'peer_count', j.peer_n, 'peer_value_poisha', j.peer_v,
           'expected_count', round(j.expected_n, 1), 'z_x100', round(j.z * 100), 'ratio_x100', j.ratio_x100),
         case j.type
           when 'void.after_kot' then '["review_voids", "require_manager_on_cash_voids", "talk_to_staff"]'::jsonb
           when 'discount.rate' then '["review_discounts", "require_reason_codes", "set_discount_limit"]'::jsonb
           else '["review_refunds", "talk_to_staff"]'::jsonb end
    from judged j cross join cfg
   where j.peer_orders > 0
     and j.n >= (cfg.c ->> 'peer_min_count')::integer
     and j.z * 100 >= (cfg.c ->> 'peer_min_z_x100')::integer
     and (j.ratio_x100 is null or j.ratio_x100 >= (cfg.c ->> 'peer_min_ratio_x100')::integer)
     and j.excess >= (cfg.c ->> 'min_impact_poisha')::bigint
$$;

-- cash.share by cashier, normalised by daypart: a late-shift cashier legitimately takes more cash
-- (METRICS.md open question 7). Expected share = Σ over dayparts (their orders × branch cash share).
create function private.detect_cash_share(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (select private.detector_config(p_org) as c,
                      coalesce((select dayparts from public.org_settings where org_id = p_org), '[]'::jsonb) as dp),
  o as (
    select o.branch_id, o.staff_id, private.daypart_of(o.placed_at, cfg.dp) as part, o.total_poisha,
           exists (select 1 from public.payments p where p.org_id = o.org_id and p.order_id = o.id and p.method = 'cash') as is_cash
      from public.orders o cross join cfg
     where o.org_id = p_org and o.business_date between p_from and p_to and o.order_status = 'completed'
       and o.staff_id is not null
  ),
  part_rate as (
    select branch_id, part, avg(case when is_cash then 1.0 else 0.0 end) as p from o group by branch_id, part
  ),
  staff as (
    select o.branch_id, o.staff_id, count(*) as n,
           sum(case when o.is_cash then 1 else 0 end) as cash_n,
           sum(pr.p) as expected_n,
           sum(pr.p * (1 - pr.p)) as var_n,
           avg(o.total_poisha) as avg_ticket
      from o join part_rate pr on pr.branch_id = o.branch_id and pr.part = o.part
     group by o.branch_id, o.staff_id
  )
  select 'cash.share', s.branch_id, s.staff_id::text,
         jsonb_build_object('staff_id', s.staff_id, 'staff_name', st.display_name),
         round((s.cash_n - s.expected_n) * s.avg_ticket)::bigint,
         'low'::public.confidence_level,
         '["cash.share"]'::jsonb,
         jsonb_build_object('orders', s.n, 'cash_orders', s.cash_n, 'expected_cash_orders', round(s.expected_n, 1),
           'share_bps', round(s.cash_n * 10000.0 / s.n), 'expected_share_bps', round(s.expected_n * 10000.0 / s.n)),
         '["check_digital_payments_offered", "spot_count_drawer"]'::jsonb
    from staff s cross join cfg
    left join public.staff st on st.org_id = p_org and st.id = s.staff_id
   where s.n >= (cfg.c ->> 'cash_share_min_orders')::integer
     and s.var_n > 0
     and (s.cash_n - s.expected_n) * 10000.0 / s.n >= (cfg.c ->> 'cash_share_min_gap_bps')::integer
     and (s.cash_n - s.expected_n) / sqrt(s.var_n) * 100 >= (cfg.c ->> 'cash_share_min_z_x100')::integer
$$;

-- cash.over_short per shift, summed by the person who closed the drawer.
create function private.detect_over_short(p_org uuid, p_from date, p_to date)
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
   where -s.net_over_short >= (cfg.c ->> 'over_short_min_shortage_poisha')::bigint
     and s.short_shifts >= (cfg.c ->> 'over_short_min_short_shifts')::integer
$$;

-- Commission drag: what each delivery platform cost this period (commission + fees + restaurant-funded
-- discounts). A structural cost, not an anomaly; reported monthly (ADR 0015 §5).
create function private.detect_commission_drag(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (select private.detector_config(p_org) as c),
  branches as (select array_agg(b.id) as ids from public.branches b where b.org_id = p_org)
  select 'commission.drag', m.branch_id, m.channel_id::text,
         jsonb_build_object('channel_id', m.channel_id, 'channel_name', m.channel_name, 'channel_kind', m.channel_kind),
         m.total_poisha,
         'high'::public.confidence_level,
         '["commission.value", "sales.by_channel"]'::jsonb,
         jsonb_build_object('orders', m.orders, 'net_poisha', m.net_poisha, 'commission_bps', m.commission_bps,
           'commission_poisha', m.commission_poisha, 'fixed_fees_poisha', m.fixed_fees_poisha,
           'funded_discount_poisha', m.funded_discount_poisha,
           'cost_share_bps', case when m.net_poisha > 0 then round(m.total_poisha * 10000.0 / m.net_poisha) end),
         '["raise_platform_prices", "push_own_delivery", "review_combo_margins"]'::jsonb
    from private.m_commission(p_org, (select ids from branches), p_from, p_to) m cross join cfg
   where m.net_poisha > 0 and m.total_poisha > 0
     and m.total_poisha * 10000 >= m.net_poisha * (cfg.c ->> 'commission_min_bps')::integer
$$;

create function private.detect_all(p_org uuid, p_from date, p_to date, p_kinds text[])
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
$$;

-- Persist: upsert by (org, type, branch, subject, period); a re-run refreshes the numbers and evidence
-- but never resets what the owner decided (status, reason, snooze).
create function private.save_findings(p_org uuid, p_from date, p_to date, p_kinds text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  f record;
  v_id uuid;
  v_n integer := 0;
begin
  for f in select * from private.detect_all(p_org, p_from, p_to, p_kinds) loop
    insert into public.findings (org_id, branch_id, type, period_start, period_end, impact_poisha, confidence,
      detector_version, metric_refs, suggested_actions, subject_key, subject)
    values (p_org, f.branch_id, f.type, p_from, p_to, f.impact_poisha, f.confidence, 'p2.1',
      f.metric_refs, f.suggested_actions, f.subject_key, f.subject)
    on conflict (org_id, type, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), subject_key, period_start, period_end)
    do update set impact_poisha = excluded.impact_poisha, confidence = excluded.confidence,
                  detector_version = excluded.detector_version, metric_refs = excluded.metric_refs,
                  suggested_actions = excluded.suggested_actions, subject = excluded.subject
    returning id into v_id;
    delete from public.finding_evidence where org_id = p_org and finding_id = v_id;
    insert into public.finding_evidence (org_id, finding_id, evidence_type, summary)
    values (p_org, v_id, f.type, f.evidence);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The day close (ADR 0004 / 0015 §6). Runs once per org per business day from the job route.
--   1. A paid order still sitting in a kitchen state is completed: without it, a branch that never taps
--      "served" on the KDS would report no sales at all.
--   2. On the last day of the org's week, the weekly anomaly detectors run for that week; on the last
--      day of a month, commission drag runs for the month.
-- ---------------------------------------------------------------------------------------------
create function private.close_business_day(p_org uuid, p_date date)
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

  -- p_date + 1 starts a new week when its weekday is the org's week start.
  if extract(dow from p_date + 1)::integer = v_week_start then
    v_weekly := private.save_findings(p_org, p_date - 6, p_date, array['staff', 'cash_share', 'over_short']);
  end if;
  if extract(day from p_date + 1) = 1 then
    v_monthly := private.save_findings(p_org, date_trunc('month', p_date)::date, p_date, array['commission']);
  end if;
  return jsonb_build_object('completed_orders', v_completed, 'weekly_findings', v_weekly, 'monthly_findings', v_monthly);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public wrappers. Sales figures: anyone who can see the branch. Money: owner/accountant only.
-- ---------------------------------------------------------------------------------------------
create function public.metric_sales(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (
  branch_id uuid, orders_completed bigint, orders_cancelled bigint, gross_poisha bigint,
  discounts_poisha bigint, refunds_poisha bigint, net_poisha bigint, vat_poisha bigint,
  service_charge_poisha bigint, total_poisha bigint, covers bigint, covers_orders bigint, aov_poisha bigint
) language sql stable security definer set search_path = '' as $$
  select * from private.m_sales(p_org, private.metric_scope(p_org, p_branch), p_from, p_to)
$$;

create function public.metric_sales_split(p_org uuid, p_branch uuid, p_from date, p_to date, p_dimension text)
returns table (key text, label text, orders bigint, net_poisha bigint)
language sql stable security definer set search_path = '' as $$
  select * from private.m_sales_split(p_org, private.metric_scope(p_org, p_branch), p_from, p_to, p_dimension)
$$;

create function public.metric_item_qty(
  p_org uuid, p_branch uuid, p_window text, p_now timestamptz, p_from date default null, p_to date default null,
  p_item uuid default null, p_channel uuid default null, p_daypart text default null
) returns table (menu_item_id uuid, name text, qty bigint, net_poisha bigint, from_date date, to_date date)
language sql stable security definer set search_path = '' as $$
  select q.menu_item_id, q.name, q.qty, q.net_poisha, w.from_date, w.to_date
    from private.window_bounds(p_org, p_window, p_now, p_from, p_to) w
    cross join lateral private.m_item_qty(p_org, private.metric_scope(p_org, p_branch), w.from_date, w.to_date,
                                          w.from_ts, w.to_ts, p_item, p_channel, p_daypart) q
$$;

create function public.metric_pace(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (branch_id uuid, today_net_poisha bigint, typical_net_poisha bigint, pace_bps integer, rag text)
language sql stable security definer set search_path = '' as $$
  select * from private.m_pace(p_org, private.metric_scope(p_org, p_branch), p_now)
$$;

create function public.metric_staff_exceptions(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (
  branch_id uuid, staff_id uuid, staff_name text, orders bigint, completed_net_poisha bigint,
  void_after_kot_count bigint, void_after_kot_poisha bigint, void_after_payment_count bigint,
  discount_count bigint, discount_poisha bigint, discount_no_reason_count bigint,
  refund_count bigint, refund_poisha bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  -- Per-staff void and discount values are money (they feed finding impacts): owner/accountant.
  perform private.require_money(p_org);
  return query select * from private.m_staff_exceptions(p_org, private.metric_scope(p_org, p_branch), p_from, p_to);
end $$;

create function public.metric_commission(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (
  branch_id uuid, channel_id uuid, channel_kind text, channel_name text, orders bigint, net_poisha bigint,
  commission_bps integer, commission_poisha bigint, fixed_fees_poisha bigint, funded_discount_poisha bigint,
  packaging_poisha bigint, total_poisha bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_money(p_org);
  return query select * from private.m_commission(p_org, private.metric_scope(p_org, p_branch), p_from, p_to);
end $$;

create function public.metric_flash_pnl(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (
  business_date date, branch_id uuid, net_poisha bigint, cogs_poisha bigint, cogs_basis text,
  assumed_food_cost_bps integer, commission_poisha bigint, labour_daily_poisha bigint, fixed_daily_poisha bigint,
  estimated_profit_poisha bigint, variable_ratio_bps integer, breakeven_sales_poisha bigint,
  breakeven_remaining_poisha bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := private.business_date(p_now, private.org_cutoff(p_org));
begin
  perform private.require_money(p_org);
  return query select v_date, f.* from private.m_flash_pnl(p_org, private.metric_scope(p_org, p_branch), v_date) f;
end $$;

-- The owner's workflow on a finding. Dismissing needs a reason; snoozing needs a date. Audited.
create function public.set_finding_status(
  p_finding uuid, p_status public.finding_status, p_reason text default null, p_snooze_until date default null
) returns public.findings language plpgsql security definer set search_path = '' as $$
declare
  v_before public.findings;
  v_after public.findings;
begin
  select * into v_before from public.findings where id = p_finding;
  if not found or not private.has_role(v_before.org_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'dismissed' and nullif(btrim(p_reason), '') is null then
    raise exception 'a dismissed finding needs a reason' using errcode = 'invalid_parameter_value';
  end if;
  if p_status = 'snoozed' and p_snooze_until is null then
    raise exception 'a snoozed finding needs a date' using errcode = 'invalid_parameter_value';
  end if;
  update public.findings
     set status = p_status, reason = left(nullif(btrim(p_reason), ''), 500),
         snoozed_until = case when p_status = 'snoozed' then p_snooze_until end
   where id = p_finding returning * into v_after;
  perform private.write_audit(v_after.org_id, v_after.branch_id, 'finding.status', 'finding', p_finding::text,
    jsonb_build_object('status', v_before.status), jsonb_build_object('status', v_after.status, 'snoozed_until', v_after.snoozed_until),
    v_after.reason, null, null);
  return v_after;
end $$;

-- The owner can scan on demand instead of waiting for the night: the last four complete weeks
-- (anomalies) and the last complete month (commission). Same detectors, same upsert, so a scan after the
-- nightly run changes nothing.
create function public.scan_findings(p_org uuid, p_now timestamptz) returns integer
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
  v_n := v_n + private.save_findings(p_org, v_month, (v_month + interval '1 month - 1 day')::date, array['commission']);
  perform private.write_audit(p_org, null, 'findings.scan', 'finding', null, null,
    jsonb_build_object('findings', v_n), null, null, null);
  return v_n;
end $$;

-- The rows behind a finding ("every finding links to its evidence"): each void, discount, refund or short
-- shift the detector counted, or the platform's daily sales for commission drag. Money-gated like findings.
create function public.finding_events(p_finding uuid)
returns table (occurred_at timestamptz, business_date date, order_id uuid, order_number integer,
               kind text, value_poisha bigint, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare
  f public.findings;
  v_staff uuid;
begin
  select * into f from public.findings where id = p_finding;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  perform private.require_money(f.org_id);
  v_staff := nullif(f.subject ->> 'staff_id', '')::uuid;

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
  end if;
end $$;

-- Jobs only (service role): the day close for one org, and an on-demand detector run for backfills.
create function public.job_close_business_day(p_org uuid, p_date date) returns jsonb
language sql security definer set search_path = '' as $$
  select private.close_business_day(p_org, p_date)
$$;
create function public.job_run_detectors(p_org uuid, p_from date, p_to date, p_kinds text[]) returns integer
language sql security definer set search_path = '' as $$
  select private.save_findings(p_org, p_from, p_to, p_kinds)
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname in ('mul_bps', 'metric_scope', 'require_money', 'org_cutoff',
              'window_bounds', 'daypart_of', 'm_sales', 'm_sales_split', 'm_item_qty', 'm_pace', 'm_commission',
              'm_daily_overheads', 'm_flash_pnl', 'm_staff_exceptions', 'detector_defaults', 'detector_config',
              'detect_staff_anomalies', 'detect_cash_share', 'detect_over_short', 'detect_commission_drag',
              'detect_all', 'save_findings', 'close_business_day'))
        or (n.nspname = 'public' and p.proname in ('metric_sales', 'metric_sales_split', 'metric_item_qty',
              'metric_pace', 'metric_staff_exceptions', 'metric_commission', 'metric_flash_pnl',
              'set_finding_status', 'scan_findings', 'finding_events', 'job_close_business_day', 'job_run_detectors'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname like 'job\_%' then
      execute format('revoke execute on function %s from authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
    elsif f.proname like 'metric\_%' or f.proname in ('set_finding_status', 'scan_findings', 'finding_events') then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

comment on function public.metric_sales is 'sales.* and orders.* per branch plus a total row (branch_id null). METRICS.md "Sales". Phase 2.';
comment on function public.metric_sales_split is 'sales.by_channel / by_daypart / by_payment_method / by_hour. Phase 2.';
comment on function public.metric_item_qty is 'items.qty_sold for a named window at an injected now. Phase 2.';
comment on function public.metric_pace is 'Today vs the same weekday of the last four weeks, to the same time of day; drives branch RAG. Phase 2.';
comment on function public.metric_staff_exceptions is 'POS exceptions per staff member (money-gated). Phase 2.';
comment on function public.metric_commission is 'commission.value per branch and channel, rounded once per period (money-gated). Phase 2.';
comment on function public.metric_flash_pnl is 'pnl.flash with assumed COGS until recipes exist, and break-even (money-gated). Phase 2.';
comment on function public.set_finding_status is 'Owner workflow on a finding; audited. Phase 2.';
