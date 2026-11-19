-- The day plan (ADR 0066): one standard routine for every day, built from what the restaurant already
-- records, plus the three things a real kitchen plans with that Xedine could not hold before.
--
--  1. Party and pre-orders (`planned_orders`): a wedding's 60 plates of kacchi, an office's 40 lunch boxes.
--     Certain demand, in the restaurant's own numbers: added on top of the usual day in "what to cook" and
--     "what to buy", and taken out of the history afterwards so next week's usual day does not carry it.
--  2. "How busy?" on a special day (`calendar_events.expect_bps`): a new restaurant has no past match days to
--     learn from, so "a big match tomorrow" changed nothing. The owner's or manager's own guess (+15%, +30%,
--     −15%, −30%) is used for that day instead of what such days did before.
--  3. The bazar list, worked out again: stock is the ≈ estimate when an item was never counted (it was
--     taken as empty, so every new restaurant was told to buy everything again); a list for today needs only
--     the rest of today (today was counted twice); a list for a later day takes out what the days in between
--     will use and adds what lists already approved for them will bring; party orders are in it; half
--     plates take half; a person can add an item the list missed.
--  4. The forecast ignores the days before a branch's first sale: they are unknown, not zero (a restaurant's
--     first four weeks were forecast at 40–70% of their real sales).
--  5. "Tell Xedine" goes through `add_special_day`: managers saw the form but the calendar only let owners
--     write, so their special days were refused.
--  6. `metric_day_plan`: the day's steps and where each stands, in one call.

-- ---------------------------------------------------------------------------------------------
-- 1. Party and pre-orders
-- ---------------------------------------------------------------------------------------------
create type public.planned_order_status as enum ('planned', 'done', 'cancelled');

create table public.planned_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  for_date date not null,
  -- When it must be ready, on the restaurant's clock.
  ready_at time,
  -- Who it is for and what it is, in the restaurant's words ("Office lunch, Rahman & Co").
  title text not null constraint planned_orders_title check (char_length(btrim(title)) between 1 and 120),
  note text constraint planned_orders_note check (char_length(note) <= 300),
  status public.planned_order_status not null default 'planned',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);
create index planned_orders_branch_date_idx on public.planned_orders (org_id, branch_id, for_date);

create table public.planned_order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  planned_order_id uuid not null,
  menu_item_id uuid not null,
  variant_id uuid,
  qty integer not null constraint planned_order_lines_qty check (qty between 1 and 5000),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, planned_order_id) references public.planned_orders (org_id, id) on delete cascade,
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete cascade,
  foreign key (org_id, variant_id) references public.item_variants (org_id, id) on delete set null (variant_id)
);
create index planned_order_lines_order_idx on public.planned_order_lines (org_id, planned_order_id);
create index planned_order_lines_branch_idx on public.planned_order_lines (org_id, branch_id);

select private.apply_policies('planned_orders', 'branch',
  array['owner', 'manager', 'kitchen', 'purchaser', 'cashier', 'accountant']::public.app_role[],
  '{}'::public.app_role[], false, 'written only by save_planned_order / set_planned_order_status (ADR 0066)');
select private.apply_policies('planned_order_lines', 'branch',
  array['owner', 'manager', 'kitchen', 'purchaser', 'cashier', 'accountant']::public.app_role[],
  '{}'::public.app_role[], false, 'written only by save_planned_order (ADR 0066)');
comment on table public.planned_orders is
  'Party and pre-orders taken for a day: certain demand on top of the forecast. | written by: forecasting | phase: 7';
comment on table public.planned_order_lines is
  'The dishes (and sizes) of a party or pre-order, in plates. | written by: forecasting | phase: 7';

