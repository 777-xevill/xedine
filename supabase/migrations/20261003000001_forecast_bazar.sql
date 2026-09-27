-- Phase 7 (ADR 0020): forecasting and the bazar list assistant — cook and buy the right amount for tomorrow.
--
-- Forecast v1 is deterministic SQL (no ML service): a weighted average of the same weekday over the last
-- four weeks, using only comparable days (not closed, not flagged, same Ramadan status), normalised for
-- salary week and adjusted by what flagged days (rain, hartal, cricket, holidays) did to sales before.
-- It is shown only while it beats the naive "same weekday last week" by ≥ 10% WAPE (METRICS.md).

-- ---------------------------------------------------------------------------------------------
-- Columns and a tuning table
-- ---------------------------------------------------------------------------------------------
-- The owner marks days the restaurant is closed (Eid closure); closed days forecast zero.
alter table public.calendar_events add column closed boolean not null default false;

-- Prep plan in cooking units: a recipe cooked in batches (a deg of kacchi feeds ~40).
alter table public.recipes
  add column batch_portions numeric check (batch_portions > 0),
  add column batch_unit text check (batch_unit in ('deg', 'pot', 'tray', 'batch'));

-- Bazar list: how many days one purchase should cover, and the pack it is bought in (base units).
alter table public.ingredients
  add column bazar_days smallint not null default 1 check (bazar_days between 1 and 30),
  add column pack_qty numeric check (pack_qty > 0);

alter table public.bazar_list_lines
  add column forecast_qty numeric not null default 0,
  add column stock_qty numeric,
  add column safety_qty numeric not null default 0,
  add column adjust_bps integer not null default 0,
  add column purchased_qty_base numeric;
create index bazar_list_lines_list_idx on public.bazar_list_lines (org_id, bazar_list_id);

