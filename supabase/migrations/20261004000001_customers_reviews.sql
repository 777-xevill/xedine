-- Phase 8 (ADR 0021): customers, retention and reviews — win the second visit, turn complaints into fixes.
--
-- PII care (CLAUDE.md #8): customer phones reach only owner/manager screens and the messaging outbox; the
-- LLM sees review text, never a phone. Sends respect consent, frequency caps and opt-outs, and every
-- campaign keeps a holdout so "lift" is measured, not assumed (METRICS.md "Customers").

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------
alter table public.campaigns
  add column body_en text,
  add column body_bn text,
  -- Runs itself each morning once approved; off by default (a person presses "Run" — ADR 0021 §5).
  add column auto_run boolean not null default false,
  add column last_run_at timestamptz;

alter table public.campaign_sends add column reason text;
alter table public.feedback add column themes text[] not null default '{}';
create index campaign_sends_customer_date_idx on public.campaign_sends (org_id, customer_id, created_at desc);
create index feedback_order_lookup_idx on public.feedback (org_id, order_id);
create index reviews_branch_date_idx on public.reviews (org_id, branch_id, reviewed_at desc);
create index orders_customer_date_idx on public.orders (org_id, customer_id, business_date) where customer_id is not null;

insert into public.message_templates (key, channel, language, body, provider_template_name, variables, status)
values
  ('campaign', 'whatsapp', 'en', '{{1}}', 'xedine_campaign_en', '{body}', 'draft'),
  ('campaign', 'whatsapp', 'bn', '{{1}}', 'xedine_campaign_bn', '{body}', 'draft'),
  ('feedback_request', 'whatsapp', 'en', 'Thank you for eating with us! How was it? {{1}}', 'xedine_feedback_en', '{link}', 'draft'),
  ('feedback_request', 'whatsapp', 'bn', 'আমাদের সাথে খাওয়ার জন্য ধন্যবাদ! কেমন লাগল? {{1}}', 'xedine_feedback_bn', '{link}', 'draft')
on conflict (key, channel, language) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Themes: a transparent keyword tagger (English, Bangla, Banglish) on reviews and feedback comments.
-- ---------------------------------------------------------------------------------------------
create function private.text_themes(p_text text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(t order by t), '{}') from (
    select 'slow_service' as t where p_text ~* '(slow|late|took (too )?long|waited|waiting|delay|দেরি|দেরী|অপেক্ষা|deri|opekkha)'
    union all select 'cold_food' where p_text ~* '(cold|not hot|ঠান্ডা|thanda)'
    union all select 'taste' where p_text ~* '(tasty|delicious|taste|flavou?r|মজা|স্বাদ|moja|shad)'
    union all select 'salty' where p_text ~* '(salty|too much salt|লবণ|lobon)'
    union all select 'portion' where p_text ~* '(portion|small|quantity|পরিমাণ|কম দিয়েছে|kom)'
    union all select 'price' where p_text ~* '(expensive|price|overpriced|costly|দাম|dam beshi|daam)'
    union all select 'staff' where p_text ~* '(rude|staff|waiter|behaviou?r|ব্যবহার|beyadob)'
    union all select 'cleanliness' where p_text ~* '(dirty|clean|hygiene|নোংরা|পরিষ্কার)'
    union all select 'wrong_order' where p_text ~* '(wrong (item|order)|missing|ভুল)'
    union all select 'praise' where p_text ~* '(great|excellent|amazing|loved|awesome|best|দারুণ|চমৎকার|ভালো লেগেছে|darun|oshadharon)'
  ) x
$$;

create function private.tag_themes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'reviews' then
    new.themes := private.text_themes(coalesce(new.body, ''));
  else
    new.themes := private.text_themes(coalesce(new.comment, ''));
  end if;
  return new;
end $$;
create trigger reviews_themes before insert or update of body on public.reviews
  for each row execute function private.tag_themes();
create trigger feedback_themes before insert or update of comment on public.feedback
  for each row execute function private.tag_themes();

-- ---------------------------------------------------------------------------------------------
-- Customers (METRICS.md "Customers"). A visit is a completed order with the customer attached.
--   segment: lost (> 90 days since the last visit) · at_risk (> 2 × their median interval and > 30 days)
--            · regular (≥ 4 visits in 90 days) · new (one visit) · returning (the rest)
--   RFM quintiles over customers seen in the last 365 days (5 = best).
-- ---------------------------------------------------------------------------------------------
create function private.m_customers(p_org uuid, p_branches uuid[], p_asof date)
returns table (customer_id uuid, branch_id uuid, first_visit date, last_visit date, visits bigint, visits_90d bigint,
               spend_poisha bigint, spend_90d_poisha bigint, median_interval_days numeric, days_since integer,
               segment text, r integer, f integer, m integer)
language sql stable security definer set search_path = '' as $$
  with v as (
    select o.customer_id, o.branch_id, o.business_date as d, o.net_poisha
      from public.orders o
     where o.org_id = p_org and o.branch_id = any (p_branches) and o.customer_id is not null
       and o.order_status = 'completed' and o.business_date <= p_asof
  ), per as (
    select v.customer_id,
           (array_agg(v.branch_id order by v.d desc))[1] as branch_id,
           min(v.d) as first_visit, max(v.d) as last_visit, count(*) as visits,
           count(*) filter (where v.d > p_asof - 90) as visits_90d,
           sum(v.net_poisha)::bigint as spend, coalesce(sum(v.net_poisha) filter (where v.d > p_asof - 90), 0)::bigint as spend_90d
      from v group by v.customer_id
  ), gaps as (
    select x.customer_id, percentile_cont(0.5) within group (order by x.gap)::numeric as med
      from (select v.customer_id, v.d - lag(v.d) over (partition by v.customer_id order by v.d) as gap from v) x
     where x.gap is not null and x.gap > 0
     group by x.customer_id
  ), s as (
    select p.*, g.med, (p_asof - p.last_visit) as since,
           case when p_asof - p.last_visit > 90 then 'lost'
                when p.visits > 1 and p_asof - p.last_visit > greatest(2 * coalesce(g.med, 0), 30) then 'at_risk'
                when p.visits_90d >= 4 then 'regular'
                when p.visits = 1 then 'new'
                else 'returning' end as seg
      from per p left join gaps g on g.customer_id = p.customer_id
  )
  select s.customer_id, s.branch_id, s.first_visit, s.last_visit, s.visits, s.visits_90d, s.spend, s.spend_90d, s.med,
         s.since, s.seg,
         case when s.since <= 365 then ntile(5) over (order by s.since desc) end,
         ntile(5) over (order by s.visits),
         ntile(5) over (order by s.spend)
    from s
$$;

-- identified share (last 30 days), first-return rates, and counts by segment.
create function private.m_customer_summary(p_org uuid, p_branches uuid[], p_asof date)
returns table (orders_30d bigint, identified_30d bigint, identified_share_bps integer, first_timers bigint,
               returned_30d bigint, returned_60d bigint, first_return_30d_bps integer, first_return_60d_bps integer,
               segments jsonb)
language sql stable security definer set search_path = '' as $$
  with o as (
    select count(*) as n, count(*) filter (where customer_id is not null) as ident
      from public.orders
     where org_id = p_org and branch_id = any (p_branches) and order_status = 'completed'
       and business_date between p_asof - 29 and p_asof
  ), c as (
    select * from private.m_customers(p_org, p_branches, p_asof)
  ), first_timers as (
    -- First visit 61–120 days ago, so 60 days of follow-up exist for everyone counted.
    select c.customer_id, c.first_visit from c where c.first_visit between p_asof - 120 and p_asof - 61
  ), ret as (
    select f.customer_id,
           exists (select 1 from public.orders x where x.org_id = p_org and x.customer_id = f.customer_id
                    and x.order_status = 'completed' and x.business_date > f.first_visit and x.business_date <= f.first_visit + 30) as r30,
           exists (select 1 from public.orders x where x.org_id = p_org and x.customer_id = f.customer_id
                    and x.order_status = 'completed' and x.business_date > f.first_visit and x.business_date <= f.first_visit + 60) as r60
      from first_timers f
  )
  select o.n, o.ident, case when o.n > 0 then round(o.ident * 10000.0 / o.n)::integer end,
         (select count(*) from ret), (select count(*) from ret where r30), (select count(*) from ret where r60),
         case when (select count(*) from ret) > 0 then round((select count(*) from ret where r30) * 10000.0 / (select count(*) from ret))::integer end,
         case when (select count(*) from ret) > 0 then round((select count(*) from ret where r60) * 10000.0 / (select count(*) from ret))::integer end,
         coalesce((select jsonb_object_agg(seg, n) from (select c.segment as seg, count(*) as n from c group by 1) x), '{}'::jsonb)
    from o
$$;

-- ---------------------------------------------------------------------------------------------
-- Service (METRICS.md "Reviews & service"): ticket time = ready − sent to kitchen (the first round).
-- ---------------------------------------------------------------------------------------------
create function private.m_ticket_times(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (order_id uuid, branch_id uuid, business_date date, placed_at timestamptz, net_poisha bigint,
               weekday integer, hour integer, ticket_seconds numeric)
language sql stable security definer set search_path = '' as $$
  select o.id, o.branch_id, o.business_date, o.placed_at, o.net_poisha,
         extract(dow from o.business_date)::integer, extract(hour from o.placed_at at time zone 'Asia/Dhaka')::integer,
         extract(epoch from (r.at - s.at))
    from public.orders o
    join lateral (select min(e.occurred_at) as at from public.order_events e
                   where e.org_id = o.org_id and e.order_id = o.id and e.event_type = 'sent_to_kitchen') s on true
    join lateral (select min(e.occurred_at) as at from public.order_events e
                   where e.org_id = o.org_id and e.order_id = o.id and e.event_type = 'ready') r on true
   where o.org_id = p_org and o.branch_id = any (p_branches) and o.order_status = 'completed'
     and o.business_date between p_from and p_to and s.at is not null and r.at > s.at
$$;
create index if not exists order_events_order_type_idx on public.order_events (org_id, order_id, event_type);

-- Median and p90 per branch, weekday and two-hour block (the slot a complaint is about).
create function private.m_service_slots(p_org uuid, p_branches uuid[], p_from date, p_to date)
returns table (branch_id uuid, weekday integer, from_hour integer, orders bigint, median_seconds numeric,
               p90_seconds numeric, net_poisha bigint)
language sql stable security definer set search_path = '' as $$
  select t.branch_id, t.weekday, (t.hour / 2) * 2, count(*),
         percentile_cont(0.5) within group (order by t.ticket_seconds)::numeric,
         percentile_cont(0.9) within group (order by t.ticket_seconds)::numeric,
         sum(t.net_poisha)::bigint
    from private.m_ticket_times(p_org, p_branches, p_from, p_to) t
   group by 1, 2, 3
$$;

-- ---------------------------------------------------------------------------------------------
-- Detectors
--   service.slow_slot — a weekday × two-hour slot whose median ticket time is ≥ 1.5 × the branch's
--     median (≥ 12 orders), with the complaints (feedback / reviews tagged slow_service) that match it.
--     Impact: the slot's net sales in the period — the sales exposed to slow service. (S11)
--   customers.lapse — regulars (≥ 4 visits in the 90 days before the period) who did not come back in the
--     period, when the branch's lapse rate is ≥ 30% and ≥ 2 × the other branches'. Evidence carries price
--     changes at the branch shortly before. Impact: their average monthly spend × the period in months. (S12)
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
    'lapse_min_visits', 4, 'lapse_min_regulars', 20, 'lapse_min_rate_bps', 3000, 'lapse_min_peer_ratio_x100', 200
  )
$$;

create function private.detect_service(p_org uuid, p_from date, p_to date)
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
         and extract(dow from r.reviewed_at at time zone 'Asia/Dhaka') = f.weekday
         and r.reviewed_at::date between p_from and p_to + 3
    ) rv on true
   where f.net >= cfg.min_impact
