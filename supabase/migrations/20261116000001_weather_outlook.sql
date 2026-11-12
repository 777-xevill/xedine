-- The outlook (ADR 0051): weather for each branch from MET Norway's free forecast, stored hourly, so the Plan
-- page, the briefs and the "rain soon" alert read one place; rainy days are flagged on the calendar by the
-- weather job, so the forecast's learned rain effect (ADR 0020 §2) applies without anyone pressing "Rain".

-- Where a branch is, for its weather. Null = the job uses the branch's area or city (src/modules/forecasting/
-- outlook.ts), else Dhaka. Only the owner sets it, through set_branch_location (audited).
alter table public.branches
  add column latitude numeric(7, 4) constraint branches_latitude check (latitude between -90 and 90),
  add column longitude numeric(7, 4) constraint branches_longitude check (longitude between -180 and 180),
  add constraint branches_location_pair check ((latitude is null) = (longitude is null));

create function public.set_branch_location(p_org uuid, p_branch uuid, p_lat numeric, p_lon numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'only the owner sets a branch location' using errcode = 'insufficient_privilege';
  end if;
  if (p_lat is null) <> (p_lon is null)
     or (p_lat is not null and (p_lat not between -90 and 90 or p_lon not between -180 and 180)) then
    raise exception 'give both latitude and longitude, or neither' using errcode = 'invalid_parameter_value';
  end if;
  select jsonb_build_object('latitude', latitude, 'longitude', longitude) into v_before
    from public.branches where org_id = p_org and id = p_branch;
  if v_before is null then
    raise exception 'unknown branch' using errcode = 'invalid_parameter_value';
  end if;
  update public.branches
     set latitude = round(p_lat, 4), longitude = round(p_lon, 4), updated_at = now()
   where org_id = p_org and id = p_branch;
  perform private.write_audit(p_org, p_branch, 'branch.location', 'branch', p_branch::text, v_before,
    jsonb_build_object('latitude', round(p_lat, 4), 'longitude', round(p_lon, 4)), null);
end $$;
revoke all on function public.set_branch_location(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.set_branch_location(uuid, uuid, numeric, numeric) to authenticated;
comment on function public.set_branch_location is 'Owner sets (or clears) a branch''s map location for its weather; audited. ADR 0051.';

-- Weather readings per branch: rain over the period that starts at `at` (one hour near, six hours further
-- out), the temperature at `at`, and MET Norway's symbol. Written only by the weather job (service role).
create table public.weather_hours (
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  at timestamptz not null,
  period_hours smallint not null constraint weather_hours_period check (period_hours in (1, 6)),
  temp_c numeric(4, 1),
  rain_mm numeric(6, 1) not null default 0 constraint weather_hours_rain check (rain_mm >= 0),
  symbol text constraint weather_hours_symbol check (length(symbol) <= 60),
  fetched_at timestamptz not null default now(),
  primary key (org_id, branch_id, at),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);
select private.apply_policies('weather_hours', 'branch', private.roles_all(), '{}'::public.app_role[], false,
  'weather for the branch; everyone at the branch reads, only the weather job writes (ADR 0051)');
comment on table public.weather_hours is
  'Weather forecast per branch per hour (MET Norway). | written by: forecasting | phase: 11';

-- One row per thing a job did once for an org and must not do again: an alert already sent, a calendar
-- estimate already added (so one the owner deleted is not added back). Service role only.
create table public.org_job_marks (
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null constraint org_job_marks_key check (length(key) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (org_id, key)
);
select private.register_table('org_job_marks', 'service_only',
  'once-only markers for jobs: alerts sent, calendar estimates added (ADR 0051)');
comment on table public.org_job_marks is
  'What a job already did once for an org (alert sent, calendar day added). Service role only. | written by: forecasting | phase: 11';

-- Every three hours (at :20), MET Norway updates its forecast about hourly; three hours keeps the "rain soon"
-- alert timely and the calls few.
insert into public.job_schedules (job, cron_expr, expected_every)
values ('weather', '20 */3 * * *', interval '3 hours')
on conflict do nothing;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('xedine-weather', '20 */3 * * *', $cmd$select private.dispatch_job('weather')$cmd$);
    exception when others then
      raise notice 'could not create the pg_cron schedule: %', sqlerrm;
    end;
  end if;
end $$;
