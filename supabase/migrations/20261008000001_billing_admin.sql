-- Phase 10 (3/N) — plans, limits, billing view and the platform admin console (ROADMAP Phase 10, PRODUCT.md
-- M18, ADR 0008 prices, ADR 0023). The payment provider is still to be chosen: subscriptions are set by a
-- platform admin (invoice + bank/bKash) until then. What a plan includes is enforced in SQL and in the
-- gateways (AI, WhatsApp), never only in the UI.

-- What each plan includes (ADR 0008): Starter has no AI and no WhatsApp; Growth and Chain have both.
update public.plans set limits = limits || '{"whatsapp": false}'::jsonb where code = 'starter';
update public.plans set limits = limits || '{"whatsapp": true}'::jsonb where code in ('growth', 'chain');

-- Platform operators. Service-only: no client can read or write it; rows are added by hand (Run by hand).
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
select private.register_table('platform_admins', 'service_only', 'platform operators; granted by hand');
comment on table public.platform_admins is 'Xedine platform operators (admin console). | written by: billing | phase: 10';

create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()))
$$;

-- The effective plan. No subscription yet = a 30-day Growth trial from the org's creation (ADR 0023 §5);
-- the demo orgs count as active Growth so the demo never expires.
create function private.org_plan(p_org uuid, p_now timestamptz)
returns table (plan_code text, plan_name text, status text, trial_ends date, branches bigint,
               price_per_branch_poisha bigint, pilot_discount_bps integer, limits jsonb, period_end date)
language sql stable security definer set search_path = '' as $$
  with o as (select * from public.organizations where id = p_org),
  s as (select * from public.subscriptions x where x.org_id = p_org order by x.created_at desc, x.id limit 1),
  eff as (
    select coalesce((select plan_id from s), (select id from public.plans where code = 'growth')) as plan_id,
           case
             when exists (select 1 from s) then
               case when (select status from s) = 'trialing'
                         and (select started_at from s) + interval '30 days' < p_now then 'trial_expired'
                    else (select status::text from s) end
             when (select slug from o) like 'demo-%' then 'active'
             when (select created_at from o) + interval '30 days' >= p_now then 'trialing'
             else 'trial_expired'
           end as status,
           case when exists (select 1 from s) then ((select started_at from s) + interval '30 days')::date
                else ((select created_at from o) + interval '30 days')::date end as trial_ends
  )
  select p.code, p.name, eff.status,
         case when eff.status in ('trialing', 'trial_expired') then eff.trial_ends end,
         (select count(*) from public.branches b where b.org_id = p_org),
         p.price_poisha_per_branch_month, coalesce((select pilot_discount_bps from s), 0), p.limits,
         (select current_period_end::date from s)
    from eff join public.plans p on p.id = eff.plan_id
$$;

create function private.plan_allows(p_org uuid, p_feature text, p_now timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select x.status in ('trialing', 'active', 'past_due') and coalesce((x.limits ->> p_feature)::boolean, false)
                     from private.org_plan(p_org, p_now) x), false)
$$;

-- For the gateways (service role).
create function public.org_ai_allowed(p_org uuid, p_now timestamptz) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return private.plan_allows(p_org, 'ai', p_now);
end $$;

