-- Settings → Usage (owner/accountant): how much of each day's AI allowance was used, today and the days
-- before, like a usage-limit meter. The allowance is the LLM gateway's daily cap per restaurant
-- (AI_DAILY_CAP_USD_MICROS, src/lib/llm-gateway); the app passes that same number in, so the meter and the
-- gateway that refuses calls read one figure. Days are counted exactly as the gateway counts them: the
-- Dhaka business date with the 04:00 cutoff (businessDate(now()) with its defaults), and the allowance
-- resets at the next 04:00 Dhaka time. METRICS.md "AI allowance used".
create function public.metric_ai_usage(p_org uuid, p_now timestamptz, p_cap_usd_micros bigint,
                                       p_days integer default 7)
returns table (usage_date date, requests bigint, used_pct integer, is_today boolean, resets_at timestamptz,
               ai_allowed boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.business_date(p_now, 240);
begin
  if not private.is_service_role() and not private.has_role(p_org, array['owner', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_cap_usd_micros is null or p_cap_usd_micros <= 0 or p_days is null or p_days not between 1 and 31 then
    raise exception 'bad cap or days' using errcode = 'invalid_parameter_value';
  end if;
  return query
    with days as (select v_today - g as d from generate_series(0, p_days - 1) g)
    select days.d,
           coalesce(sum(u.requests), 0)::bigint,
           -- Share of the allowance spent, rounded down; the last call of a day can pass the cap, so at most 100.
           least(100, floor(coalesce(sum(u.cost_usd_micros), 0) * 100.0 / p_cap_usd_micros))::integer,
           days.d = v_today,
           ((v_today + 1)::timestamp + interval '4 hours') at time zone 'Asia/Dhaka',
           private.plan_allows(p_org, 'ai', p_now)
      from days
      left join public.ai_usage u on u.org_id = p_org and u.usage_date = days.d
     group by days.d
     order by days.d;
end $$;

revoke execute on function public.metric_ai_usage(uuid, timestamptz, bigint, integer) from public, anon;
grant execute on function public.metric_ai_usage(uuid, timestamptz, bigint, integer) to authenticated, service_role;
comment on function public.metric_ai_usage is
  'Per business day: AI requests and the share of the daily AI allowance used, when it resets, whether the plan includes AI (owner/accountant).';
