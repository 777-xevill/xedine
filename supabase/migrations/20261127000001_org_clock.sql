-- Restaurants in any country, step 2 (ADR 0062): the business day, the hour of a sale, dayparts and the
-- dates on reviews, complaints and member cards follow the restaurant's own time zone (org_settings.timezone),
-- not Asia/Dhaka.
--
-- How: business_date() stays one immutable function in Asia/Dhaka wall-clock terms. The cutoff helpers
-- (org_cutoff, branch_cutoff), which almost every metric passes to it, now return the cutoff shifted by the
-- difference between Dhaka and the restaurant's zone. A Dubai restaurant's 04:00 is Dhaka's 06:00, so its
-- business day is business_date(ts, 360). The same shift turns a business date back into instants
-- ((day + cutoff) at time zone 'Asia/Dhaka'), so every window and "since opening" stays right. For Dhaka the
-- shift is 0: nothing changes for a Bangladeshi restaurant.
-- The shift is taken now (the helpers do not know the moment), so in a zone with summer time a computed
-- day can be off by the hour around its cutoff for moments in the other season. An order's own business_date
-- is stored at insert with the shift of its own moment, so it is always exact. TODO(verify) none of the top
-- markets except the UK and the US keep summer time.
-- Xedine's own billing months stay in Dhaka time.

create function private.org_tz(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select timezone from public.org_settings where org_id = p_org), 'Asia/Dhaka')
$$;
comment on function private.org_tz is 'The restaurant''s IANA time zone (org_settings.timezone), Asia/Dhaka by default (ADR 0062).';

-- Minutes Dhaka's clock is ahead of the zone's at a moment (Dubai: 120, London in winter: 360, Dhaka: 0).
create function private.dhaka_shift(p_tz text, p_at timestamptz) returns integer
language sql stable set search_path = '' as $$
  select round(extract(epoch from ((p_at at time zone 'Asia/Dhaka') - (p_at at time zone p_tz))) / 60)::integer
$$;

create or replace function private.org_cutoff(p_org uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select default_cutoff_minutes from public.org_settings where org_id = p_org), 240)
         + private.dhaka_shift(private.org_tz(p_org), now())
$$;

create or replace function private.branch_cutoff(p_org uuid, p_branch uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select b.cutoff_minutes from public.branches b where b.org_id = p_org and b.id = p_branch),
    (select s.default_cutoff_minutes from public.org_settings s where s.org_id = p_org),
    240) + private.dhaka_shift(private.org_tz(p_org), now())
$$;