-- Plates and portions of the party orders per branch, day and dish (cancelled ones left out). Portions
-- follow the size's share of the dish (two half plates are one portion).
create function private.m_planned_portions(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (branch_id uuid, business_date date, menu_item_id uuid, qty numeric, portions numeric)
language sql stable security definer set search_path = '' as $$
  select o.branch_id, o.for_date, l.menu_item_id, sum(l.qty)::numeric,
         sum(l.qty * coalesce(v.portion_bps, 10000) / 10000.0)
    from public.planned_orders o
    join public.planned_order_lines l on l.org_id = o.org_id and l.planned_order_id = o.id
    left join public.item_variants v on v.org_id = o.org_id and v.id = l.variant_id
   where o.org_id = p_org and o.branch_id = any (p_branches) and o.status <> 'cancelled'
     and o.for_date between p_from and p_to
   group by 1, 2, 3
$$;

-- Save a party or pre-order (new, or change one still planned). Owner or the branch's manager; audited.
create function public.save_planned_order(
  p_org uuid, p_branch uuid, p_id uuid, p_for date, p_ready_at time, p_title text, p_note text, p_lines jsonb,
  p_now timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.business_date(p_now, private.branch_cutoff(p_org, p_branch));
  v_id uuid := p_id;
  v_line jsonb;
  v_item uuid;
  v_variant uuid;
  v_qty integer;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_for is null or p_for < v_today or p_for > v_today + 60 then
    raise exception 'planned_order_date' using errcode = 'invalid_parameter_value';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null or char_length(btrim(p_title)) > 120
     or char_length(coalesce(p_note, '')) > 300 then
    raise exception 'a party order needs a name of up to 120 letters' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 30 then
    raise exception 'a party order needs 1–30 dishes' using errcode = 'invalid_parameter_value';
  end if;
  if v_id is null then
    insert into public.planned_orders (org_id, branch_id, for_date, ready_at, title, note, created_by)
    values (p_org, p_branch, p_for, p_ready_at, btrim(p_title), nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()))
    returning id into v_id;
  else
    update public.planned_orders
       set for_date = p_for, ready_at = p_ready_at, title = btrim(p_title),
           note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
     where org_id = p_org and branch_id = p_branch and id = v_id and status = 'planned';
    if not found then
      raise exception 'only a planned order can be changed' using errcode = 'invalid_parameter_value';
    end if;
    delete from public.planned_order_lines where org_id = p_org and planned_order_id = v_id;
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line ->> 'menu_item_id', '')::uuid;
    v_variant := nullif(v_line ->> 'variant_id', '')::uuid;
    v_qty := (v_line ->> 'qty')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 5000 then
      raise exception 'each dish needs 1–5,000 plates' using errcode = 'invalid_parameter_value';
    end if;
    if not exists (select 1 from public.menu_items m where m.org_id = p_org and m.id = v_item) then
      raise exception 'unknown menu item' using errcode = 'invalid_parameter_value';
    end if;
    if v_variant is not null and not exists (select 1 from public.item_variants v
                                              where v.org_id = p_org and v.id = v_variant and v.menu_item_id = v_item) then
      raise exception 'unknown size' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.planned_order_lines (org_id, branch_id, planned_order_id, menu_item_id, variant_id, qty)
    values (p_org, p_branch, v_id, v_item, v_variant, v_qty);
  end loop;
  perform private.write_audit(p_org, p_branch, 'planned_order.save', 'planned_order', v_id::text, null,
    jsonb_build_object('for_date', p_for, 'ready_at', p_ready_at, 'lines', p_lines), null, null, null);
  return v_id;
end $$;