$$;

create function private.detect_lapse(p_org uuid, p_from date, p_to date)
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
                                                 'new_poisha', ph.new_price_poisha, 'date', (ph.changed_at at time zone 'Asia/Dhaka')::date)
                              order by ph.changed_at)
               from public.price_history ph join public.menu_items mi on mi.org_id = ph.org_id and mi.id = ph.menu_item_id
              where ph.org_id = p_org and (ph.branch_id = r.branch_id or ph.branch_id is null)
                and ph.old_price_poisha is not null and ph.new_price_poisha > ph.old_price_poisha
                and (ph.changed_at at time zone 'Asia/Dhaka')::date between p_from - 90 and p_to), '[]'::jsonb)),
         '["win_back_campaign", "review_price_change", "call_regulars"]'::jsonb
    from rated r cross join cfg
   where r.n >= cfg.min_regulars and r.rate >= cfg.min_rate
     and (r.peer is null or r.rate >= cfg.peer_ratio * r.peer)
     and round(r.lapsed_spend_90d / 3.0 * (p_to - p_from + 1) / 30.0) >= cfg.min_impact
$$;

create or replace function private.detect_all(p_org uuid, p_from date, p_to date, p_kinds text[])
returns table (
  type text, branch_id uuid, subject_key text, subject jsonb, impact_poisha bigint,
  confidence public.confidence_level, metric_refs jsonb, evidence jsonb, suggested_actions jsonb
) language sql stable security definer set search_path = '' as $$
  select * from private.detect_staff_anomalies(p_org, p_from, p_to) where 'staff' = any (p_kinds)
  union all select * from private.detect_cash_share(p_org, p_from, p_to) where 'cash_share' = any (p_kinds)
  union all select * from private.detect_over_short(p_org, p_from, p_to) where 'over_short' = any (p_kinds)
  union all select * from private.detect_commission_drag(p_org, p_from, p_to) where 'commission' = any (p_kinds)
  union all select * from private.detect_margin(p_org, p_from, p_to) where 'margin' = any (p_kinds)
  union all select * from private.detect_stock(p_org, p_from, p_to) where 'stock' = any (p_kinds)
  union all select * from private.detect_price(p_org, p_from, p_to) where 'price' = any (p_kinds)
  union all select * from private.detect_transfers(p_org, p_from, p_to) where 'transfer' = any (p_kinds)
  union all select * from private.detect_service(p_org, p_from, p_to) where 'service' = any (p_kinds)
  union all select * from private.detect_lapse(p_org, p_from, p_to) where 'customers' = any (p_kinds)