-- A daypart by the restaurant's own clock (the two-argument daypart_of stays Dhaka's for old callers).
create function private.daypart_of_tz(p_tz text, p_ts timestamptz, p_dayparts jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce((
    select d ->> 'key'
      from jsonb_array_elements(p_dayparts) d
     where case
             when (d ->> 'start')::time <= (d ->> 'end')::time
               then (p_ts at time zone p_tz)::time >= (d ->> 'start')::time
                and (p_ts at time zone p_tz)::time < (d ->> 'end')::time
             else (p_ts at time zone p_tz)::time >= (d ->> 'start')::time
                or (p_ts at time zone p_tz)::time < (d ->> 'end')::time
           end
     limit 1), 'other')
$$;

-- private.m_ticket_times (from 20261004000001_customers_reviews.sql)
create or replace function private.m_ticket_times(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (order_id uuid, branch_id uuid, business_date date, placed_at timestamptz, net_poisha bigint,
               weekday integer, hour integer, ticket_seconds numeric)
language sql stable security definer set search_path = '' as $$
  select o.id, o.branch_id, o.business_date, o.placed_at, o.net_poisha,
         extract(dow from o.business_date)::integer, extract(hour from o.placed_at at time zone private.org_tz(p_org))::integer,
         extract(epoch from (r.at - s.at))
    from public.orders o
    join lateral (select min(e.occurred_at) as at from public.order_events e
                   where e.org_id = o.org_id and e.order_id = o.id and e.event_type = 'sent_to_kitchen') s on true
    join lateral (select min(e.occurred_at) as at from public.order_events e
                   where e.org_id = o.org_id and e.order_id = o.id and e.event_type = 'ready') r on true
   where o.org_id = p_org and o.branch_id = any (p_branches) and o.order_status = 'completed'
     and o.business_date between p_from and p_to and s.at is not null and r.at > s.at
$$;

-- private.detect_service (from 20261004000001_customers_reviews.sql)
create or replace function private.detect_service(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (
    select (c ->> 'slow_slot_min_orders')::integer as min_n, (c ->> 'slow_slot_min_ratio_x100')::numeric / 100 as ratio,
           (c ->> 'min_impact_poisha')::bigint as min_impact
      from (select private.detector_config(p_org) as c) x
  ), br as (
    select coalesce(array_agg(b.id), '{}') as ids from public.branches b where b.org_id = p_org
  ), t as (
    select * from private.m_ticket_times(p_org, (select ids from br), p_from, p_to)
  ), base as (
    select t.branch_id, percentile_cont(0.5) within group (order by t.ticket_seconds)::numeric as med
      from t group by t.branch_id
  ), slots as (
    select t.branch_id, t.weekday, (t.hour / 2) * 2 as from_hour, count(*) as n,
           percentile_cont(0.5) within group (order by t.ticket_seconds)::numeric as med,
           percentile_cont(0.9) within group (order by t.ticket_seconds)::numeric as p90,
           sum(t.net_poisha)::bigint as net, array_agg(t.order_id) as orders
      from t group by 1, 2, 3
  ), flagged as (
    select s.*, b.med as branch_med
      from slots s join base b on b.branch_id = s.branch_id cross join cfg
     where s.n >= cfg.min_n and s.med >= b.med * cfg.ratio
  )
  select 'service.slow_slot'::text, f.branch_id, f.weekday || ':' || f.from_hour,
         jsonb_build_object('weekday', f.weekday, 'from_hour', f.from_hour, 'to_hour', f.from_hour + 2),
         f.net,
         (case when coalesce(fb.slow, 0) + coalesce(rv.slow, 0) >= 3 then 'high' else 'medium' end)::public.confidence_level,
         '["service.ticket_time", "feedback.score"]'::jsonb,
         jsonb_build_object('period_start', p_from, 'period_end', p_to, 'orders', f.n,
           'median_seconds', round(f.med), 'p90_seconds', round(f.p90), 'branch_median_seconds', round(f.branch_med),
           'feedback', coalesce(fb.n, 0), 'feedback_slow', coalesce(fb.slow, 0), 'feedback_low', coalesce(fb.low, 0),
           'reviews_slow', coalesce(rv.slow, 0)),
         '["add_kitchen_staff_at_peak", "prep_before_rush", "check_station_bottleneck"]'::jsonb
    from flagged f cross join cfg
    left join lateral (
      select count(*) as n, count(*) filter (where 'slow_service' = any (fe.themes)) as slow,
             count(*) filter (where fe.rating <= 6) as low
        from public.feedback fe
       where fe.org_id = p_org and fe.order_id = any (f.orders) and fe.submitted_at is not null
    ) fb on true
    left join lateral (
      select count(*) as slow from public.reviews r
       where r.org_id = p_org and r.branch_id = f.branch_id and 'slow_service' = any (r.themes)
         and extract(dow from r.reviewed_at at time zone private.org_tz(p_org)) = f.weekday
         and r.reviewed_at::date between p_from and p_to + 3
    ) rv on true
   where f.net >= cfg.min_impact
$$;

-- private.detect_lapse (from 20261004000001_customers_reviews.sql)
create or replace function private.detect_lapse(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (
    select (c ->> 'lapse_min_visits')::integer as min_visits, (c ->> 'lapse_min_regulars')::integer as min_regulars,
           (c ->> 'lapse_min_rate_bps')::numeric as min_rate, (c ->> 'lapse_min_peer_ratio_x100')::numeric / 100 as peer_ratio,
           (c ->> 'min_impact_poisha')::bigint as min_impact
      from (select private.detector_config(p_org) as c) x
  ), before as (
    -- Each customer's home branch before the period: where most of their visits were.
    select o.customer_id, mode() within group (order by o.branch_id) as branch_id, count(*) as visits,
           sum(o.net_poisha) as spend
      from public.orders o
     where o.org_id = p_org and o.customer_id is not null and o.order_status = 'completed'
       and o.business_date between p_from - 90 and p_from - 1
     group by o.customer_id
  ), regulars as (
    select b.*, not exists (select 1 from public.orders x where x.org_id = p_org and x.customer_id = b.customer_id
                             and x.order_status = 'completed' and x.business_date between p_from and p_to) as lapsed
      from before b cross join cfg where b.visits >= cfg.min_visits
  ), by_branch as (
    select r.branch_id, count(*) as n, count(*) filter (where r.lapsed) as lapsed,
           coalesce(sum(r.spend) filter (where r.lapsed), 0) as lapsed_spend_90d
      from regulars r group by r.branch_id
  ), rated as (
    select b.*, b.lapsed * 10000.0 / b.n as rate,
           (select sum(p.lapsed) * 10000.0 / nullif(sum(p.n), 0) from by_branch p where p.branch_id <> b.branch_id) as peer
      from by_branch b
  )
  select 'customers.lapse'::text, r.branch_id, 'regulars',
         jsonb_build_object('regulars', r.n),
         round(r.lapsed_spend_90d / 3.0 * (p_to - p_from + 1) / 30.0)::bigint,
         (case when r.rate >= 2 * cfg.min_rate then 'high' else 'medium' end)::public.confidence_level,
         '["customers.segments", "visits.first_return_rate"]'::jsonb,
         jsonb_build_object('period_start', p_from, 'period_end', p_to, 'regulars', r.n, 'lapsed', r.lapsed,
           'rate_bps', round(r.rate), 'peer_rate_bps', round(r.peer),
           'price_changes', coalesce((
             select jsonb_agg(jsonb_build_object('item', mi.name, 'old_poisha', ph.old_price_poisha,
                                                 'new_poisha', ph.new_price_poisha, 'date', (ph.changed_at at time zone private.org_tz(p_org))::date)
                              order by ph.changed_at)
               from public.price_history ph join public.menu_items mi on mi.org_id = ph.org_id and mi.id = ph.menu_item_id
              where ph.org_id = p_org and (ph.branch_id = r.branch_id or ph.branch_id is null)
                and ph.old_price_poisha is not null and ph.new_price_poisha > ph.old_price_poisha
                and (ph.changed_at at time zone private.org_tz(p_org))::date between p_from - 90 and p_to), '[]'::jsonb)),
         '["win_back_campaign", "review_price_change", "call_regulars"]'::jsonb
    from rated r cross join cfg
   where r.n >= cfg.min_regulars and r.rate >= cfg.min_rate
     and (r.peer is null or r.rate >= cfg.peer_ratio * r.peer)
     and round(r.lapsed_spend_90d / 3.0 * (p_to - p_from + 1) / 30.0) >= cfg.min_impact
$$;

-- public.record_payment (from 20260927000001_phase1_completion.sql)
create or replace function public.record_payment(
  p_org uuid, p_branch uuid, p_order uuid, p_method public.payment_method, p_amount bigint,
  p_reference text, p_idempotency_key text, p_device uuid, p_staff uuid
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_paid bigint;
  v_due bigint;
  v_applied bigint;
  v_tendered bigint;
  v_shift uuid;
  v_invoice bigint;
  v_completed boolean;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'an idempotency key is required' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_order from public.orders where org_id = p_org and id = p_order and branch_id = p_branch for update;
  if not found then raise exception 'order not found' using errcode = 'no_data_found'; end if;
  if exists (select 1 from public.payments where org_id = p_org and idempotency_key = p_idempotency_key) then
    return v_order;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive' using errcode = 'invalid_parameter_value'; end if;
  if v_order.order_status = 'cancelled' then raise exception 'order is cancelled' using errcode = 'invalid_parameter_value'; end if;
  if v_order.payment_status not in ('unpaid', 'partially_paid') then
    raise exception 'order is already paid' using errcode = 'invalid_parameter_value';
  end if;

  v_paid := private.paid_poisha(p_org, p_order);
  v_due := v_order.total_poisha - v_paid;
  if v_due <= 0 then raise exception 'nothing left to pay' using errcode = 'invalid_parameter_value'; end if;
  v_applied := p_amount;
  if p_amount > v_due then
    if p_method <> 'cash' then
      raise exception 'amount is more than the balance due' using errcode = 'invalid_parameter_value';
    end if;
    v_applied := v_due;
    v_tendered := p_amount;
  end if;

  select id into v_shift from public.shifts
   where org_id = p_org and branch_id = p_branch and device_id = p_device and status = 'open' order by opened_at desc limit 1;
  insert into public.payments (org_id, branch_id, order_id, shift_id, staff_id, method, amount_poisha, tendered_poisha,
    reference, idempotency_key)
  values (p_org, p_branch, p_order, v_shift, p_staff, p_method, v_applied, v_tendered,
    left(nullif(btrim(p_reference), ''), 80), p_idempotency_key);
  v_paid := v_paid + v_applied;

  if v_paid >= v_order.total_poisha then
    v_completed := v_order.order_status = 'served';
    if v_order.invoice_no is null then
      v_invoice := private.next_invoice_number(p_org, p_branch);
    end if;
    update public.orders set
      payment_status = 'paid',
      order_status = case when v_completed then 'completed'::public.order_status else order_status end,
      invoice_no = coalesce(invoice_no,
        'INV-' || to_char(now() at time zone private.org_tz(p_org), 'YYYYMM') || '-' || lpad(v_invoice::text, 6, '0'))
    where id = p_order;
    insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
    values (p_org, p_branch, p_order, 'paid', p_staff, p_device);
    if v_completed then
      insert into public.order_events (org_id, branch_id, order_id, event_type, staff_id, device_id)
      values (p_org, p_branch, p_order, 'completed', p_staff, p_device);
    end if;
  else
    update public.orders set payment_status = 'partially_paid' where id = p_order;
  end if;

  perform private.write_audit(p_org, p_branch, 'order.payment', 'order', p_order::text, null,
    jsonb_build_object('method', p_method, 'amount_poisha', v_applied, 'tendered_poisha', v_tendered), null, p_device, p_staff);
  select * into v_order from public.orders where id = p_order;
  return v_order;
end $$;

-- public.incident_from_review (from 20261030000002_complaints_incidents.sql)
create or replace function public.incident_from_review(p_org uuid, p_review uuid, p_branch uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.reviews;
  v_branch uuid;
  v_id uuid;
begin
  select * into r from public.reviews where org_id = p_org and id = p_review;
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_branch := coalesce(r.branch_id, p_branch);
  if v_branch is null then
    raise exception 'pick a branch' using errcode = 'invalid_parameter_value';
  end if;
  perform private.require_incident_role(p_org, v_branch);
  select id into v_id from public.incidents where org_id = p_org and review_id = p_review;
  if found then
    return v_id;
  end if;
  return private.create_incident(p_org, v_branch, 'complaint',
    case when coalesce(r.rating, 10) <= 2 then 'high' else 'medium' end,
    case when r.source::text in ('facebook', 'foodpanda', 'google') then r.source::text else 'review' end,
    coalesce(nullif(left(btrim(r.body), 80), ''), 'Review'), r.body,
    coalesce((r.reviewed_at at time zone private.org_tz(p_org))::date,
             private.business_date(now(), private.branch_cutoff(p_org, v_branch))),
    null, null, p_review, null, null, null, null, false);
end $$;

-- public.incident_from_feedback (from 20261030000002_complaints_incidents.sql)
create or replace function public.incident_from_feedback(p_org uuid, p_feedback uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  f public.feedback;
  v_id uuid;
begin
  select * into f from public.feedback where org_id = p_org and id = p_feedback;
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_incident_role(p_org, f.branch_id);
  select id into v_id from public.incidents where org_id = p_org and feedback_id = p_feedback;
  if found then
    return v_id;
  end if;
  return private.create_incident(p_org, f.branch_id, 'complaint',
    case when coalesce(f.rating, 10) <= 3 then 'high' else 'medium' end, 'feedback',
    coalesce(nullif(left(btrim(f.comment), 80), ''), 'Feedback'), f.comment,
    coalesce((f.submitted_at at time zone private.org_tz(p_org))::date,
             private.business_date(now(), private.branch_cutoff(p_org, f.branch_id))),
    null, null, null, p_feedback, null, null, null, false);
end $$;

-- public.member_card_view (from 20261028000001_member_card.sql)
create or replace function public.member_card_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_card public.member_cards;
  v_s public.loyalty_settings;
  v_c public.customers;
begin
  if coalesce(p_token, '') !~ '^[A-Za-z0-9_-]{24}$' then return null; end if;
  select * into v_card from public.member_cards where token = p_token;
  if not found then return null; end if;
  select * into v_s from public.loyalty_settings where org_id = v_card.org_id;
  if not found or not v_s.is_on then return null; end if;
  select * into v_c from public.customers where org_id = v_card.org_id and id = v_card.customer_id;

  return jsonb_build_object(
    'restaurant', (select name from public.organizations where id = v_card.org_id),
    'name', v_c.name,
    'phone', private.mask_phone(v_c.phone),
    'member_since', (v_c.first_seen_at at time zone private.org_tz(v_card.org_id))::date,
    -- The restaurant's money and clock for the card page (ADR 0062).
    'currency', (select st.currency from public.org_settings st where st.org_id = v_card.org_id),
    'timezone', private.org_tz(v_card.org_id),
    'points', private.points_balance(v_card.org_id, v_c.id),
    'points_worth_poisha', private.points_balance(v_card.org_id, v_c.id) * v_s.point_value_poisha,
    'point_value_poisha', v_s.point_value_poisha,
    'min_redeem_points', v_s.min_redeem_points,
    'earn_points', v_s.earn_points,
    'earn_every_poisha', v_s.earn_every_poisha,
    'discount_bps', case when v_s.discount_on then v_s.discount_bps end,
    'orders', coalesce((
      select jsonb_agg(x order by x.placed_at desc) from (
        select o.placed_at, o.business_date, b.name as branch, o.total_poisha,
               (select coalesce(sum(lp.points), 0) from public.loyalty_points lp
                 where lp.org_id = o.org_id and lp.order_id = o.id and lp.kind = 'earn') as points,
               (select coalesce(jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'quantity', oi.quantity)
                                          order by oi.created_at), '[]'::jsonb)
                  from public.order_items oi
                 where oi.org_id = o.org_id and oi.order_id = o.id and oi.status = 'active') as items
          from public.orders o
          join public.branches b on b.org_id = o.org_id and b.id = o.branch_id
         where o.org_id = v_card.org_id and o.customer_id = v_c.id and o.order_status = 'completed'
         order by o.placed_at desc limit 20) x), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h order by h.created_at desc) from (
        select lp.kind, lp.points, lp.created_at from public.loyalty_points lp
          left join public.orders o on o.org_id = lp.org_id and o.id = lp.order_id
         where lp.org_id = v_card.org_id and lp.customer_id = v_c.id
           and not (lp.kind = 'redeem' and o.order_status = 'cancelled')
         order by lp.created_at desc limit 20) h), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object('name', b.name, 'address', b.address, 'area', b.area) order by b.name)
        from public.branches b where b.org_id = v_card.org_id and b.is_active), '[]'::jsonb),
    'menu', coalesce((
      select jsonb_agg(m order by m.cat_sort, m.cat, m.sort_order, m.name) from (
        select mi.name, mi.name_bn, mi.description, mi.base_price_poisha as price_poisha, mi.photo_path,
               mi.sort_order, coalesce(mc.sort_order, 1000000) as cat_sort,
               coalesce(mc.name, '') as cat, mc.name_bn as cat_bn
          from public.menu_items mi
          left join public.menu_categories mc on mc.org_id = mi.org_id and mc.id = mi.category_id
         where mi.org_id = v_card.org_id and mi.is_active and (mc.id is null or mc.is_active)
         limit 300) m), '[]'::jsonb));
end $$;

-- private.m_sales_split (from 20260928000001_metrics_and_leaks.sql)
create or replace function private.m_sales_split(p_org uuid, p_branches uuid[], p_from date, p_to date, p_dimension text)
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
          select case when p_dimension = 'daypart' then private.daypart_of_tz(private.org_tz(p_org), o.placed_at, v_dayparts)
                      else lpad(extract(hour from o.placed_at at time zone private.org_tz(p_org))::integer::text, 2, '0') end as k,
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

-- private.m_item_qty (from 20260928000001_metrics_and_leaks.sql)
create or replace function private.m_item_qty(
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
     and (p_daypart is null or private.daypart_of_tz(private.org_tz(p_org), o.placed_at,
            (select s.dayparts from public.org_settings s where s.org_id = p_org)) = p_daypart)
   group by oi.menu_item_id, mi.name
   order by 3 desc, 2
$$;

-- private.detect_cash_share (from 20260928000001_metrics_and_leaks.sql)
create or replace function private.detect_cash_share(p_org uuid, p_from date, p_to date)
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  with cfg as (select private.detector_config(p_org) as c,
                      coalesce((select dayparts from public.org_settings where org_id = p_org), '[]'::jsonb) as dp),
  o as (
    select o.branch_id, o.staff_id, private.daypart_of_tz(private.org_tz(p_org), o.placed_at, cfg.dp) as part, o.total_poisha,
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

-- private.m_forecast (from 20261003000001_forecast_bazar.sql)
create or replace function private.m_forecast(p_org uuid, p_branches uuid[], p_from date, p_to date, p_asof date default null)
returns table (branch_id uuid, business_date date, menu_item_id uuid, daypart text, model_qty numeric,
               naive_qty numeric, actual_qty numeric)
language sql stable security definer set search_path = '' as $$
  with dp as (
    select coalesce((select dayparts from public.org_settings where org_id = p_org), '[]'::jsonb) as j
  ), hist as (
    select o.branch_id, o.business_date as d, oi.menu_item_id, private.daypart_of_tz(private.org_tz(p_org), o.placed_at, dp.j) as part,
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

-- private.set_order_business_date (from 20260922000003_menu_pos.sql)
create or replace function private.set_order_business_date() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cutoff integer;
begin
  if tg_op = 'UPDATE' then
    if new.placed_at is distinct from old.placed_at then
      raise exception 'orders.placed_at is immutable' using errcode = 'restrict_violation';
    end if;
    new.business_date := old.business_date;
    return new;
  end if;
  select coalesce(b.cutoff_minutes, s.default_cutoff_minutes, 240)
    into v_cutoff
  from public.branches b
  left join public.org_settings s on s.org_id = b.org_id
  where b.id = new.branch_id and b.org_id = new.org_id;
  new.business_date := private.business_date(new.placed_at,
    coalesce(v_cutoff, 240) + private.dhaka_shift(private.org_tz(new.org_id), new.placed_at));
  return new;
end $$;

-- public.open_shift (from 20260923000001_order_lifecycle.sql)
create or replace function public.open_shift(p_org uuid, p_branch uuid, p_device uuid, p_staff uuid, p_opening_float bigint)
returns public.shifts language plpgsql security definer set search_path = '' as $$
declare v_shift public.shifts; begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner','manager','cashier']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.verify_staff_session(p_org, p_device, p_staff);
  if exists (select 1 from public.shifts where org_id = p_org and device_id = p_device and status = 'open') then
    raise exception 'a shift is already open on this device' using errcode = 'unique_violation';
  end if;
  if p_opening_float < 0 then raise exception 'opening float must be >= 0' using errcode = 'invalid_parameter_value'; end if;

  insert into public.shifts (org_id, branch_id, device_id, opened_by_staff_id, business_date, opening_float_poisha)
  values (p_org, p_branch, p_device, p_staff, private.business_date(now(), private.branch_cutoff(p_org, p_branch)), p_opening_float)
  returning * into v_shift;
  insert into public.cash_counts (org_id, branch_id, shift_id, kind, counted_by_staff_id, total_poisha)
  values (p_org, p_branch, v_shift.id, 'opening', p_staff, p_opening_float);
  perform private.write_audit(p_org, p_branch, 'shift.open', 'shift', v_shift.id::text, null,
    jsonb_build_object('opening_float_poisha', p_opening_float), null, p_device, p_staff);
  return v_shift;
end $$;

-- The morning brief, the evening close and the day's close run every hour; each restaurant takes its turn at
-- its own local hour (09:00, 23:00, after its cutoff) and the per-org claim keeps it to once a day.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('xedine-morning-brief', '5 * * * *', $cmd$select private.dispatch_job('morning_brief')$cmd$);
      perform cron.schedule('xedine-evening-close', '5 * * * *', $cmd$select private.dispatch_job('evening_close')$cmd$);
      perform cron.schedule('xedine-close-business-day', '35 * * * *', $cmd$select private.dispatch_job('close_business_day')$cmd$);
    exception when others then
      raise notice 'could not update the pg_cron schedules: %', sqlerrm;
    end;
  end if;
end $$;
