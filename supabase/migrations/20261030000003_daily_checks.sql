-- ADR 0043 (3/3): daily compliance checks. A restaurant's own list of hygiene tasks, inspection records and
-- paperwork, each due every day, week or month; what nobody recorded shows up as missing.
--
-- The list is the restaurant's. The starter list is a suggestion to edit, never a statement of what the law
-- requires. TODO(verify) the starter list against BFSA guidance with a food-safety adviser.

create table public.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null constraint compliance_checks_name check (length(btrim(name)) between 1 and 120),
  name_bn text constraint compliance_checks_name_bn check (name_bn is null or length(name_bn) <= 120),
  category text not null default 'hygiene' constraint compliance_checks_category check (category in ('hygiene', 'inspection', 'document')),
  frequency text not null default 'daily' constraint compliance_checks_frequency check (frequency in ('daily', 'weekly', 'monthly')),
  -- The record is a reading or a reference ("fridge 3°C", "report no. 118"), so a tick alone is not enough.
  needs_note boolean not null default false,
  is_active boolean not null default true,
  -- Nothing before this day can be "missing".
  starts_on date not null default ((now() at time zone 'Asia/Dhaka')::date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create unique index compliance_checks_org_name on public.compliance_checks (org_id, lower(name));
create trigger compliance_checks_touch before update on public.compliance_checks
  for each row execute function private.touch_updated_at();
create trigger compliance_checks_audit after insert or update or delete on public.compliance_checks
  for each row execute function private.audit_row_change('compliance_check');

create table public.compliance_check_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  check_id uuid not null,
  -- The first day of the day, week or month this record is for.
  period_start date not null,
  status text not null default 'done' constraint compliance_check_logs_status check (status in ('done', 'problem')),
  note text constraint compliance_check_logs_note check (note is null or length(note) <= 500),
  -- Written after its day, week or month had ended.
  late boolean not null default false,
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, branch_id, check_id, period_start),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, check_id) references public.compliance_checks (org_id, id) on delete cascade
);
create index compliance_check_logs_check_idx on public.compliance_check_logs (org_id, check_id);

alter table public.incidents
  add constraint incidents_check_log_fk foreign key (org_id, check_log_id)
  references public.compliance_check_logs (org_id, id) on delete set null (check_log_id);

do $$
declare
  v_read public.app_role[] := array['owner', 'manager', 'kitchen', 'accountant']::public.app_role[];
begin
  perform private.apply_policies('compliance_checks', 'org', v_read, array['owner', 'manager']::public.app_role[], false,
    'the restaurant''s own list; switched off, never deleted, so old records keep their meaning');
  perform private.apply_policies('compliance_check_logs', 'branch', v_read, '{}'::public.app_role[], false,
    'written by record_compliance_check only (audited)');
end $$;
comment on table public.compliance_checks is
  'What this restaurant checks and how often: hygiene tasks, inspection records, paperwork. | written by: compliance | phase: 11';
comment on table public.compliance_check_logs is
  'One record per branch, check and day/week/month: done or a problem, by whom, and when. | written by: compliance | phase: 11';

-- The first day of the period holding p_date.
create function private.check_period_start(p_frequency text, p_date date, p_week_start integer) returns date
language sql immutable set search_path = '' as $$
  select case p_frequency
           when 'weekly' then p_date - ((extract(dow from p_date)::integer - p_week_start + 7) % 7)
           when 'monthly' then date_trunc('month', p_date)::date
           else p_date end
$$;

create function private.check_period_end(p_frequency text, p_start date) returns date
language sql immutable set search_path = '' as $$
  select case p_frequency
           when 'weekly' then p_start + 6
           when 'monthly' then (p_start + interval '1 month - 1 day')::date
           else p_start end
$$;

-- check.status: every check at every branch for each period touching the last p_days business days.
-- done / problem as recorded; otherwise due while the period is still running, missing once it has ended.
create function private.m_daily_checks(p_org uuid, p_branches uuid[], p_now timestamptz, p_days integer)
returns table (branch_id uuid, check_id uuid, name text, name_bn text, category text, frequency text, needs_note boolean,
               period_start date, period_end date, is_current boolean, state text, note text, recorded_at timestamptz,
               late boolean, as_of date)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce((select s.week_start from public.org_settings s where s.org_id = p_org), 6)::integer as ws
  ), br as (
    select u as branch_id, private.business_date(p_now, private.branch_cutoff(p_org, u)) as today
      from unnest(p_branches) u
  ), periods as (
    select distinct b.branch_id, b.today, c.id as check_id,
           private.check_period_start(c.frequency, g::date, cfg.ws) as p_start
      from br b
     cross join cfg
      join public.compliance_checks c on c.org_id = p_org and c.is_active
     cross join lateral generate_series(b.today - (p_days - 1), b.today, interval '1 day') g
  )
  select p.branch_id, c.id, c.name, c.name_bn, c.category, c.frequency, c.needs_note, p.p_start,
         private.check_period_end(c.frequency, p.p_start),
         private.check_period_end(c.frequency, p.p_start) >= p.today,
         coalesce(l.status,
                  case when private.check_period_end(c.frequency, p.p_start) >= p.today then 'due' else 'missing' end),
         l.note, l.recorded_at, coalesce(l.late, false), p.today
    from periods p
    join public.compliance_checks c on c.org_id = p_org and c.id = p.check_id
    left join public.compliance_check_logs l on l.org_id = p_org and l.branch_id = p.branch_id
     and l.check_id = c.id and l.period_start = p.p_start
   where private.check_period_end(c.frequency, p.p_start) >= c.starts_on