$$;

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
                                       array['staff', 'cash_share', 'over_short']);
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

-- The weekly day close also runs the service and customer detectors.
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
    v_weekly := private.save_findings(p_org, p_date - 6, p_date, array['staff', 'cash_share', 'over_short'])
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
-- Consent and sends. Marketing needs the latest WhatsApp marketing consent to be "granted"; an opt-out
-- keyword records a refusal. Caps: at most one marketing message in 7 days and three in 30.
-- ---------------------------------------------------------------------------------------------
create function private.marketing_ok(p_org uuid, p_customer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.granted from public.consents c
                    where c.org_id = p_org and c.customer_id = p_customer and c.channel = 'whatsapp' and c.purpose = 'marketing'
                    order by c.recorded_at desc, c.id desc limit 1), false)
$$;

create function private.capped(p_org uuid, p_customer uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) filter (where s.created_at > p_at - interval '7 days') >= 1
      or count(*) >= 3
    from public.campaign_sends s
   where s.org_id = p_org and s.customer_id = p_customer and not s.is_holdout and s.status <> 'suppressed'
     and s.created_at > p_at - interval '30 days'
$$;

-- STOP / বন্ধ from the WhatsApp webhook (service role): refuse marketing and transactional messages for
-- every customer with that number.
create function public.record_opt_out(p_phone text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := private.normalize_bd_phone(p_phone);
  v_n integer := 0;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_phone is null then return 0; end if;
  insert into public.consents (org_id, customer_id, channel, purpose, granted, source)
  select c.org_id, c.id, 'whatsapp', p.purpose, false, 'opt_out_keyword'
    from public.customers c cross join (values ('marketing'::public.consent_purpose), ('transactional')) p (purpose)
   where c.phone = v_phone;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.record_opt_out(text) from public, anon, authenticated;
grant execute on function public.record_opt_out(text) to service_role;

-- Who a campaign would reach today (before consent, caps and holdout):
--   thank_you: first visit yesterday · second_visit: first visit two days ago and not back yet
--   win_back: at risk now · custom: audience {segment, branch_id}. Never the same campaign twice to one
--   customer within 30 days (thank_you / second_visit: ever).
create function private.campaign_candidates(p_campaign uuid, p_asof date)
returns table (customer_id uuid)
language sql stable security definer set search_path = '' as $$
  with cp as (select * from public.campaigns where id = p_campaign),
  br as (select coalesce(array_agg(b.id), '{}') as ids from public.branches b, cp where b.org_id = cp.org_id
          and (nullif(cp.audience ->> 'branch_id', '') is null or b.id = (cp.audience ->> 'branch_id')::uuid)),
  c as (select m.* from cp, private.m_customers(cp.org_id, (select ids from br), p_asof) m)
  select c.customer_id from c, cp
   where case cp.kind
           when 'thank_you' then c.first_visit = p_asof - 1
           when 'second_visit' then c.first_visit = p_asof - 2 and c.visits = 1
           when 'win_back' then c.segment = 'at_risk'
           else coalesce(nullif(cp.audience ->> 'segment', ''), 'all') in ('all', c.segment)
         end
     and not exists (select 1 from public.campaign_sends s where s.org_id = cp.org_id and s.campaign_id = cp.id
                      and s.customer_id = c.customer_id
                      and (cp.kind in ('thank_you', 'second_visit') or s.created_at > (p_asof - 30)::timestamp))
$$;

create function public.approve_campaign(p_campaign uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.campaigns;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found or not private.has_role(c.org_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(nullif(btrim(c.body_bn), ''), nullif(btrim(c.body_en), '')) is null then
    raise exception 'write the message first' using errcode = 'invalid_parameter_value';
  end if;
  update public.campaigns set status = 'approved', approved_by = (select auth.uid()), approved_at = now() where id = p_campaign;
  perform private.write_audit(c.org_id, null, 'campaign.approve', 'campaign', p_campaign::text, null,
    jsonb_build_object('kind', c.kind, 'holdout_pct', c.holdout_pct, 'audience', c.audience), null, null, null);
end $$;

-- Run an approved campaign once: holdout by a stable hash of (campaign, customer); then consent; then caps;
-- the rest are queued in the WhatsApp outbox in the org's language. Every decision is a campaign_sends row.
create function public.run_campaign(p_campaign uuid, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.campaigns;
  v_asof date;
  v_lang text;
  x record;
  v_out uuid;
  v_sent integer := 0;
  v_hold integer := 0;
  v_consent integer := 0;
  v_cap integer := 0;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found or not (private.is_service_role() and c.auto_run
                       or private.has_role(c.org_id, array['owner', 'manager']::public.app_role[])) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if c.status not in ('approved', 'running') then
    raise exception 'approve the campaign first' using errcode = 'invalid_parameter_value';
  end if;
  v_asof := private.business_date(p_now, private.org_cutoff(c.org_id));
  v_lang := coalesce((select default_locale::text from public.org_settings where org_id = c.org_id), 'bn');
  for x in select * from private.campaign_candidates(p_campaign, v_asof) loop
    if ('x' || substr(md5(p_campaign::text || x.customer_id::text), 1, 8))::bit(32)::bigint % 100 < c.holdout_pct then
      insert into public.holdouts (org_id, campaign_id, customer_id) values (c.org_id, c.id, x.customer_id)
      on conflict (campaign_id, customer_id) do nothing;
      insert into public.campaign_sends (org_id, campaign_id, customer_id, status, is_holdout, reason, created_at)
      values (c.org_id, c.id, x.customer_id, 'suppressed', true, 'holdout', p_now);
      v_hold := v_hold + 1;
    elsif not private.marketing_ok(c.org_id, x.customer_id) then
      insert into public.campaign_sends (org_id, campaign_id, customer_id, status, reason, created_at)
      values (c.org_id, c.id, x.customer_id, 'suppressed', 'no_consent', p_now);
      v_consent := v_consent + 1;
    elsif private.capped(c.org_id, x.customer_id, p_now) then
      insert into public.campaign_sends (org_id, campaign_id, customer_id, status, reason, created_at)
      values (c.org_id, c.id, x.customer_id, 'suppressed', 'frequency_cap', p_now);
      v_cap := v_cap + 1;
    else
      v_out := null;
      insert into public.message_outbox (org_id, channel, to_phone, template_key, payload, idempotency_key, approved_by, approved_at)
      select c.org_id, 'whatsapp', cu.phone, 'campaign',
             jsonb_build_object('body', case when v_lang = 'en' then coalesce(c.body_en, c.body_bn) else coalesce(c.body_bn, c.body_en) end,
                                'language', v_lang),
             'campaign:' || c.id || ':' || x.customer_id || ':' || v_asof, c.approved_by, c.approved_at
        from public.customers cu where cu.org_id = c.org_id and cu.id = x.customer_id
      on conflict (org_id, idempotency_key) do nothing
      returning id into v_out;
      insert into public.campaign_sends (org_id, campaign_id, customer_id, status, outbox_id, sent_at, created_at)
      values (c.org_id, c.id, x.customer_id, 'queued', v_out, p_now, p_now);
      v_sent := v_sent + 1;
    end if;
  end loop;
  update public.campaigns set status = 'running', last_run_at = p_now where id = p_campaign;
  perform private.write_audit(c.org_id, null, 'campaign.run', 'campaign', p_campaign::text, null,
    jsonb_build_object('queued', v_sent, 'holdout', v_hold, 'no_consent', v_consent, 'capped', v_cap), null, null, null);
  return jsonb_build_object('queued', v_sent, 'holdout', v_hold, 'no_consent', v_consent, 'capped', v_cap);
end $$;

-- campaign.lift = return rate (treated) − return rate (holdout), within 30 days of the send / assignment;
-- n per group is always reported, and no claim is made below 30 in either group (METRICS.md).
create function public.metric_campaign_results(p_campaign uuid, p_now timestamptz)
returns table (group_name text, customers bigint, returned bigint, return_rate_bps integer, lift_bps integer, enough_data boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.campaigns;
  v_asof date;
begin
  select * into c from public.campaigns where id = p_campaign;
  if not found or not private.has_role(c.org_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_asof := private.business_date(p_now, private.org_cutoff(c.org_id));
  return query
    with s as (
      select case when x.is_holdout then 'holdout' else 'treated' end as g, x.customer_id,
             private.business_date(x.created_at, private.org_cutoff(c.org_id)) as sent_on
        from public.campaign_sends x
       where x.org_id = c.org_id and x.campaign_id = c.id and (x.is_holdout or x.status <> 'suppressed')
    ), r as (
      select s.g, s.customer_id,
             exists (select 1 from public.orders o where o.org_id = c.org_id and o.customer_id = s.customer_id
                      and o.order_status = 'completed' and o.business_date > s.sent_on
                      and o.business_date <= least(s.sent_on + 30, v_asof)) as back
        from s
    ), g as (
      select r.g, count(*) as n, count(*) filter (where r.back) as k from r group by r.g
    ), t as (select * from g where g.g = 'treated'), h as (select * from g where g.g = 'holdout')
    select g.g, g.n, g.k, round(g.k * 10000.0 / nullif(g.n, 0))::integer,
           case when g.g = 'treated' and (select n from h) > 0
                then round((select k * 10000.0 / n from t) - (select k * 10000.0 / n from h))::integer end,
           coalesce((select n from t), 0) >= 30 and coalesce((select n from h), 0) >= 30
      from g order by g.g desc;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Post-meal feedback. The job asks the service role for orders completed in the last three hours whose
-- customer consented to WhatsApp and was not asked in the last 7 days; each gets a token (only its hash is
-- stored) and a link. The public page submits through the service role.
-- ---------------------------------------------------------------------------------------------
create function public.job_feedback_requests(p_org uuid, p_now timestamptz)
returns table (feedback_id uuid, to_phone text, token text, lang text)
language plpgsql security definer set search_path = '' as $$
declare
  x record;
  v_token text;
  v_id uuid;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  for x in
    select distinct on (o.customer_id) o.id as order_id, o.branch_id, o.customer_id, cu.phone
      from public.orders o join public.customers cu on cu.org_id = o.org_id and cu.id = o.customer_id
     where o.org_id = p_org and o.order_status = 'completed' and o.placed_at between p_now - interval '3 hours' and p_now
       and private.marketing_ok(p_org, o.customer_id)
       and not exists (select 1 from public.feedback f where f.org_id = p_org and f.customer_id = o.customer_id
                        and f.sent_at > p_now - interval '7 days')
       and not exists (select 1 from public.feedback f where f.org_id = p_org and f.order_id = o.id)
     order by o.customer_id, o.placed_at desc
  loop
    v_token := encode(extensions.gen_random_bytes(18), 'hex');
    insert into public.feedback (org_id, branch_id, order_id, customer_id, token_hash, sent_at)
    values (p_org, x.branch_id, x.order_id, x.customer_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_now)
    returning id into v_id;
    feedback_id := v_id;
    to_phone := x.phone;
    token := v_token;
    lang := coalesce((select default_locale::text from public.org_settings where org_id = p_org), 'bn');
    return next;
  end loop;
end $$;

create function public.submit_feedback(p_token text, p_rating integer, p_comment text, p_now timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  f public.feedback;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_rating is null or p_rating < 0 or p_rating > 10 then return false; end if;
  select * into f from public.feedback
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
  if not found or f.submitted_at is not null or f.sent_at < p_now - interval '14 days' then return false; end if;
  update public.feedback set rating = p_rating, comment = left(nullif(btrim(p_comment), ''), 1000), submitted_at = p_now
   where id = f.id;
  return true;
end $$;
revoke execute on function public.job_feedback_requests(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.job_feedback_requests(uuid, timestamptz) to service_role;
revoke execute on function public.submit_feedback(text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_feedback(text, integer, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Reviews: replies are drafted (by a person or the AI) and approved by the owner or a manager before
-- anyone posts them (CLAUDE.md #4); what happened around a review, from the operations data.
-- ---------------------------------------------------------------------------------------------
create function public.approve_review_reply(p_reply uuid, p_body text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.review_replies;
begin
  select * into r from public.review_replies where id = p_reply for update;
  if not found or not private.has_role(r.org_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if r.status <> 'draft' then
    raise exception 'this reply was already reviewed' using errcode = 'invalid_parameter_value';
  end if;
  update public.review_replies
     set draft_body = coalesce(nullif(btrim(p_body), ''), draft_body), status = 'approved',
         approved_by = (select auth.uid()), approved_at = now()
   where id = p_reply;
  perform private.write_audit(r.org_id, null, 'review.reply_approve', 'review_reply', p_reply::text,
    jsonb_build_object('draft', r.draft_body), jsonb_build_object('body', coalesce(nullif(btrim(p_body), ''), r.draft_body)),
    null, null, null);
end $$;

create function public.metric_review_context(p_review uuid)
returns table (business_date date, orders bigint, median_ticket_seconds numeric, branch_median_ticket_seconds numeric,
               staff_on_duty text[], items_mentioned text[], feedback_low bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reviews;
  v_day date;
  v_ids uuid[];
begin
  select * into r from public.reviews where id = p_review;
  if not found or not private.has_role(r.org_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_day := private.business_date(coalesce(r.reviewed_at, r.created_at), private.org_cutoff(r.org_id));
  v_ids := case when r.branch_id is not null then array[r.branch_id]
                else (select array_agg(b.id) from public.branches b where b.org_id = r.org_id) end;
  return query
    with t as (select * from private.m_ticket_times(r.org_id, v_ids, v_day - 27, v_day))
    select v_day,
           (select count(*) from public.orders o where o.org_id = r.org_id and o.branch_id = any (v_ids)
             and o.business_date = v_day and o.order_status = 'completed'),
           (select round(percentile_cont(0.5) within group (order by t.ticket_seconds)::numeric) from t where t.business_date = v_day),
           (select round(percentile_cont(0.5) within group (order by t.ticket_seconds)::numeric) from t),
           coalesce((select array_agg(distinct s.display_name) from public.shifts sh
                      join public.staff s on s.org_id = sh.org_id and s.id = sh.opened_by_staff_id
                     where sh.org_id = r.org_id and sh.branch_id = any (v_ids) and sh.business_date = v_day), '{}'),
           coalesce((select array_agg(mi.name order by mi.name) from public.menu_items mi
                      where mi.org_id = r.org_id and length(mi.name) >= 4
                        and (r.body ilike '%' || mi.name || '%' or (mi.name_bn is not null and r.body ilike '%' || mi.name_bn || '%'))), '{}'),
           (select count(*) from public.feedback f where f.org_id = r.org_id and f.branch_id = any (v_ids)
             and f.rating <= 6 and f.submitted_at is not null
             and private.business_date(f.submitted_at, private.org_cutoff(r.org_id)) between v_day - 6 and v_day);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------------------------
-- Counts only (no PII): owner, manager, accountant.
create function public.metric_customer_summary(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (orders_30d bigint, identified_30d bigint, identified_share_bps integer, first_timers bigint,
               returned_30d bigint, returned_60d bigint, first_return_30d_bps integer, first_return_60d_bps integer,
               segments jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := private.metric_scope(p_org, p_branch);
begin
  if not private.is_service_role() and not private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query select * from private.m_customer_summary(p_org, v_scope, private.business_date(p_now, private.org_cutoff(p_org)));
end $$;

-- The list: customers are PII, so owner and manager only (RLS on customers says the same).
create function public.metric_customers(p_org uuid, p_branch uuid, p_now timestamptz, p_segment text default null,
                                        p_limit integer default 100)
returns table (customer_id uuid, phone text, name text, branch_id uuid, first_visit date, last_visit date, visits bigint,
               visits_90d bigint, spend_90d_poisha bigint, days_since integer, segment text, r integer, f integer, m integer,
               marketing_ok boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.customer_id, cu.phone, cu.name, c.branch_id, c.first_visit, c.last_visit, c.visits, c.visits_90d,
           c.spend_90d_poisha, c.days_since, c.segment, c.r, c.f, c.m, private.marketing_ok(p_org, c.customer_id)
      from private.m_customers(p_org, private.metric_scope(p_org, p_branch),
                               private.business_date(p_now, private.org_cutoff(p_org))) c
      join public.customers cu on cu.org_id = p_org and cu.id = c.customer_id
     where p_segment is null or c.segment = p_segment
     order by c.spend_90d_poisha desc, c.last_visit desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create function public.metric_service_slots(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (branch_id uuid, weekday integer, from_hour integer, orders bigint, median_seconds numeric,
               p90_seconds numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'pick a range of at most three months' using errcode = 'invalid_parameter_value';
  end if;
  return query
    select s.branch_id, s.weekday, s.from_hour, s.orders, round(s.median_seconds), round(s.p90_seconds)
      from private.m_service_slots(p_org, private.metric_scope(p_org, p_branch), p_from, p_to) s;
end $$;

-- rating.avg by source and feedback.score: average 0–10 and share(9–10) − share(0–6).
create function public.metric_ratings(p_org uuid, p_branch uuid, p_from date, p_to date)
returns table (source text, n bigint, avg_rating numeric, promoters_bps integer, detractors_bps integer, net_bps integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := private.metric_scope(p_org, p_branch);
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    with x as (
      select 'feedback'::text as src, f.rating::numeric as rating from public.feedback f
       where f.org_id = p_org and f.branch_id = any (v_scope) and f.submitted_at is not null and f.rating is not null
         and private.business_date(f.submitted_at, private.org_cutoff(p_org)) between p_from and p_to
      union all
      select r.source::text, r.rating from public.reviews r
       where r.org_id = p_org and (r.branch_id is null or r.branch_id = any (v_scope)) and r.rating is not null
         and private.business_date(coalesce(r.reviewed_at, r.created_at), private.org_cutoff(p_org)) between p_from and p_to
    )
    select x.src, count(*), round(avg(x.rating), 1),
           round(10000.0 * count(*) filter (where x.rating >= 9) / count(*))::integer,
           round(10000.0 * count(*) filter (where x.rating <= 6) / count(*))::integer,
           round(10000.0 * (count(*) filter (where x.rating >= 9) - count(*) filter (where x.rating <= 6)) / count(*))::integer
      from x group by x.src order by 2 desc;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname in ('text_themes', 'tag_themes', 'm_customers', 'm_customer_summary',
              'm_ticket_times', 'm_service_slots', 'detect_service', 'detect_lapse', 'marketing_ok', 'capped',
              'campaign_candidates'))
        or (n.nspname = 'public' and p.proname in ('approve_campaign', 'run_campaign', 'metric_campaign_results',
              'approve_review_reply', 'metric_review_context', 'metric_customer_summary', 'metric_customers',
              'metric_service_slots', 'metric_ratings'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

comment on function public.run_campaign is 'Runs an approved campaign once: holdout, consent, caps, then the outbox; audited. Phase 8.';
comment on function public.metric_campaign_results is 'campaign.lift vs holdout, with n per group; no claim below 30 each. Phase 8.';
comment on function public.metric_customers is 'Customers with RFM and segment (PII: owner/manager). Phase 8.';

-- Feedback links go out every 30 minutes (UTC schedule; the job route claims per 10-minute slot).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('xedine-feedback-requests', '*/30 * * * *', $cmd$select private.dispatch_job('feedback_requests')$cmd$);
    exception when others then
      raise notice 'could not create the pg_cron schedule: %', sqlerrm;
    end;
  end if;
end $$;