-- Learning from edits: how much the approver usually changes a suggestion, per branch and ingredient.
create table public.bazar_tuning (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  ingredient_id uuid not null,
  -- Exponentially weighted (approved ÷ suggested − 1), in basis points, clamped to ±50%.
  adjust_bps integer not null default 0 check (adjust_bps between -5000 and 5000),
  samples integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (org_id, branch_id, ingredient_id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete cascade
);
create index bazar_tuning_branch_idx on public.bazar_tuning (org_id, branch_id);

do $$
declare t text;
begin
  perform private.apply_policies('bazar_tuning', 'branch',
    array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[], array[]::public.app_role[]);
  update private.policy_registry set notes = 'learned by approve_bazar_list (ADR 0020)' where table_name = 'bazar_tuning';
  -- Bazar lists move money and messages: written only by the audited RPCs below.
  foreach t in array array['bazar_lists', 'bazar_list_lines'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('revoke insert, update, delete, truncate on table public.%I from authenticated', t);
    update private.policy_registry set write_roles = '{}', allow_delete = false,
           notes = 'written only by the bazar list RPCs (ADR 0020)'
     where table_name = t;
  end loop;
end $$;
comment on table public.bazar_tuning is 'How much approvers change bazar suggestions, per branch and ingredient. | written by: purchasing | phase: 7';

insert into public.message_templates (key, channel, language, body, provider_template_name, variables, status)
values
  ('bazar_list', 'whatsapp', 'en', 'Bazar list for {{1}}: {{2}}', 'xedine_bazar_list_en', '{date,body}', 'draft'),
  ('bazar_list', 'whatsapp', 'bn', '{{1}} তারিখের বাজার তালিকা: {{2}}', 'xedine_bazar_list_bn', '{date,body}', 'draft')
on conflict (key, channel, language) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------------------------
-- Per day: closed, Ramadan, and the flags that make a day unlike a normal one (rain, hartal, cricket,
-- holidays, an open Eid day…). Salary week is the first seven days of the month (METRICS.md) or a
-- salary_week event.
create function private.day_flags(p_org uuid, p_from date, p_to date)
returns table (business_date date, closed boolean, ramadan boolean, salary boolean, kinds text[])
language sql stable security definer set search_path = '' as $$
  select d::date,
         coalesce(bool_or(e.closed), false),
         coalesce(bool_or(e.kind = 'ramadan'), false),
         extract(day from d) <= 7 or coalesce(bool_or(e.kind = 'salary_week'), false),
         coalesce(array_agg(distinct e.kind::text) filter (where e.kind not in ('ramadan', 'salary_week') and not e.closed), '{}')
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    left join public.calendar_events e on e.org_id = p_org and d::date between e.starts_on and e.ends_on
   group by d
$$;

-- Managers on the ground flag rain, a hartal or a big cricket match for yesterday, today or tomorrow;
-- everything else on the calendar is the owner's (RLS). Idempotent per day and kind.
create function public.flag_day(p_org uuid, p_date date, p_kind public.calendar_kind, p_now timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
  v_id uuid;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('weather', 'hartal', 'cricket') or p_date is null or p_date < v_today - 1 or p_date > v_today + 1 then
    raise exception 'flag rain, a hartal or cricket for yesterday, today or tomorrow' using errcode = 'invalid_parameter_value';
  end if;
  select id into v_id from public.calendar_events
   where org_id = p_org and kind = p_kind and starts_on = p_date and ends_on = p_date;
  if v_id is null then
    insert into public.calendar_events (org_id, name, kind, starts_on, ends_on, source)
    values (p_org, initcap(p_kind::text), p_kind, p_date, p_date, 'manager flag') returning id into v_id;
    perform private.write_audit(p_org, null, 'calendar.flag', 'calendar_event', v_id::text, null,
      jsonb_build_object('date', p_date, 'kind', p_kind), null, null, null);
  end if;
  return v_id;
end $$;

-- What calendar days do to sales, learned from the org's own history before p_asof, per branch:
--   salary_week — average units on salary-week days ÷ other normal days (last 84 days, outside Ramadan)
--   <kind>      — units on past days flagged with that kind ÷ their baseline (the same weekday 1–4 weeks
--                 earlier, normal days, same Ramadan status); at least two such days, clamped 0.3–2.0.
create function private.m_calendar_factors(p_org uuid, p_branches uuid[], p_asof date)
returns table (branch_id uuid, factor_key text, factor numeric, days integer)
language sql stable security definer set search_path = '' as $$
  with tot as (
    select o.branch_id, o.business_date as d, sum(oi.quantity)::numeric as qty
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
     where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
       and o.order_status = 'completed' and o.business_date between p_asof - 365 and p_asof - 1
     group by 1, 2
  ), days as (
    select t.branch_id, t.d, t.qty, f.closed, f.ramadan, f.salary, f.kinds
      from tot t join private.day_flags(p_org, p_asof - 365, p_asof - 1) f on f.business_date = t.d
  ), normal as (
    select * from days where not closed and cardinality(kinds) = 0
  ), sal as (
    select n.branch_id, avg(n.qty) filter (where n.salary) / nullif(avg(n.qty) filter (where not n.salary), 0) as f,
           count(*) filter (where n.salary) as n
      from normal n where n.d >= p_asof - 84 and not n.ramadan
     group by n.branch_id
  ), flagged as (
    select d.branch_id, k.kind, d.qty,
           (select avg(n.qty) from normal n
             where n.branch_id = d.branch_id and n.ramadan = d.ramadan
               and n.d in (d.d - 7, d.d - 14, d.d - 21, d.d - 28)) as base
      from days d cross join unnest(d.kinds) as k (kind)
     where not d.closed
  )
  select s.branch_id, 'salary_week', least(greatest(coalesce(s.f, 1), 0.7), 1.5), s.n::integer
    from sal s where s.n > 0
  union all
  select f.branch_id, f.kind, least(greatest(sum(f.qty) / nullif(sum(f.base), 0), 0.3), 2.0), count(*)::integer
    from flagged f where f.base is not null
   group by f.branch_id, f.kind
  having count(*) >= 2
$$;

-- ---------------------------------------------------------------------------------------------
-- Forecast v1 per item × daypart × branch × day (METRICS.md "Forecasting")
--   model = Σ w·units(d − 7k) ÷ salary(d − 7k) ÷ Σ w × salary(d) × Π flag factors(d),
--           k = 1..4, w = 4,3,2,1, only comparable reference days, and only days before p_asof
--           (the injected "today"; a backtest passes null and uses only days before each target day)
--   naive = units(d − 7), same weekday last week
-- A closed day forecasts zero. No comparable reference day (e.g. the first week of Ramadan) → naive.
-- ---------------------------------------------------------------------------------------------
create function private.m_forecast(p_org uuid, p_branches uuid[], p_from date, p_to date, p_asof date default null)
returns table (branch_id uuid, business_date date, menu_item_id uuid, daypart text, model_qty numeric,
               naive_qty numeric, actual_qty numeric)
language sql stable security definer set search_path = '' as $$
  with dp as (
    select coalesce((select dayparts from public.org_settings where org_id = p_org), '[]'::jsonb) as j
  ), hist as (
    select o.branch_id, o.business_date as d, oi.menu_item_id, private.daypart_of(o.placed_at, dp.j) as part,
           sum(oi.quantity)::numeric as qty
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
     cross join dp
     where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
       and o.order_status = 'completed' and o.business_date between p_from - 28 and p_to
       and oi.menu_item_id is not null
     group by 1, 2, 3, 4
  ), fl as (
    select * from private.day_flags(p_org, p_from - 28, p_to)
  ), fac as (
    select * from private.m_calendar_factors(p_org, p_branches, coalesce(p_asof, p_from))
  ), sal as (
    select f.branch_id, f.factor from fac f where f.factor_key = 'salary_week'
  ), uni as (
    select distinct h.branch_id, h.menu_item_id, h.part from hist h where h.d < p_from
  ), grid as (
    select u.branch_id, u.menu_item_id, u.part, g::date as d
      from uni u cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ), refs as (
    select g.branch_id, g.menu_item_id, g.part, g.d, 5 - k as w, g.d - 7 * k as ref, fr.salary as ref_salary
      from grid g
     cross join generate_series(1, 4) k
      join fl fr on fr.business_date = g.d - 7 * k
      join fl fd on fd.business_date = g.d
     where not fr.closed and cardinality(fr.kinds) = 0 and fr.ramadan = fd.ramadan
       and g.d - 7 * k < coalesce(p_asof, g.d)
  ), model as (
    select r.branch_id, r.menu_item_id, r.part, r.d,
           sum(r.w * coalesce(h.qty, 0) / case when r.ref_salary then coalesce(s.factor, 1) else 1 end) / sum(r.w) as base
      from refs r
      left join hist h on h.branch_id = r.branch_id and h.menu_item_id = r.menu_item_id and h.part = r.part and h.d = r.ref
      left join sal s on s.branch_id = r.branch_id
     group by 1, 2, 3, 4
  )
  select g.branch_id, g.d, g.menu_item_id, g.part,
         case when fd.closed then 0::numeric
              else round(coalesce(m.base, coalesce(hn.qty, 0))
                         * case when m.base is not null and fd.salary then coalesce(s.factor, 1) else 1 end
                         * case when m.base is null then 1
                                else coalesce((select exp(sum(ln(f.factor))) from fac f
                                                where f.branch_id = g.branch_id and f.factor_key = any (fd.kinds)), 1) end, 2)
         end,
         coalesce(hn.qty, 0),
         case when g.d < coalesce(p_asof, p_to + 1) then coalesce(ha.qty, 0) end
    from grid g
    join fl fd on fd.business_date = g.d
    left join model m on m.branch_id = g.branch_id and m.menu_item_id = g.menu_item_id and m.part = g.part and m.d = g.d
    left join sal s on s.branch_id = g.branch_id
    left join hist hn on hn.branch_id = g.branch_id and hn.menu_item_id = g.menu_item_id and hn.part = g.part
                     and hn.d = g.d - 7 and hn.d < coalesce(p_asof, g.d)
    left join hist ha on ha.branch_id = g.branch_id and ha.menu_item_id = g.menu_item_id and ha.part = g.part and ha.d = g.d
$$;

-- forecast.wape = Σ|actual − forecast| ÷ Σ actual, per branch (and in total), for the model and for the
-- naive baseline, over a past window. The model is shown only if it improves WAPE by ≥ 10%.
create function private.m_forecast_accuracy(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (branch_id uuid, days integer, actual_qty numeric, model_abs_error numeric, naive_abs_error numeric,
               wape_bps integer, naive_wape_bps integer, improvement_bps integer, is_shown boolean)
language sql stable security definer set search_path = '' as $$
  with f as (
    select * from private.m_forecast(p_org, p_branches, p_from, p_to) where actual_qty is not null
  )
  select f.branch_id, count(distinct f.business_date)::integer, sum(f.actual_qty),
         sum(abs(f.model_qty - f.actual_qty)), sum(abs(f.naive_qty - f.actual_qty)),
         round(10000 * sum(abs(f.model_qty - f.actual_qty)) / nullif(sum(f.actual_qty), 0))::integer,
         round(10000 * sum(abs(f.naive_qty - f.actual_qty)) / nullif(sum(f.actual_qty), 0))::integer,
         round(10000 * (1 - sum(abs(f.model_qty - f.actual_qty)) / nullif(sum(abs(f.naive_qty - f.actual_qty)), 0)))::integer,
         coalesce(sum(abs(f.model_qty - f.actual_qty)) <= 0.9 * sum(abs(f.naive_qty - f.actual_qty))
                  and sum(abs(f.naive_qty - f.actual_qty)) > 0, false)
    from f
   group by grouping sets ((f.branch_id), ())
   order by f.branch_id nulls last
$$;

-- The night job keeps tomorrow's forecast and the last 28 days' accuracy (for history and the brief).
create function private.store_forecast(p_org uuid, p_date date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_branches uuid[] := (select coalesce(array_agg(id), '{}') from public.branches where org_id = p_org and is_active);
  v_n integer;
begin
  insert into public.forecasts (org_id, branch_id, menu_item_id, business_date, daypart, forecast_qty, model_version)
  select p_org, f.branch_id, f.menu_item_id, f.business_date, f.daypart, f.model_qty, 'v1-weekday4'
    from private.m_forecast(p_org, v_branches, p_date, p_date, p_date) f
  on conflict (org_id, branch_id, menu_item_id, business_date, daypart, model_version)
  do update set forecast_qty = excluded.forecast_qty, generated_at = now();
  get diagnostics v_n = row_count;
  delete from public.forecast_accuracy where org_id = p_org and computed_on = p_date;
  insert into public.forecast_accuracy (org_id, branch_id, scope, scope_key, window_days, wape, naive_wape, is_shown, computed_on)
  select p_org, a.branch_id, 'branch', coalesce(a.branch_id::text, 'all'), 28, a.wape_bps / 10000.0,
         a.naive_wape_bps / 10000.0, a.is_shown, p_date
    from private.m_forecast_accuracy(p_org, v_branches, p_date - 28, p_date - 1) a;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public forecast, accuracy and prep plan (quantities: the stock roles of the branch)
-- ---------------------------------------------------------------------------------------------
create function public.metric_forecast_accuracy(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (branch_id uuid, days integer, actual_qty numeric, wape_bps integer, naive_wape_bps integer,
               improvement_bps integer, is_shown boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
begin
  return query
    select a.branch_id, a.days, a.actual_qty, a.wape_bps, a.naive_wape_bps, a.improvement_bps, a.is_shown
      from private.m_forecast_accuracy(p_org, private.stock_scope(p_org, p_branch), v_today - 28, v_today - 1) a;
end $$;

-- One day's forecast per item and daypart. `qty` is what to plan with: the model while it is shown,
-- else the naive "same weekday last week".
create function public.metric_forecast(p_org uuid, p_branch uuid, p_date date, p_now timestamptz)
returns table (branch_id uuid, menu_item_id uuid, name text, name_bn text, daypart text, model_qty numeric,
               naive_qty numeric, qty numeric, model_shown boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
  v_scope uuid[] := private.stock_scope(p_org, p_branch);
begin
  if p_date is null or p_date < v_today or p_date > v_today + 14 then
    raise exception 'forecast a day from today to two weeks ahead' using errcode = 'invalid_parameter_value';
  end if;
  return query
    with acc as (
      select a.branch_id, a.is_shown from private.m_forecast_accuracy(p_org, v_scope, v_today - 28, v_today - 1) a
       where a.branch_id is not null
    )
    select f.branch_id, f.menu_item_id, mi.name, mi.name_bn, f.daypart, f.model_qty, f.naive_qty,
           case when coalesce(acc.is_shown, false) then f.model_qty else f.naive_qty end,
           coalesce(acc.is_shown, false)
      from private.m_forecast(p_org, v_scope, p_date, p_date, v_today) f
      join public.menu_items mi on mi.org_id = p_org and mi.id = f.menu_item_id
      left join acc on acc.branch_id = f.branch_id
     order by mi.name, f.daypart;
end $$;

-- The prep plan: portions to cook per dish, in batches (degs, pots) where the recipe says, and the
-- two ingredients that weigh most (what to marinate or soak).
create function public.metric_prep_plan(p_org uuid, p_branch uuid, p_date date, p_now timestamptz)
returns table (branch_id uuid, menu_item_id uuid, name text, name_bn text, portions numeric, batch_portions numeric,
               batch_unit text, batches integer, key_ingredients jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
    with f as (
      select x.branch_id, x.menu_item_id, x.name, x.name_bn, sum(x.qty) as portions
        from public.metric_forecast(p_org, p_branch, p_date, p_now) x
       group by 1, 2, 3, 4
    ), r as (
      select f.*, private.active_recipe(p_org, f.menu_item_id, null) as recipe_id from f where f.portions > 0
    )
    select r.branch_id, r.menu_item_id, r.name, r.name_bn, round(r.portions, 1), rc.batch_portions, rc.batch_unit,
           case when rc.batch_portions is not null then ceil(r.portions / rc.batch_portions)::integer end,
           coalesce((
             select jsonb_agg(jsonb_build_object('ingredient_id', k.ingredient_id, 'name', i.name, 'name_bn', i.name_bn,
                                                 'base', i.base, 'qty', round(k.qty * r.portions)) order by k.qty desc)
               from (select e.ingredient_id, e.qty from private.recipe_explode(p_org, r.recipe_id) e
                      order by e.qty desc limit 2) k
               join public.ingredients i on i.org_id = p_org and i.id = k.ingredient_id), '[]'::jsonb)
      from r
      left join public.recipes rc on rc.org_id = p_org and rc.id = r.recipe_id
     order by r.portions desc;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The bazar list. Draft = forecast usage over the ingredient's bazar_days from the list's date
--   + safety stock − stock expected at the end of today − goods on the way,
-- scaled by what the approver usually changes (bazar_tuning), rounded up to the purchase pack, grouped
-- by the supplier last bought from. Stock at the end of today = theoretical stock now − the part of
-- today's forecast not yet sold. Never counted → treated as none, and the line says so.
-- ---------------------------------------------------------------------------------------------
create function private.bazar_need(p_org uuid, p_branch uuid, p_for date, p_today date)
returns table (ingredient_id uuid, forecast_qty numeric, stock_qty numeric, safety_qty numeric, in_transit numeric,
               adjust_bps integer, need_qty numeric, pack numeric, suggested_qty numeric, supplier_id uuid)
language sql stable security definer set search_path = '' as $$
  with fc as (
    -- Forecast units per day and item from today to the end of the longest bazar horizon.
    select f.business_date as d, f.menu_item_id, sum(f.model_qty) as model, sum(f.naive_qty) as naive
      from private.m_forecast(p_org, array[p_branch], p_today,
             p_for + (select coalesce(max(i.bazar_days), 1) from public.ingredients i where i.org_id = p_org and i.is_active) - 1,
             p_today) f
     group by 1, 2
  ), shown as (
    select coalesce((select a.is_shown from private.m_forecast_accuracy(p_org, array[p_branch], p_today - 28, p_today - 1) a
                      where a.branch_id = p_branch), false) as ok
  ), use_ as (
    select fc.d, e.ingredient_id, sum(case when shown.ok then fc.model else fc.naive end * e.qty) as qty
      from fc cross join shown
     cross join lateral private.recipe_explode(p_org, private.active_recipe(p_org, fc.menu_item_id, null)) e
     group by 1, 2
  ), today_used as (
    select m.ingredient_id, sum(m.qty) as qty
      from private.m_stock_moves(p_org, array[p_branch], p_today, p_today) m where m.kind = 'usage' group by 1
  ), st as (
    select s.ingredient_id, s.stock_qty, s.in_transit_qty
      from private.m_stock(p_org, array[p_branch], p_today) s
  ), base as (
    select i.id as ingredient_id, i.safety_stock_qty, i.bazar_days,
           coalesce(i.pack_qty, case when i.base = 'pcs' then 1 else 1000 end) as pack,
           coalesce((select sum(u.qty) from use_ u where u.ingredient_id = i.id and u.d between p_for and p_for + i.bazar_days - 1), 0) as fq,
           greatest(coalesce((select u.qty from use_ u where u.ingredient_id = i.id and u.d = p_today), 0)
                    - coalesce((select t.qty from today_used t where t.ingredient_id = i.id), 0), 0) as rest_today,
           st.stock_qty, coalesce(st.in_transit_qty, 0) as transit,
           coalesce((select bt.adjust_bps from public.bazar_tuning bt
                      where bt.org_id = p_org and bt.branch_id = p_branch and bt.ingredient_id = i.id), 0) as adj,
           (select p.supplier_id from public.purchase_lines pl
              join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
             where pl.org_id = p_org and p.branch_id = p_branch and pl.ingredient_id = i.id and p.status = 'confirmed'
             order by p.purchased_on desc, p.confirmed_at desc nulls last limit 1) as supplier
      from public.ingredients i
      left join st on st.ingredient_id = i.id
     where i.org_id = p_org and i.is_active
  ), need as (
    select b.*, greatest(b.fq + b.safety_stock_qty - greatest(coalesce(b.stock_qty, 0) - b.rest_today, 0) - b.transit, 0)
                * (10000 + b.adj) / 10000 as n
      from base b
  )
  select n.ingredient_id, round(n.fq, 1), n.stock_qty, n.safety_stock_qty, n.transit, n.adj, round(n.n, 1), n.pack,
         ceil(n.n / n.pack) * n.pack, n.supplier
    from need n
   where n.n > 0
   order by n.ingredient_id
$$;

create function public.generate_bazar_list(p_org uuid, p_branch uuid, p_for date, p_now timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.business_date(p_now, private.branch_cutoff(p_org, p_branch));
  v_id uuid;
  v_status public.bazar_status;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_for is null or p_for < v_today or p_for > v_today + 7 then
    raise exception 'a bazar list is for today or the next seven days' using errcode = 'invalid_parameter_value';
  end if;
  select id, status into v_id, v_status from public.bazar_lists where org_id = p_org and branch_id = p_branch and for_date = p_for;
  if v_id is not null and v_status <> 'draft' then
    raise exception 'this list was already approved' using errcode = 'invalid_parameter_value';
  end if;
  if v_id is null then
    insert into public.bazar_lists (org_id, branch_id, for_date) values (p_org, p_branch, p_for) returning id into v_id;
  else
    update public.bazar_lists set generated_at = now() where id = v_id;
    delete from public.bazar_list_lines where org_id = p_org and bazar_list_id = v_id;
  end if;
  insert into public.bazar_list_lines (org_id, branch_id, bazar_list_id, ingredient_id, supplier_id, suggested_qty_base,
    forecast_qty, stock_qty, safety_qty, adjust_bps)
  select p_org, p_branch, v_id, n.ingredient_id, n.supplier_id, n.suggested_qty, n.forecast_qty, n.stock_qty,
         n.safety_qty, n.adjust_bps
    from private.bazar_need(p_org, p_branch, p_for, v_today) n;
  return v_id;
end $$;

-- Approve (owner or manager), possibly editing quantities; each edit teaches bazar_tuning:
-- adjust ← 0.7 × adjust + 0.3 × (approved ÷ suggested − 1). A line approved at 0 is dropped.
-- p_lines: [{line_id, qty_base}]; lines left out are approved as suggested.
create function public.approve_bazar_list(p_list uuid, p_lines jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.bazar_lists;
  x record;
begin
  select * into l from public.bazar_lists where id = p_list for update;
  if not found or not private.can_access_branch_role(l.org_id, l.branch_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if l.status <> 'draft' then
    raise exception 'this list was already approved' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) j
              where (j ->> 'qty_base')::numeric < 0
                 or not exists (select 1 from public.bazar_list_lines b where b.org_id = l.org_id
                                  and b.bazar_list_id = l.id and b.id = (j ->> 'line_id')::uuid)) then
    raise exception 'unknown line or negative quantity' using errcode = 'invalid_parameter_value';
  end if;
  update public.bazar_list_lines b
     set approved_qty_base = coalesce((select (j ->> 'qty_base')::numeric from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) j
                                        where (j ->> 'line_id')::uuid = b.id limit 1), b.suggested_qty_base)
   where b.org_id = l.org_id and b.bazar_list_id = l.id;
  for x in
    select b.ingredient_id, b.suggested_qty_base as s, b.approved_qty_base as a from public.bazar_list_lines b
     where b.org_id = l.org_id and b.bazar_list_id = l.id and b.suggested_qty_base > 0
  loop
    insert into public.bazar_tuning as t (org_id, branch_id, ingredient_id, adjust_bps, samples)
    values (l.org_id, l.branch_id, x.ingredient_id,
            least(greatest(round(0.3 * (x.a / x.s - 1) * 10000), -5000), 5000)::integer, 1)
    on conflict (org_id, branch_id, ingredient_id) do update
      set adjust_bps = least(greatest(round(0.7 * t.adjust_bps + 0.3 * (x.a / x.s - 1) * 10000), -5000), 5000)::integer,
          samples = t.samples + 1, updated_at = now();
  end loop;
  delete from public.bazar_list_lines where org_id = l.org_id and bazar_list_id = l.id and approved_qty_base = 0;
  update public.bazar_lists set status = 'approved', approved_by = (select auth.uid()), approved_at = now() where id = p_list;
  perform private.write_audit(l.org_id, l.branch_id, 'bazar.approve', 'bazar_list', p_list::text, null,
    jsonb_build_object('for_date', l.for_date, 'edits', p_lines), null, null, null);
end $$;

-- Send (owner or manager): the app composes one WhatsApp message per recipient (the purchaser, and each
-- supplier with a phone) in their language; they go through the messaging outbox, never directly.
-- p_messages: [{to_phone, language, body}]
create function public.send_bazar_list(p_list uuid, p_messages jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  l public.bazar_lists;
  m jsonb;
  v_n integer := 0;
begin
  select * into l from public.bazar_lists where id = p_list for update;
  if not found or not private.can_access_branch_role(l.org_id, l.branch_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if l.status <> 'approved' then
    raise exception 'approve the list before sending it' using errcode = 'invalid_parameter_value';
  end if;
  for m in select * from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) loop
    if private.normalize_bd_phone(m ->> 'to_phone') is null or nullif(btrim(m ->> 'body'), '') is null then
      continue;
    end if;
    insert into public.message_outbox (org_id, channel, to_phone, template_key, payload, idempotency_key, approved_by, approved_at)
    values (l.org_id, 'whatsapp', private.normalize_bd_phone(m ->> 'to_phone'), 'bazar_list',
            jsonb_build_object('body', left(m ->> 'body', 3000), 'language', coalesce(nullif(m ->> 'language', ''), 'bn'),
                               'date', l.for_date),
            'bazar:' || l.id || ':' || private.normalize_bd_phone(m ->> 'to_phone'), (select auth.uid()), now())
    on conflict (org_id, idempotency_key) do nothing;
    v_n := v_n + 1;
  end loop;
  update public.bazar_lists set status = 'sent', sent_at = now() where id = p_list;
  perform private.write_audit(l.org_id, l.branch_id, 'bazar.send', 'bazar_list', p_list::text, null,
    jsonb_build_object('messages', v_n), null, null, null);
  return v_n;
end $$;

-- Reconcile against what was actually bought for the list's day (purchases dated that day or the day
-- before). Anyone who may see the list may reconcile; it only records what the purchases say.
create function public.reconcile_bazar_list(p_list uuid)
returns table (ingredient_id uuid, approved_qty numeric, purchased_qty numeric, diff_qty numeric)
language plpgsql security definer set search_path = '' as $$
declare
  l public.bazar_lists;
begin
  select * into l from public.bazar_lists where id = p_list for update;
  if not found or not private.can_access_branch_role(l.org_id, l.branch_id,
       array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if l.status not in ('sent', 'approved', 'reconciled') then
    raise exception 'approve the list first' using errcode = 'invalid_parameter_value';
  end if;
  update public.bazar_list_lines b
     set purchased_qty_base = coalesce((
           select sum(pl.qty_base) from public.purchase_lines pl
             join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
            where pl.org_id = l.org_id and p.branch_id = l.branch_id and pl.ingredient_id = b.ingredient_id
              and p.status = 'confirmed' and p.purchased_on between l.for_date - 1 and l.for_date), 0)
   where b.org_id = l.org_id and b.bazar_list_id = l.id;
  update public.bazar_lists set status = 'reconciled' where id = p_list;
  return query
    select b.ingredient_id, b.approved_qty_base, b.purchased_qty_base, b.purchased_qty_base - b.approved_qty_base
      from public.bazar_list_lines b where b.org_id = l.org_id and b.bazar_list_id = l.id
     order by b.ingredient_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The day close also stores tomorrow's forecast.
-- ---------------------------------------------------------------------------------------------
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
    v_weekly := private.save_findings(p_org, p_date - 6, p_date, array['staff', 'cash_share', 'over_short']);
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

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname in ('day_flags', 'm_calendar_factors', 'm_forecast',
              'm_forecast_accuracy', 'store_forecast', 'bazar_need'))
        or (n.nspname = 'public' and p.proname in ('flag_day', 'metric_forecast_accuracy', 'metric_forecast', 'metric_prep_plan',
              'generate_bazar_list', 'approve_bazar_list', 'send_bazar_list', 'reconcile_bazar_list'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

comment on function public.metric_forecast is 'Per item × daypart forecast for a day; the model only while it beats naive by ≥10% WAPE. Phase 7.';
comment on function public.metric_prep_plan is 'Portions, batches (degs/pots) and key ingredients to prepare for a day. Phase 7.';
comment on function public.generate_bazar_list is 'Draft bazar list: forecast usage − stock + safety, rounded to packs, by supplier. Phase 7.';
comment on function public.approve_bazar_list is 'Owner/manager approves (with edits that tune later suggestions); audited. Phase 7.';
comment on function public.send_bazar_list is 'Queues the approved list to the purchaser and suppliers via the WhatsApp outbox. Phase 7.';
comment on function public.reconcile_bazar_list is 'Matches an approved list against the purchases entered for its day. Phase 7.';