create function public.org_whatsapp_allowed(p_org uuid, p_now timestamptz) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return private.plan_allows(p_org, 'whatsapp', p_now);
end $$;
revoke execute on function public.org_ai_allowed(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.org_ai_allowed(uuid, timestamptz) to service_role;
revoke execute on function public.org_whatsapp_allowed(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.org_whatsapp_allowed(uuid, timestamptz) to service_role;

-- The owner's billing view: plan, status, what next month costs, and this month's usage.
create function public.metric_billing(p_org uuid, p_now timestamptz)
returns table (plan_code text, plan_name text, status text, trial_ends date, branches bigint,
               price_per_branch_poisha bigint, pilot_discount_bps integer, monthly_amount_poisha bigint,
               ai_included boolean, whatsapp_included boolean, ai_requests_month bigint, messages_month bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_month date;
begin
  if not private.is_service_role() and not private.has_role(p_org, array['owner', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_month := date_trunc('month', private.business_date(p_now, private.org_cutoff(p_org)))::date;
  return query
    select x.plan_code, x.plan_name, x.status, x.trial_ends, x.branches, x.price_per_branch_poisha,
           x.pilot_discount_bps,
           -- branches × price × (1 − discount), rounded half up once (ADR 0005 style).
           round(x.branches * x.price_per_branch_poisha * (10000 - x.pilot_discount_bps) / 10000.0)::bigint,
           coalesce((x.limits ->> 'ai')::boolean, false), coalesce((x.limits ->> 'whatsapp')::boolean, false),
           (select coalesce(sum(u.requests), 0)::bigint from public.ai_usage u
             where u.org_id = p_org and u.usage_date >= v_month),
           (select count(*) from public.message_outbox m
             where m.org_id = p_org and m.created_at >= v_month::timestamp at time zone 'Asia/Dhaka')
      from private.org_plan(p_org, p_now) x;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Admin console (platform admins only). Operational metadata only — no tenant sales, costs or customers
-- (ARCHITECTURE.md: platform admins have no tenant data access by default).
-- ---------------------------------------------------------------------------------------------
create function public.admin_orgs(p_now timestamptz)
returns table (org_id uuid, name text, slug text, created_at timestamptz, branches bigint, plan_code text,
               status text, trial_ends date, pilot_discount_bps integer, active_days_30 bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select o.id, o.name, o.slug, o.created_at, p.branches, p.plan_code, p.status, p.trial_ends, p.pilot_discount_bps,
           (select count(distinct x.business_date) from public.orders x
             where x.org_id = o.id and x.order_status = 'completed' and x.placed_at > p_now - interval '30 days')
      from public.organizations o cross join lateral private.org_plan(o.id, p_now) p
     order by o.created_at desc;
end $$;

create function public.admin_set_subscription(p_org uuid, p_plan text, p_status public.subscription_status,
                                              p_discount_bps integer, p_period_end date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_plan uuid;
  v_before jsonb;
begin
  if not private.is_platform_admin() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id into v_plan from public.plans where code = p_plan and is_active;
  if v_plan is null or p_discount_bps is null or p_discount_bps not between 0 and 10000 then
    raise exception 'unknown plan or bad discount' using errcode = 'invalid_parameter_value';
  end if;
  select to_jsonb(s) into v_before from public.subscriptions s where s.org_id = p_org order by s.created_at desc limit 1;
  insert into public.subscriptions (org_id, plan_id, status, branches_count, pilot_discount_bps, current_period_end)
  values (p_org, v_plan, p_status, greatest(1, (select count(*) from public.branches b where b.org_id = p_org)::integer),
          p_discount_bps, p_period_end::timestamp at time zone 'Asia/Dhaka');
  perform private.write_audit(p_org, null, 'subscription.set', 'subscription', p_org::text, v_before,
    jsonb_build_object('plan', p_plan, 'status', p_status, 'pilot_discount_bps', p_discount_bps, 'period_end', p_period_end),
    'platform admin');
end $$;

create function public.am_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin()
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname in ('is_platform_admin', 'org_plan', 'plan_allows'))
        or (n.nspname = 'public' and p.proname in ('metric_billing', 'admin_orgs', 'admin_set_subscription',
              'am_platform_admin'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

comment on function public.metric_billing is 'Plan, status, next month''s amount and this month''s usage (owner/accountant). Phase 10.';
comment on function public.admin_orgs is 'Platform admin list of orgs with plan status; metadata only. Phase 10.';
comment on function public.admin_set_subscription is 'Platform admin sets plan/status/discount; audited. Phase 10.';
