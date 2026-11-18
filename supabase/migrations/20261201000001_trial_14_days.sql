-- The free trial is 14 days (the founder, 2026-11-19, with the home page's pricing). Restaurants that signed up
-- before the change keep the 30 days they were promised. Same function as 20261008000001, only the length.
create or replace function private.org_plan(p_org uuid, p_now timestamptz)
returns table (plan_code text, plan_name text, status text, trial_ends date, branches bigint,
               price_per_branch_poisha bigint, pilot_discount_bps integer, limits jsonb, period_end date)
language sql stable security definer set search_path = '' as $$
  with o as (select * from public.organizations where id = p_org),
  s as (select * from public.subscriptions x where x.org_id = p_org order by x.created_at desc, x.id limit 1),
  len as (
    select case when (select created_at from o) < timestamptz '2026-11-19 00:00:00+06'
                then interval '30 days' else interval '14 days' end as trial
  ),
  eff as (
    select coalesce((select plan_id from s), (select id from public.plans where code = 'growth')) as plan_id,
           case
             when exists (select 1 from s) then
               case when (select status from s) = 'trialing'
                         and (select started_at from s) + (select trial from len) < p_now then 'trial_expired'
                    else (select status::text from s) end
             when (select slug from o) like 'demo-%' then 'active'
             when (select created_at from o) + (select trial from len) >= p_now then 'trialing'
             else 'trial_expired'
           end as status,
           case when exists (select 1 from s) then ((select started_at from s) + (select trial from len))::date
                else ((select created_at from o) + (select trial from len))::date end as trial_ends
  )
  select p.code, p.name, eff.status,
         case when eff.status in ('trialing', 'trial_expired') then eff.trial_ends end,
         (select count(*) from public.branches b where b.org_id = p_org),
         p.price_poisha_per_branch_month, coalesce((select pilot_discount_bps from s), 0), p.limits,
         (select current_period_end::date from s)
    from eff join public.plans p on p.id = eff.plan_id
$$;