$$;

create function private.check_scope(p_org uuid, p_branch uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid[] := private.metric_scope(p_org, p_branch);
begin
  if private.is_service_role() then return v; end if;
  select coalesce(array_agg(b), '{}') into v from unnest(v) as b
   where private.can_access_branch_role(p_org, b, array['owner', 'manager', 'kitchen', 'accountant']::public.app_role[]);
  if cardinality(v) = 0 then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return v;
end $$;

create function public.metric_daily_checks(p_org uuid, p_branch uuid, p_now timestamptz, p_days integer default 7)
returns table (branch_id uuid, check_id uuid, name text, name_bn text, category text, frequency text, needs_note boolean,
               period_start date, period_end date, is_current boolean, state text, note text, recorded_at timestamptz,
               late boolean, as_of date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_days is null or p_days < 1 or p_days > 31 then
    raise exception 'pick 1 to 31 days' using errcode = 'invalid_parameter_value';
  end if;
  return query
    select m.* from private.m_daily_checks(p_org, private.check_scope(p_org, p_branch), p_now, p_days) m
     order by m.is_current desc, m.period_start desc,
              case m.state when 'missing' then 0 when 'due' then 1 when 'problem' then 2 else 3 end, m.name;
end $$;

-- check.summary per branch: this period's counts, what went missing, and check.score over finished
-- periods (recorded ÷ all that were due; a problem honestly recorded counts as recorded).
create function public.metric_daily_checks_summary(p_org uuid, p_branch uuid, p_now timestamptz, p_days integer default 7)
returns table (branch_id uuid, due_now bigint, done_now bigint, problems_now bigint, missing bigint, score_bps integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_days is null or p_days < 1 or p_days > 31 then
    raise exception 'pick 1 to 31 days' using errcode = 'invalid_parameter_value';
  end if;
  return query
    select m.branch_id,
           count(*) filter (where m.is_current and m.state = 'due'),
           count(*) filter (where m.is_current and m.state = 'done'),
           count(*) filter (where m.is_current and m.state = 'problem'),
           count(*) filter (where m.state = 'missing'),
           case when count(*) filter (where not m.is_current) > 0
                then round(count(*) filter (where not m.is_current and m.state in ('done', 'problem')) * 10000.0
                           / count(*) filter (where not m.is_current))::integer end
      from private.m_daily_checks(p_org, private.check_scope(p_org, p_branch), p_now, p_days) m
     group by m.branch_id
     order by m.branch_id;
end $$;

-- One record per check and period; recording again corrects it (audited, before and after). A date up to 7
-- days back fills a gap, marked late. A problem always needs words, and opens a case once.
create function public.record_compliance_check(
  p_org uuid, p_branch uuid, p_check uuid, p_status text, p_note text default null, p_date date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.compliance_checks;
  v_today date := private.business_date(now(), private.branch_cutoff(p_org, p_branch));
  v_date date := coalesce(p_date, v_today);
  v_ws integer := coalesce((select s.week_start from public.org_settings s where s.org_id = p_org), 6);
  v_period date;
  v_note text := left(nullif(btrim(p_note), ''), 500);
  v_old public.compliance_check_logs;
  v_id uuid;
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager', 'kitchen']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.compliance_checks where org_id = p_org and id = p_check and is_active;
  if not found then
    raise exception 'unknown check' using errcode = 'invalid_parameter_value';
  end if;
  if p_status not in ('done', 'problem') then
    raise exception 'unknown status' using errcode = 'invalid_parameter_value';
  end if;
  if v_date > v_today or v_date < v_today - 7 then
    raise exception 'check_date_out_of_range' using errcode = 'invalid_parameter_value';
  end if;
  if v_note is null and (p_status = 'problem' or c.needs_note) then
    raise exception 'check_needs_note' using errcode = 'invalid_parameter_value';
  end if;
  v_period := private.check_period_start(c.frequency, v_date, v_ws);
  select * into v_old from public.compliance_check_logs
   where org_id = p_org and branch_id = p_branch and check_id = p_check and period_start = v_period;
  insert into public.compliance_check_logs (org_id, branch_id, check_id, period_start, status, note, late, recorded_by)
  values (p_org, p_branch, p_check, v_period, p_status, v_note,
    private.check_period_end(c.frequency, v_period) < v_today, (select auth.uid()))
  on conflict (org_id, branch_id, check_id, period_start) do update
    set status = excluded.status, note = excluded.note, late = excluded.late,
        recorded_by = excluded.recorded_by, recorded_at = now()
  returning id into v_id;
  perform private.write_audit(p_org, p_branch, 'compliance.check', 'compliance_check_log', v_id::text,
    case when v_old.id is null then null else jsonb_build_object('status', v_old.status, 'note', v_old.note) end,
    jsonb_build_object('check_id', p_check, 'period_start', v_period, 'status', p_status, 'note', v_note), null, null, null);
  if p_status = 'problem' and not exists (
    select 1 from public.incidents i where i.org_id = p_org and i.check_log_id = v_id
  ) then
    perform private.create_incident(p_org, p_branch, 'hygiene', 'medium', 'daily_check', c.name, v_note, v_date, null,
      null, null, null, v_id, null, null, false);
  end if;
  return v_id;
end $$;

-- A starter list to edit. Adding it twice changes nothing. Suggestions, not a statement of the law.
create function public.add_starter_compliance_checks(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into public.compliance_checks (org_id, name, name_bn, category, frequency, needs_note)
  select p_org, x.* from (values
    ('Kitchen floor and counters cleaned', 'রান্নাঘরের মেঝে ও কাউন্টার পরিষ্কার', 'hygiene', 'daily', false),
    ('Soap at every hand-wash point', 'হাত ধোয়ার জায়গায় সাবান আছে', 'hygiene', 'daily', false),
    ('Staff in clean clothes, hair covered', 'স্টাফের পোশাক পরিষ্কার, চুল ঢাকা', 'hygiene', 'daily', false),
    ('Bins emptied and washed', 'ময়লার ঝুড়ি খালি ও ধোয়া', 'hygiene', 'daily', false),
    ('Fridge temperature written down', 'ফ্রিজের তাপমাত্রা লেখা', 'inspection', 'daily', true),
    ('Freezer temperature written down', 'ফ্রিজারের তাপমাত্রা লেখা', 'inspection', 'daily', true),
    ('Raw and cooked food kept apart', 'কাঁচা ও রান্না খাবার আলাদা রাখা', 'inspection', 'daily', false),
    ('Grease trap and drains cleaned', 'গ্রিজ ট্র্যাপ ও ড্রেন পরিষ্কার', 'hygiene', 'weekly', false),
    ('Pest control done', 'পোকামাকড় দমন করা হয়েছে', 'document', 'monthly', true),
    ('Water tank or filter cleaned', 'পানির ট্যাংক বা ফিল্টার পরিষ্কার', 'document', 'monthly', true)
  ) as x (name, name_bn, category, frequency, needs_note)
  on conflict (org_id, lower(name)) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- One line for the owner's morning message (service role).
create function public.job_safety_summary(p_org uuid, p_now timestamptz)
returns table (business_date date, blocked_items bigint, missed_checks bigint, overdue_actions bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_branches uuid[];
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(array_agg(b.id), '{}') into v_branches from public.branches b where b.org_id = p_org;
  return query
    select v_today,
           (select count(*) from unnest(v_branches) u
             cross join lateral private.m_blocked_ingredients(p_org, u,
               private.business_date(p_now, private.branch_cutoff(p_org, u)))),
           -- Yesterday's records only: the morning message is about the day that just ended.
           (select count(*) from private.m_daily_checks(p_org, v_branches, p_now, 2) m
             where m.state = 'missing' and m.period_end = v_today - 1),
           (select count(*) from public.incident_actions a
             where a.org_id = p_org and a.kind = 'corrective' and a.done_at is null and a.due_on < v_today);
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('check_period_start', 'check_period_end', 'm_daily_checks', 'check_scope')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('metric_daily_checks', 'metric_daily_checks_summary', 'record_compliance_check',
                         'add_starter_compliance_checks')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
revoke execute on function public.job_safety_summary(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.job_safety_summary(uuid, timestamptz) to service_role;

comment on function public.metric_daily_checks is 'check.status: each check per branch and period: done, problem, due or missing. ADR 0043.';
comment on function public.metric_daily_checks_summary is 'check.summary and check.score per branch. ADR 0043.';
comment on function public.record_compliance_check is 'Records a check as done or a problem (a problem opens a case once); audited. ADR 0043.';
comment on function public.add_starter_compliance_checks is 'Adds an editable starter list; suggestions, not the law (TODO verify). ADR 0043.';
comment on function public.job_safety_summary is 'Morning message counts: blocked items, checks missed yesterday, overdue actions (service role). ADR 0043.';
