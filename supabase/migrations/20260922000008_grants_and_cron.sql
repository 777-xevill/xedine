-- Privileges and scheduling.

-- anon (signed-out visitors) touches no table; public-facing flows (feedback links, QR ordering) go
-- through server routes with narrowly-scoped logic, never direct table access.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- RPCs: signed-in users only. Function EXECUTE defaults to PUBLIC, so take it away explicitly.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname in ('job_run_begin', 'job_run_finish', 'job_health') then
      -- Job plumbing is for the service role only.
      execute format('revoke execute on function %s from authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
    else
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- ARCHITECTURE.md: "index every org_id / branch_id". RLS predicates and composite FKs filter on
-- them, so any tenant table without a usable leading index gets one here. tests/db/structure.test.ts
-- asserts the invariant so a future table cannot forget.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in ('job_runs', 'webhook_events')
      and not exists (
        select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum
      )
  loop
    execute format('create index %I on public.%I (org_id)', r.relname || '_org_idx', r.relname);
  end loop;

  for r in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute b on b.attrelid = c.oid and b.attname = 'branch_id' and not b.attisdropped
    join pg_attribute o on o.attrelid = c.oid and o.attname = 'org_id' and not o.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.oid
          and (i.indkey[0] = b.attnum or (i.indkey[0] = o.attnum and i.indkey[1] = b.attnum))
      )
  loop
    execute format('create index %I on public.%I (org_id, branch_id)', r.relname || '_branch_idx', r.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- pg_cron → authenticated job routes (ADR 0004). Skipped where the extensions are unavailable.
-- The database cannot see HTTP failures, so job_runs + job_health() is the only failure signal.
-- ---------------------------------------------------------------------------------------------
create table private.app_config (
  key text primary key,
  value text not null
);
comment on table private.app_config is
  'Per-environment settings for scheduled jobs: job_base_url (e.g. https://app.example.com) and job_secret. Set at deploy time; never committed.';

create function private.dispatch_job(p_job text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from private.app_config where key = 'job_base_url';
  select value into v_secret from private.app_config where key = 'job_secret';
  if v_url is null or v_secret is null then
    raise notice 'dispatch_job(%): job_base_url / job_secret are not configured; skipping', p_job;
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/jobs/' || p_job,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;
revoke all on function private.dispatch_job(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      create extension if not exists pg_net;
      create extension if not exists pg_cron;
      -- Cron runs in UTC; per-org Asia/Dhaka timing is resolved inside the job from org_settings.
      perform cron.schedule('xedine-refresh-today', '*/10 * * * *', $cmd$select private.dispatch_job('refresh_today')$cmd$);
      perform cron.schedule('xedine-close-business-day', '30 22 * * *', $cmd$select private.dispatch_job('close_business_day')$cmd$);
    exception when others then
      -- Never let scheduling break the schema. job_health() reports missing runs regardless.
      raise notice 'could not create pg_cron schedules: %', sqlerrm;
    end;
  else
    raise notice 'pg_cron/pg_net not available; job schedules were not created (fine for local tests)';
  end if;
end $$;