-- Mark a party order done (delivered), cancelled, or planned again. Owner or the branch's manager; audited.
create function public.set_planned_order_status(p_id uuid, p_status public.planned_order_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o public.planned_orders;
begin
  select * into o from public.planned_orders where id = p_id for update;
  if not found or not private.can_access_branch_role(o.org_id, o.branch_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.planned_orders set status = p_status, updated_at = now() where id = p_id;
  perform private.write_audit(o.org_id, o.branch_id, 'planned_order.status', 'planned_order', p_id::text,
    jsonb_build_object('status', o.status), jsonb_build_object('status', p_status), null, null, null);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. "How busy?" on a special day
-- ---------------------------------------------------------------------------------------------
alter table public.calendar_events
  add column expect_bps integer constraint calendar_events_expect check (expect_bps between 3000 and 30000);
comment on column public.calendar_events.expect_bps is
  'How busy the owner or a manager expects the day(s), in basis points of a usual day (a bit busier = 11500). '
  'When set, the forecast uses it for those days instead of what such days did before (ADR 0066).';

-- Per day: the product of the expectations said for it, and the kinds they were said for.
create function private.day_expect(p_org uuid, p_from date, p_to date)
returns table (business_date date, expect numeric, kinds text[])
language sql stable security definer set search_path = '' as $$
  select d::date, exp(sum(ln(e.expect_bps / 10000.0))), array_agg(distinct e.kind::text)
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    join public.calendar_events e on e.org_id = p_org and d::date between e.starts_on and e.ends_on
   where e.expect_bps is not null and not e.closed
   group by d
$$;

-- "Tell Xedine": a match, a special day, rain, a hartal or anything else, for a day or a few, with how busy
-- it may be. The owner may also close the restaurant for those days; a manager may tell about yesterday to
-- two months ahead. Audited.
create function public.add_special_day(
  p_org uuid, p_kind public.calendar_kind, p_from date, p_to date, p_name text, p_note text,
  p_expect_bps integer, p_closed boolean, p_now timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_owner boolean := private.has_role(p_org, array['owner']::public.app_role[]);
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
  v_id uuid;
begin
  if not v_owner and not private.has_role(p_org, array['manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('holiday', 'cricket', 'weather', 'hartal', 'custom') then
    raise exception 'that kind of day is set on the Calendar page' using errcode = 'invalid_parameter_value';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then
    raise exception 'pick a day, or a few days up to a month' using errcode = 'invalid_parameter_value';
  end if;
  if p_expect_bps is not null and (p_expect_bps < 3000 or p_expect_bps > 30000) then
    raise exception 'how busy must be between 30%% and 300%% of a usual day' using errcode = 'invalid_parameter_value';
  end if;
  if not v_owner and (coalesce(p_closed, false) or p_from < v_today - 1 or p_to > v_today + 60) then
    raise exception 'a manager tells about yesterday to two months ahead; only the owner closes the restaurant'
      using errcode = 'insufficient_privilege';
  end if;
  insert into public.calendar_events (org_id, name, kind, starts_on, ends_on, note, source, closed, expect_bps)
  values (p_org, left(coalesce(nullif(btrim(p_name), ''), p_kind::text), 120), p_kind, p_from, p_to,
          left(nullif(btrim(coalesce(p_note, '')), ''), 300), case when v_owner then 'owner' else 'manager' end,
          coalesce(p_closed, false), case when coalesce(p_closed, false) then null else p_expect_bps end)
  returning id into v_id;
  perform private.write_audit(p_org, null, 'calendar.add', 'calendar_event', v_id::text, null,
    jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'expect_bps', p_expect_bps,
                       'closed', coalesce(p_closed, false)), null, null, null);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. The forecast: unknown days before the first sale, the owner's "how busy", party orders out
-- ---------------------------------------------------------------------------------------------
drop function private.m_forecast(uuid, uuid[], date, date, date);
create function private.m_forecast(p_org uuid, p_branches uuid[], p_from date, p_to date, p_asof date default null)
returns table (branch_id uuid, business_date date, menu_item_id uuid, daypart text, model_qty numeric,
               naive_qty numeric, actual_qty numeric, expect numeric)
language sql stable security definer set search_path = '' as $$
  with dp as (
    select coalesce((select dayparts from public.org_settings where org_id = p_org), '[]'::jsonb) as j
  ), raw as (
    select o.branch_id, o.business_date as d, oi.menu_item_id,
           private.daypart_of_tz(private.org_tz(p_org), o.placed_at, dp.j) as part, sum(oi.quantity)::numeric as qty
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
     cross join dp
     where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
       and o.order_status = 'completed' and o.business_date between p_from - 28 and p_to
       and oi.menu_item_id is not null
     group by 1, 2, 3, 4
  ), planned as (
    select pp.branch_id, pp.business_date as d, pp.menu_item_id, pp.qty
      from private.m_planned_portions(p_org, p_branches, p_from - 28, p_to) pp
  ), hist as (
    -- A party order is certain demand on top of the usual day: it is taken out of the history (spread over
    -- the day's dayparts by their share) so the usual day of the weeks after does not carry it.
    select r.branch_id, r.d, r.menu_item_id, r.part,
           greatest(r.qty - coalesce(pl.qty, 0) * r.qty
                              / nullif(sum(r.qty) over (partition by r.branch_id, r.d, r.menu_item_id), 0), 0) as qty
      from raw r
      left join planned pl on pl.branch_id = r.branch_id and pl.d = r.d and pl.menu_item_id = r.menu_item_id
  ), first_day as (
    -- The first day each branch sold anything: the days before it are unknown, not zero.
    select b as branch_id,
           (select min(o.business_date) from public.orders o where o.org_id = p_org and o.branch_id = b) as d
      from unnest(p_branches) b
  ), fl as (
    select * from private.day_flags(p_org, p_from - 28, p_to)
  ), ex as (
    select * from private.day_expect(p_org, p_from, p_to)
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
      join first_day f0 on f0.branch_id = g.branch_id
     where not fr.closed and cardinality(fr.kinds) = 0 and fr.ramadan = fd.ramadan
       and g.d - 7 * k < coalesce(p_asof, g.d)
       and g.d - 7 * k >= f0.d
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
                         -- What such days did before, for the kinds nobody said how busy they will be...
                         * case when m.base is null then 1
                                else coalesce((select exp(sum(ln(f.factor))) from fac f
                                                where f.branch_id = g.branch_id and f.factor_key = any (fd.kinds)
                                                  and not (f.factor_key = any (coalesce(e.kinds, '{}'::text[])))), 1) end
                         -- ...and what the owner or a manager said for the day.
                         * coalesce(e.expect, 1), 2)
         end,
         coalesce(hn.qty, 0),
         case when g.d < coalesce(p_asof, p_to + 1) then coalesce(ha.qty, 0) end,
         case when fd.closed then 0::numeric else coalesce(e.expect, 1) end
    from grid g
    join fl fd on fd.business_date = g.d
    left join ex e on e.business_date = g.d
    left join model m on m.branch_id = g.branch_id and m.menu_item_id = g.menu_item_id and m.part = g.part and m.d = g.d
    left join sal s on s.branch_id = g.branch_id
    -- Naive: the same weekday of the last week that is over (a day exactly a week ahead looks two weeks back).
    left join hist hn on hn.branch_id = g.branch_id and hn.menu_item_id = g.menu_item_id and hn.part = g.part
                     and hn.d = g.d - 7 * greatest(1, ceil((g.d - coalesce(p_asof, g.d) + 1) / 7.0))::integer
    left join hist ha on ha.branch_id = g.branch_id and ha.menu_item_id = g.menu_item_id and ha.part = g.part and ha.d = g.d
$$;

-- Learned calendar effects, with party orders taken out of the days they were delivered on.
create or replace function private.m_calendar_factors(p_org uuid, p_branches uuid[], p_asof date)
returns table (branch_id uuid, factor_key text, factor numeric, days integer)
language sql stable security definer set search_path = '' as $$
  with raw as (
    select o.branch_id, o.business_date as d, sum(oi.quantity)::numeric as qty
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
     where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
       and o.order_status = 'completed' and o.business_date between p_asof - 365 and p_asof - 1
     group by 1, 2
  ), planned as (
    select pp.branch_id, pp.business_date as d, sum(pp.qty) as qty
      from private.m_planned_portions(p_org, p_branches, p_asof - 365, p_asof - 1) pp
     group by 1, 2
  ), tot as (
    select r.branch_id, r.d, greatest(r.qty - coalesce(p.qty, 0), 0) as qty
      from raw r left join planned p on p.branch_id = r.branch_id and p.d = r.d
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

-- What the page and the prep plan use: the model while it beats naive, else naive with the day's "how busy".
create or replace function public.metric_forecast(p_org uuid, p_branch uuid, p_date date, p_now timestamptz)
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
           case when coalesce(acc.is_shown, false) then f.model_qty else round(f.naive_qty * f.expect, 2) end,
           coalesce(acc.is_shown, false)
      from private.m_forecast(p_org, v_scope, p_date, p_date, v_today) f
      join public.menu_items mi on mi.org_id = p_org and mi.id = f.menu_item_id
      left join acc on acc.branch_id = f.branch_id
     order by mi.name, f.daypart;
end $$;

-- What to cook: the usual day's dishes plus the party orders (in plates, `planned` apart).
drop function public.metric_prep_plan(uuid, uuid, date, timestamptz);
create function public.metric_prep_plan(p_org uuid, p_branch uuid, p_date date, p_now timestamptz)
returns table (branch_id uuid, menu_item_id uuid, name text, name_bn text, portions numeric, planned numeric,
               batch_portions numeric, batch_unit text, batches integer, key_ingredients jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := private.stock_scope(p_org, p_branch);
begin
  return query
    with f as (
      select x.branch_id, x.menu_item_id, sum(x.qty) as portions
        from public.metric_forecast(p_org, p_branch, p_date, p_now) x
       group by 1, 2
    ), p as (
      select pp.branch_id, pp.menu_item_id, sum(pp.qty) as plates, sum(pp.portions) as portions
        from private.m_planned_portions(p_org, v_scope, p_date, p_date) pp
       group by 1, 2
    ), u as (
      select coalesce(f.branch_id, p.branch_id) as branch_id, coalesce(f.menu_item_id, p.menu_item_id) as menu_item_id,
             coalesce(f.portions, 0) + coalesce(p.portions, 0) as portions, coalesce(p.plates, 0) as planned
        from f full join p on p.branch_id = f.branch_id and p.menu_item_id = f.menu_item_id
    ), r as (
      select u.*, mi.name, mi.name_bn, private.active_recipe(p_org, u.menu_item_id, null) as recipe_id
        from u join public.menu_items mi on mi.org_id = p_org and mi.id = u.menu_item_id
       where u.portions > 0
    )
    select r.branch_id, r.menu_item_id, r.name, r.name_bn, round(r.portions, 1), r.planned, rc.batch_portions,
           rc.batch_unit,
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
-- 4. The bazar list, worked out again
-- ---------------------------------------------------------------------------------------------
alter table public.bazar_list_lines
  add column stock_estimated boolean not null default false,
  add column planned_qty numeric not null default 0 constraint bazar_list_lines_planned check (planned_qty >= 0),
  add column added_by_hand boolean not null default false;
comment on column public.bazar_list_lines.stock_estimated is
  'stock_qty is the ≈ estimate (bought − recipe use − waste) because the item was never counted (ADR 0066).';
comment on column public.bazar_list_lines.planned_qty is
  'The part of forecast_qty that party and pre-orders need (ADR 0066).';
comment on column public.bazar_list_lines.added_by_hand is
  'A person added this line to the draft; making the list again keeps it, and it never tunes later lists.';

drop function private.bazar_need(uuid, uuid, date, date);
create function private.bazar_need(p_org uuid, p_branch uuid, p_for date, p_today date)
returns table (ingredient_id uuid, forecast_qty numeric, planned_qty numeric, stock_qty numeric,
               stock_estimated boolean, safety_qty numeric, in_transit numeric, on_order numeric, adjust_bps integer,
               need_qty numeric, pack numeric, suggested_qty numeric, supplier_id uuid)
language sql stable security definer set search_path = '' as $$
  with horizon as (
    select coalesce(max(i.bazar_days), 1) as days from public.ingredients i where i.org_id = p_org and i.is_active
  ), shown as (
    select coalesce((select a.is_shown from private.m_forecast_accuracy(p_org, array[p_branch], p_today - 28, p_today - 1) a
                      where a.branch_id = p_branch), false) as ok
  ), fc as (
    -- The usual day's dishes from today to the end of the longest bazar horizon: the model while it beats
    -- "same day last week", else last week with the day's "how busy" on top.
    select f.business_date as d, f.menu_item_id,
           sum(case when shown.ok then f.model_qty else f.naive_qty * f.expect end) as qty
      from horizon h
     cross join shown
     cross join lateral private.m_forecast(p_org, array[p_branch], p_today, p_for + h.days - 1, p_today) f
     group by 1, 2
  ), ratio as (
    -- Sizes: portions of the dish's recipe per plate sold over the last 28 days (two halves are one).
    select s.menu_item_id, sum(s.portions) / nullif(sum(s.qty), 0) as r
      from private.m_sold_for_stock(p_org, array[p_branch], p_today - 28, p_today - 1) s
     group by 1
  ), planned as (
    select pp.business_date as d, pp.menu_item_id, sum(pp.portions) as qty
      from horizon h
     cross join lateral private.m_planned_portions(p_org, array[p_branch], p_today, p_for + h.days - 1) pp
     group by 1, 2
  ), dishes as (
    select fc.d, fc.menu_item_id, fc.qty * coalesce(ratio.r, 1) as qty, 0::numeric as planned
      from fc left join ratio on ratio.menu_item_id = fc.menu_item_id
    union all
    select p.d, p.menu_item_id, p.qty, p.qty from planned p
  ), use_ as (
    select x.d, e.ingredient_id, sum(x.qty * e.qty) as qty, sum(x.planned * e.qty) as planned
      from dishes x
     cross join lateral private.recipe_explode(p_org, private.active_recipe(p_org, x.menu_item_id, null)) e
     group by 1, 2
  ), today_used as (
    select m.ingredient_id, sum(m.qty) as qty
      from private.m_stock_moves(p_org, array[p_branch], p_today, p_today) m where m.kind = 'usage' group by 1
  ), st as (
    select s.ingredient_id, s.stock_qty, s.in_transit_qty from private.m_stock(p_org, array[p_branch], p_today) s
  ), est as (
    select e.ingredient_id, e.est_qty from private.m_stock_estimate(p_org, array[p_branch], p_today) e
  ), ordered as (
    -- Lists already approved for the days between today and this one: bought before this day comes.
    select l.ingredient_id, sum(coalesce(l.approved_qty_base, 0)) as qty
      from public.bazar_lists b
      join public.bazar_list_lines l on l.org_id = b.org_id and l.bazar_list_id = b.id
     where b.org_id = p_org and b.branch_id = p_branch and b.status in ('approved', 'sent')
       and b.for_date > p_today and b.for_date < p_for
     group by 1
  ), base as (
    select i.id as ingredient_id, i.safety_stock_qty, i.bazar_days,
           coalesce(i.pack_qty, case when i.base = 'pcs' then 1 else 1000 end) as pack,
           coalesce((select sum(u.qty) from use_ u
                      where u.ingredient_id = i.id and u.d between p_for and p_for + i.bazar_days - 1), 0) as period_all,
           coalesce((select sum(u.planned) from use_ u
                      where u.ingredient_id = i.id and u.d between p_for and p_for + i.bazar_days - 1), 0) as period_planned,
           coalesce((select u.qty from use_ u where u.ingredient_id = i.id and u.d = p_today), 0) as today_fc,
           coalesce((select t.qty from today_used t where t.ingredient_id = i.id), 0) as today_used,
           coalesce((select sum(u.qty) from use_ u
                      where u.ingredient_id = i.id and u.d > p_today and u.d < p_for), 0) as between_qty,
           st.stock_qty as counted, est.est_qty as estimated, coalesce(st.in_transit_qty, 0) as transit,
           coalesce(o.qty, 0) as on_order,
           coalesce((select bt.adjust_bps from public.bazar_tuning bt
                      where bt.org_id = p_org and bt.branch_id = p_branch and bt.ingredient_id = i.id), 0) as adj,
           (select p.supplier_id from public.purchase_lines pl
              join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
             where pl.org_id = p_org and p.branch_id = p_branch and pl.ingredient_id = i.id and p.status = 'confirmed'
             order by p.purchased_on desc, p.confirmed_at desc nulls last limit 1) as supplier
      from public.ingredients i
      left join st on st.ingredient_id = i.id
      left join est on est.ingredient_id = i.id
      left join ordered o on o.ingredient_id = i.id
     where i.org_id = p_org and i.is_active
  ), need as (
    select b.*,
           greatest(b.today_fc - b.today_used, 0) as rest_today,
           -- A list for today needs only the rest of today; a later list all of its days.
           case when p_for = p_today then b.period_all - b.today_fc + greatest(b.today_fc - b.today_used, 0)
                else b.period_all end as period_need,
           -- Counted stock, else the ≈ estimate (never below zero), else nothing on the shelf.
           coalesce(b.counted, greatest(b.estimated, 0), 0) as stock_now
      from base b
  ), sized as (
    select n.*,
           -- Left when the list's day starts: stock now, less the rest of today and the days in between, plus
           -- what the lists already approved for those days will bring.
           greatest(n.stock_now - case when p_for > p_today then n.rest_today + n.between_qty else 0 end, 0)
             + n.on_order as start_qty
      from need n
  ), final as (
    select s.*,
           greatest(s.period_need + s.safety_stock_qty - s.start_qty - s.transit, 0) * (10000 + s.adj) / 10000 as n_qty
      from sized s
  )
  select f.ingredient_id, round(f.period_need, 1), round(f.period_planned, 1), coalesce(f.counted, f.estimated),
         f.counted is null and f.estimated is not null, f.safety_stock_qty, f.transit, f.on_order, f.adj,
         round(f.n_qty, 1), f.pack, ceil(f.n_qty / f.pack) * f.pack, f.supplier
    from final f
   where f.n_qty > 0
   order by f.ingredient_id
$$;

create or replace function public.generate_bazar_list(p_org uuid, p_branch uuid, p_for date, p_now timestamptz)
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
    -- Lines a person added stay; the worked-out ones are made again.
    delete from public.bazar_list_lines where org_id = p_org and bazar_list_id = v_id and not added_by_hand;
  end if;
  insert into public.bazar_list_lines (org_id, branch_id, bazar_list_id, ingredient_id, supplier_id, suggested_qty_base,
    forecast_qty, stock_qty, safety_qty, adjust_bps, stock_estimated, planned_qty)
  select p_org, p_branch, v_id, n.ingredient_id, n.supplier_id, n.suggested_qty, n.forecast_qty, n.stock_qty,
         n.safety_qty, n.adjust_bps, n.stock_estimated, n.planned_qty
    from private.bazar_need(p_org, p_branch, p_for, v_today) n
   where not exists (select 1 from public.bazar_list_lines h
                      where h.org_id = p_org and h.bazar_list_id = v_id and h.ingredient_id = n.ingredient_id);
  return v_id;
end $$;

create or replace function public.approve_bazar_list(p_list uuid, p_lines jsonb default '[]'::jsonb)
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
  -- Edits to worked-out lines teach later suggestions; a line a person added has nothing to learn from.
  for x in
    select b.ingredient_id, b.suggested_qty_base as s, b.approved_qty_base as a from public.bazar_list_lines b
     where b.org_id = l.org_id and b.bazar_list_id = l.id and b.suggested_qty_base > 0 and not b.added_by_hand
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

-- Add an item the list missed (a draft only), with the amount to buy. Same people as making the list.
create function public.add_bazar_line(p_list uuid, p_ingredient uuid, p_qty numeric, p_now timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.bazar_lists;
  v_today date;
  v_stock numeric;
  v_est numeric;
  v_id uuid;
begin
  select * into l from public.bazar_lists where id = p_list for update;
  if not found or not private.can_access_branch_role(l.org_id, l.branch_id,
       array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if l.status <> 'draft' then
    raise exception 'this list was already approved' using errcode = 'invalid_parameter_value';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > 10000000 then
    raise exception 'say how much to buy' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.ingredients i where i.org_id = l.org_id and i.id = p_ingredient and i.is_active) then
    raise exception 'unknown ingredient' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.bazar_list_lines b
              where b.org_id = l.org_id and b.bazar_list_id = l.id and b.ingredient_id = p_ingredient) then
    raise exception 'bazar_line_exists' using errcode = 'invalid_parameter_value';
  end if;
  v_today := private.business_date(p_now, private.branch_cutoff(l.org_id, l.branch_id));
  select s.stock_qty into v_stock from private.m_stock(l.org_id, array[l.branch_id], v_today) s
   where s.ingredient_id = p_ingredient;
  if v_stock is null then
    select e.est_qty into v_est from private.m_stock_estimate(l.org_id, array[l.branch_id], v_today) e
     where e.ingredient_id = p_ingredient;
  end if;
  insert into public.bazar_list_lines (org_id, branch_id, bazar_list_id, ingredient_id, supplier_id, suggested_qty_base,
    forecast_qty, stock_qty, safety_qty, adjust_bps, stock_estimated, planned_qty, added_by_hand)
  values (l.org_id, l.branch_id, l.id, p_ingredient,
          (select p.supplier_id from public.purchase_lines pl
             join public.purchases p on p.org_id = pl.org_id and p.id = pl.purchase_id
            where pl.org_id = l.org_id and p.branch_id = l.branch_id and pl.ingredient_id = p_ingredient
              and p.status = 'confirmed'
            order by p.purchased_on desc, p.confirmed_at desc nulls last limit 1),
          p_qty, 0, coalesce(v_stock, v_est), 0, 0, v_stock is null and v_est is not null, 0, true)
  returning id into v_id;
  perform private.write_audit(l.org_id, l.branch_id, 'bazar.add_line', 'bazar_list', l.id::text, null,
    jsonb_build_object('ingredient_id', p_ingredient, 'qty_base', p_qty), null, null, null);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. The day plan: every step of the day and where it stands
-- ---------------------------------------------------------------------------------------------
-- state: 'done' (did it) · 'todo' (to do now) · 'attention' (look at this) · 'later' (at closing) ·
-- 'info' (something to know) · 'none' (nothing needed). The closing steps exist for today only.
create function public.metric_day_plan(p_org uuid, p_branch uuid, p_date date, p_now timestamptz)
returns table (step text, state text, n integer, info jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[];
  v_today date;
  v_count_day integer := coalesce((select s.count_weekday from public.org_settings s where s.org_id = p_org), 0);
  v_n integer;
  v_m integer;
  v_status text;
  v_lines integer;
begin
  if p_branch is null then
    raise exception 'pick a branch' using errcode = 'invalid_parameter_value';
  end if;
  v_scope := private.stock_scope(p_org, p_branch);
  v_today := private.business_date(p_now, private.branch_cutoff(p_org, p_branch));
  if p_date is null or p_date < v_today or p_date > v_today + 7 then
    raise exception 'plan a day from today to a week ahead' using errcode = 'invalid_parameter_value';
  end if;

  -- Before opening ---------------------------------------------------------------------------
  select count(*) into v_n from public.planned_orders o
   where o.org_id = p_org and o.branch_id = p_branch and o.for_date = p_date and o.status <> 'cancelled';
  return query select 'party_orders'::text, case when v_n > 0 then 'info' else 'none' end, v_n, null::jsonb;

  -- Use first: items whose newest lot runs out of date by two days after the day, and held/expired ones.
  select count(*) into v_n from (
    select distinct on (l.ingredient_id) l.ingredient_id, l.expires_on
      from private.m_lots(p_org, array[p_branch]) l
     where l.received_on <= v_today
     order by l.ingredient_id, l.received_on desc, l.expires_on desc nulls first
  ) x where x.expires_on between v_today and p_date + 2;
  select count(*) into v_m from private.m_blocked_ingredients(p_org, p_branch, v_today);
  return query select 'use_first'::text, case when v_n + v_m > 0 then 'attention' else 'none' end, v_n + v_m,
    jsonb_build_object('expiring', v_n, 'blocked', v_m);

  select count(*) into v_n from public.metric_stock_status(p_org, p_branch, p_now) s where s.band = 'red';
  return query select 'running_low'::text, case when v_n > 0 then 'attention' else 'none' end, v_n, null::jsonb;

  select count(*) filter (where c.state = 'due'), count(*) into v_n, v_m
    from private.m_daily_checks(p_org, array[p_branch], p_now, 1) c where c.is_current;
  return query select 'checks'::text, case when v_m = 0 then 'none' when v_n > 0 then 'todo' else 'done' end, v_n,
    jsonb_build_object('total', v_m);

  -- Cooking and buying ------------------------------------------------------------------------
  select b.status::text, (select count(*) from public.bazar_list_lines l where l.org_id = p_org and l.bazar_list_id = b.id)
    into v_status, v_lines
    from public.bazar_lists b where b.org_id = p_org and b.branch_id = p_branch and b.for_date = p_date;
  return query select 'bazar'::text, case when v_status = 'reconciled' then 'done' else 'todo' end,
    coalesce(v_lines, 0), jsonb_build_object('status', coalesce(v_status, 'none'));

  -- Closing (today only) ----------------------------------------------------------------------
  if p_date = v_today then
    select count(*) into v_n from public.orders o
     where o.org_id = p_org and o.branch_id = p_branch and o.business_date = v_today
       and o.order_status not in ('completed', 'cancelled') and o.payment_status in ('unpaid', 'partially_paid')
       and exists (select 1 from public.order_items i
                    where i.org_id = p_org and i.order_id = o.id and i.status = 'active' and i.kot_sent_at is not null);
    return query select 'unpaid'::text, case when v_n > 0 then 'later' else 'none' end, v_n, null::jsonb;

    select count(*) filter (where sh.status = 'open'), count(*) into v_n, v_m from public.shifts sh
     where sh.org_id = p_org and sh.branch_id = p_branch
       and (sh.status = 'open'
            or coalesce(sh.business_date, private.business_date(sh.opened_at, private.branch_cutoff(p_org, p_branch))) = v_today);
    return query select 'cash_close'::text, case when v_m = 0 then 'none' when v_n > 0 then 'later' else 'done' end,
      v_n, null::jsonb;

    select count(*) into v_n from public.waste_logs w
     where w.org_id = p_org and w.branch_id = p_branch and w.business_date = v_today;
    return query select 'waste'::text, case when v_n > 0 then 'done' else 'later' end, v_n, null::jsonb;

    if extract(dow from v_today)::integer = v_count_day then
      select count(*) into v_n from public.stock_counts c
       where c.org_id = p_org and c.branch_id = p_branch and c.counted_on = v_today and c.status = 'submitted';
      return query select 'count'::text, case when v_n > 0 then 'done' else 'later' end, v_n, null::jsonb;
    end if;

    select count(*) into v_n from public.bazar_lists b
     where b.org_id = p_org and b.branch_id = p_branch and b.for_date = v_today + 1;
    return query select 'tomorrow_bazar'::text, case when v_n > 0 then 'done' else 'later' end, v_n, null::jsonb;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname in ('m_planned_portions', 'day_expect', 'm_forecast',
              'm_calendar_factors', 'bazar_need'))
        or (n.nspname = 'public' and p.proname in ('save_planned_order', 'set_planned_order_status', 'add_special_day',
              'metric_forecast', 'metric_prep_plan', 'generate_bazar_list', 'approve_bazar_list', 'add_bazar_line',
              'metric_day_plan'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

comment on function public.save_planned_order is
  'A party or pre-order for a day (dishes, sizes, plates): owner or manager; audited. ADR 0066.';
comment on function public.set_planned_order_status is 'Party order done, cancelled or planned again; audited. ADR 0066.';
comment on function public.add_special_day is
  '"Tell Xedine": a special day with how busy it may be; the owner may close; managers yesterday to +60 days. ADR 0066.';
comment on function public.metric_prep_plan is
  'What to cook: the usual day plus party orders (planned, in plates), batches and the two heaviest ingredients.';
comment on function public.add_bazar_line is 'Adds an item the draft bazar list missed; kept when the list is made again.';
comment on function public.metric_day_plan is
  'The day plan: each step (before opening, cooking and buying, closing) and where it stands. ADR 0066.';
