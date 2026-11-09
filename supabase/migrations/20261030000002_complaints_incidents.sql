-- ADR 0043 (2/3): complaints and incidents. One record from "the customer said" to "this is what we
-- changed so it does not happen again".
--
-- PII care (CLAUDE.md #8): a customer's name and phone live on the incident, are read by the owner and the
-- branch manager only, never reach the audit log and never reach the assistant. All writes go through
-- the functions below, so the audit row carries only what is safe to keep there.

-- Tenant-to-tenant keys are composite (CLAUDE.md); feedback gets the key it needs for that.
alter table public.feedback add constraint feedback_org_id_id_key unique (org_id, id);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  kind text not null default 'complaint'
    constraint incidents_kind check (kind in ('complaint', 'food_safety', 'hygiene', 'injury', 'equipment', 'other')),
  severity text not null default 'medium' constraint incidents_severity check (severity in ('low', 'medium', 'high')),
  status text not null default 'open' constraint incidents_status check (status in ('open', 'in_progress', 'resolved')),
  source text not null default 'in_person' constraint incidents_source check (source in
    ('in_person', 'phone', 'facebook', 'foodpanda', 'google', 'review', 'feedback', 'daily_check', 'other')),
  title text not null constraint incidents_title check (length(btrim(title)) between 1 and 160),
  details text constraint incidents_details check (details is null or length(details) <= 4000),
  occurred_on date not null,
  -- The bill as people say it ("bill 42"), free text: it may be from a day the system cannot match.
  order_ref text constraint incidents_order_ref check (order_ref is null or length(order_ref) <= 60),
  ingredient_id uuid,
  review_id uuid,
  feedback_id uuid,
  check_log_id uuid,
  customer_name text constraint incidents_customer_name check (customer_name is null or length(customer_name) <= 120),
  customer_phone text constraint incidents_customer_phone check (customer_phone is null or length(customer_phone) <= 30),
  -- The customer said we may call them back.
  contact_ok boolean not null default false,
  root_cause text constraint incidents_root_cause check (root_cause is null or length(root_cause) <= 2000),
  customer_resolution text constraint incidents_customer_resolution check (customer_resolution is null or length(customer_resolution) <= 2000),
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete set null (ingredient_id),
  foreign key (org_id, review_id) references public.reviews (org_id, id) on delete set null (review_id),
  foreign key (org_id, feedback_id) references public.feedback (org_id, id) on delete set null (feedback_id)
);
create trigger incidents_touch before update on public.incidents
  for each row execute function private.touch_updated_at();
create index incidents_branch_idx on public.incidents (org_id, branch_id, status, opened_at desc);
create index incidents_ingredient_idx on public.incidents (org_id, ingredient_id) where ingredient_id is not null;
-- A review, a comment or a failed check becomes at most one case.
create unique index incidents_one_per_review on public.incidents (org_id, review_id) where review_id is not null;
create unique index incidents_one_per_feedback on public.incidents (org_id, feedback_id) where feedback_id is not null;
create unique index incidents_one_per_check on public.incidents (org_id, check_log_id) where check_log_id is not null;

create table public.incident_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  incident_id uuid not null,
  kind text not null default 'corrective' constraint incident_actions_kind check (kind in ('corrective', 'note')),
  body text not null constraint incident_actions_body check (length(btrim(body)) between 1 and 1000),
  due_on date,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, incident_id) references public.incidents (org_id, id) on delete cascade
);
create index incident_actions_incident_idx on public.incident_actions (org_id, incident_id, created_at);
create index incident_actions_branch_idx on public.incident_actions (org_id, branch_id);

do $$
declare
  v_leads public.app_role[] := array['owner', 'manager']::public.app_role[];
begin
  perform private.apply_policies('incidents', 'branch', v_leads, '{}'::public.app_role[], false,
    'holds a customer''s name and phone: owner and branch manager only; written by the incident RPCs');
  perform private.apply_policies('incident_actions', 'branch', v_leads, '{}'::public.app_role[], false,
    'written by add_incident_action and complete_incident_action');
end $$;
comment on table public.incidents is
  'A customer complaint or something that went wrong, with its cause and how it was put right. | written by: reviews | phase: 11';
comment on table public.incident_actions is
  'Corrective actions and notes on an incident: what will be done, by when, and when it was done. | written by: reviews | phase: 11';

create function private.require_incident_role(p_org uuid, p_branch uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_access_branch_role(p_org, p_branch, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
end $$;

-- An incident the caller may change; a resolved one is closed until it is reopened.
create function private.editable_incident(p_org uuid, p_incident uuid) returns public.incidents
language plpgsql security definer set search_path = '' as $$
declare
  x public.incidents;
begin
  select * into x from public.incidents where org_id = p_org and id = p_incident for update;
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_incident_role(p_org, x.branch_id);
  if x.status = 'resolved' then
    raise exception 'incident_is_resolved' using errcode = 'invalid_parameter_value';
  end if;
  return x;
end $$;

-- No role check here: the callers each make their own.
create function private.create_incident(
  p_org uuid, p_branch uuid, p_kind text, p_severity text, p_source text, p_title text, p_details text,
  p_occurred_on date, p_order_ref text, p_ingredient uuid, p_review uuid, p_feedback uuid, p_check_log uuid,
  p_customer_name text, p_customer_phone text, p_contact_ok boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.incidents (org_id, branch_id, kind, severity, source, title, details, occurred_on, order_ref,
    ingredient_id, review_id, feedback_id, check_log_id, customer_name, customer_phone, contact_ok, opened_by)
  values (p_org, p_branch, p_kind, p_severity, p_source, left(btrim(p_title), 160), left(nullif(btrim(p_details), ''), 4000),
    p_occurred_on, left(nullif(btrim(p_order_ref), ''), 60), p_ingredient, p_review, p_feedback, p_check_log,
    left(nullif(btrim(p_customer_name), ''), 120), left(nullif(btrim(p_customer_phone), ''), 30),
    coalesce(p_contact_ok, false), (select auth.uid()))
  returning id into v_id;
  -- Never the customer's name or phone: the audit log is not PII-gated.
  perform private.write_audit(p_org, p_branch, 'incident.open', 'incident', v_id::text, null,
    jsonb_build_object('kind', p_kind, 'severity', p_severity, 'source', p_source), null, null, null);
  return v_id;
end $$;

create function public.open_incident(
  p_org uuid, p_branch uuid, p_kind text, p_severity text, p_source text, p_title text, p_details text default null,
  p_occurred_on date default null, p_order_ref text default null, p_ingredient uuid default null,
  p_hold boolean default false, p_customer_name text default null, p_customer_phone text default null,
  p_contact_ok boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.business_date(now(), private.branch_cutoff(p_org, p_branch));
  v_on date := coalesce(p_occurred_on, v_today);
  v_id uuid;
begin
  perform private.require_incident_role(p_org, p_branch);
  if length(coalesce(btrim(p_title), '')) = 0 then
    raise exception 'incident_needs_title' using errcode = 'invalid_parameter_value';
  end if;
  if v_on > v_today or v_on < v_today - 365 then
    raise exception 'pick a date in the last year' using errcode = 'invalid_parameter_value';
  end if;
  if p_ingredient is not null and not exists (select 1 from public.ingredients where org_id = p_org and id = p_ingredient) then
    raise exception 'unknown ingredient' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_hold, false) and p_ingredient is null then
    raise exception 'pick the ingredient to stop' using errcode = 'invalid_parameter_value';
  end if;
  v_id := private.create_incident(p_org, p_branch, p_kind, p_severity, p_source, p_title, p_details, v_on, p_order_ref,
    p_ingredient, null, null, null, p_customer_name, p_customer_phone, p_contact_ok);
  if coalesce(p_hold, false) then
    perform public.hold_ingredient(p_org, p_branch, p_ingredient, left(btrim(p_title), 300));
  end if;
  return v_id;
end $$;

-- A bad review becomes a case once; asking again returns the same case.
create function public.incident_from_review(p_org uuid, p_review uuid, p_branch uuid default null)
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
    coalesce((r.reviewed_at at time zone 'Asia/Dhaka')::date,
             private.business_date(now(), private.branch_cutoff(p_org, v_branch))),
    null, null, p_review, null, null, null, null, false);
end $$;

create function public.incident_from_feedback(p_org uuid, p_feedback uuid)
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
    coalesce((f.submitted_at at time zone 'Asia/Dhaka')::date,
             private.business_date(now(), private.branch_cutoff(p_org, f.branch_id))),
    null, null, null, p_feedback, null, null, null, false);
end $$;

create function public.update_incident(
  p_org uuid, p_incident uuid, p_status text, p_severity text, p_root_cause text default null,
  p_customer_resolution text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  x public.incidents := private.editable_incident(p_org, p_incident);
begin
  if p_status not in ('open', 'in_progress') then
    raise exception 'unknown status' using errcode = 'invalid_parameter_value';
  end if;
  update public.incidents
     set status = p_status, severity = p_severity,
         root_cause = left(nullif(btrim(p_root_cause), ''), 2000),
         customer_resolution = left(nullif(btrim(p_customer_resolution), ''), 2000)
   where id = x.id;
  perform private.write_audit(p_org, x.branch_id, 'incident.update', 'incident', x.id::text,
    jsonb_build_object('status', x.status, 'severity', x.severity),
    jsonb_build_object('status', p_status, 'severity', p_severity), null, null, null);
end $$;

create function public.add_incident_action(
  p_org uuid, p_incident uuid, p_kind text, p_body text, p_due_on date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  x public.incidents := private.editable_incident(p_org, p_incident);
  v_id uuid;
begin
  if length(coalesce(btrim(p_body), '')) = 0 or length(p_body) > 1000 then
    raise exception 'incident_needs_action_text' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.incident_actions (org_id, branch_id, incident_id, kind, body, due_on, created_by, done_at, done_by)
  values (p_org, x.branch_id, x.id, p_kind, btrim(p_body), p_due_on, (select auth.uid()),
    case when p_kind = 'note' then now() end, case when p_kind = 'note' then (select auth.uid()) end)
  returning id into v_id;
  if x.status = 'open' then
    update public.incidents set status = 'in_progress' where id = x.id;
  end if;
  perform private.write_audit(p_org, x.branch_id, 'incident.action', 'incident', x.id::text, null,
    jsonb_build_object('action_id', v_id, 'kind', p_kind, 'due_on', p_due_on), null, null, null);
  return v_id;
end $$;

create function public.complete_incident_action(p_org uuid, p_action uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.incident_actions;
  x public.incidents;
begin
  select * into a from public.incident_actions where org_id = p_org and id = p_action;
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  x := private.editable_incident(p_org, a.incident_id);
  if a.done_at is not null then
    return;
  end if;
  update public.incident_actions set done_at = now(), done_by = (select auth.uid()) where id = a.id;
  perform private.write_audit(p_org, x.branch_id, 'incident.action_done', 'incident', x.id::text, null,
    jsonb_build_object('action_id', a.id), null, null, null);
end $$;

-- A case closes only with its story complete: why it happened, what the customer got, and at least one
-- corrective action, all of them done.
create function public.resolve_incident(p_org uuid, p_incident uuid, p_root_cause text, p_customer_resolution text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x public.incidents := private.editable_incident(p_org, p_incident);
begin
  if length(coalesce(btrim(p_root_cause), '')) < 3 then
    raise exception 'incident_needs_root_cause' using errcode = 'invalid_parameter_value';
  end if;
  if length(coalesce(btrim(p_customer_resolution), '')) < 3 then
    raise exception 'incident_needs_resolution' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.incident_actions a
                  where a.org_id = p_org and a.incident_id = x.id and a.kind = 'corrective') then
    raise exception 'incident_needs_action' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.incident_actions a
              where a.org_id = p_org and a.incident_id = x.id and a.kind = 'corrective' and a.done_at is null) then
    raise exception 'incident_action_open' using errcode = 'invalid_parameter_value';
  end if;
  update public.incidents
     set status = 'resolved', root_cause = left(btrim(p_root_cause), 2000),
         customer_resolution = left(btrim(p_customer_resolution), 2000),
         resolved_at = now(), resolved_by = (select auth.uid())
   where id = x.id;
  perform private.write_audit(p_org, x.branch_id, 'incident.resolve', 'incident', x.id::text,
    jsonb_build_object('status', x.status), jsonb_build_object('status', 'resolved'), null, null, null);
end $$;

create function public.reopen_incident(p_org uuid, p_incident uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x public.incidents;
begin
  select * into x from public.incidents where org_id = p_org and id = p_incident for update;
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_incident_role(p_org, x.branch_id);
  if x.status <> 'resolved' then
    return;
  end if;
  if length(coalesce(btrim(p_reason), '')) < 3 then
    raise exception 'incident_needs_reason' using errcode = 'invalid_parameter_value';
  end if;
  update public.incidents set status = 'in_progress', resolved_at = null, resolved_by = null where id = x.id;
  perform private.write_audit(p_org, x.branch_id, 'incident.reopen', 'incident', x.id::text,
    jsonb_build_object('status', 'resolved'), jsonb_build_object('status', 'in_progress'), left(btrim(p_reason), 300),
    null, null);
end $$;

-- The owner's and manager's branches in a scope. The service role keeps the whole scope.
create function private.incident_scope(p_org uuid, p_branch uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid[] := private.metric_scope(p_org, p_branch);
begin
  if private.is_service_role() then return v; end if;
  select coalesce(array_agg(b), '{}') into v from unnest(v) as b
   where private.can_access_branch_role(p_org, b, array['owner', 'manager']::public.app_role[]);
  if cardinality(v) = 0 then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return v;
end $$;

-- incident.list: every unresolved case and those resolved in the last 30 days, worst first.
create function public.metric_incidents(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (id uuid, branch_id uuid, kind text, severity text, status text, source text, title text, details text,
               occurred_on date, order_ref text, ingredient_id uuid, ingredient_name text, ingredient_name_bn text,
               customer_name text, customer_phone text, contact_ok boolean, root_cause text, customer_resolution text,
               opened_at timestamptz, resolved_at timestamptz, age_days integer, corrective_actions bigint,
               open_actions bigint, overdue_actions bigint, as_of date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := private.incident_scope(p_org, p_branch);
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
begin
  return query
    select x.id, x.branch_id, x.kind, x.severity, x.status, x.source, x.title, x.details, x.occurred_on, x.order_ref,
           x.ingredient_id, i.name, i.name_bn, x.customer_name, x.customer_phone, x.contact_ok, x.root_cause,
           x.customer_resolution, x.opened_at, x.resolved_at,
           (coalesce(private.business_date(x.resolved_at, private.org_cutoff(p_org)), v_today)
             - private.business_date(x.opened_at, private.org_cutoff(p_org)))::integer,
           coalesce(a.total, 0), coalesce(a.open, 0), coalesce(a.overdue, 0), v_today
      from public.incidents x
      left join public.ingredients i on i.org_id = x.org_id and i.id = x.ingredient_id
      left join lateral (
        select count(*) as total, count(*) filter (where y.done_at is null) as open,
               count(*) filter (where y.done_at is null and y.due_on < v_today) as overdue
          from public.incident_actions y
         where y.org_id = x.org_id and y.incident_id = x.id and y.kind = 'corrective'
      ) a on true
     where x.org_id = p_org and x.branch_id = any (v_scope)
       and (x.status <> 'resolved' or x.resolved_at >= p_now - interval '30 days')
     order by case x.status when 'resolved' then 1 else 0 end,
              case x.severity when 'high' then 0 when 'medium' then 1 else 2 end,
              x.opened_at desc
     limit 100;
end $$;

-- incident.summary: counts for the head of the page, the brief and the assistant. No PII.
create function public.metric_incident_summary(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (open_count bigint, in_progress_count bigint, high_unresolved bigint, overdue_actions bigint,
               resolved_30d bigint, median_hours_to_resolve numeric, kinds_30d jsonb, sources_30d jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[] := private.incident_scope(p_org, p_branch);
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
begin
  return query
    with x as (
      select * from public.incidents i where i.org_id = p_org and i.branch_id = any (v_scope)
    ), recent as (
      select * from x where x.opened_at >= p_now - interval '30 days'
    )
    select (select count(*) from x where x.status = 'open'),
           (select count(*) from x where x.status = 'in_progress'),
           (select count(*) from x where x.status <> 'resolved' and x.severity = 'high'),
           (select count(*) from public.incident_actions a
             where a.org_id = p_org and a.branch_id = any (v_scope) and a.kind = 'corrective'
               and a.done_at is null and a.due_on < v_today),
           (select count(*) from x where x.resolved_at >= p_now - interval '30 days'),
           (select round((percentile_cont(0.5) within group (
                     order by extract(epoch from (x.resolved_at - x.opened_at)) / 3600))::numeric, 1)
              from x where x.resolved_at >= p_now - interval '30 days'),
           coalesce((select jsonb_object_agg(k.kind, k.n) from
                      (select r.kind, count(*) as n from recent r group by r.kind) k), '{}'::jsonb),
           coalesce((select jsonb_object_agg(k.source, k.n) from
                      (select r.source, count(*) as n from recent r group by r.source) k), '{}'::jsonb);
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('require_incident_role', 'editable_incident', 'create_incident', 'incident_scope')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('open_incident', 'incident_from_review', 'incident_from_feedback', 'update_incident',
                         'add_incident_action', 'complete_incident_action', 'resolve_incident', 'reopen_incident',
                         'metric_incidents', 'metric_incident_summary')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

comment on function public.open_incident is 'Owner or manager opens a complaint or incident, optionally stopping an ingredient. ADR 0043.';
comment on function public.incident_from_review is 'Turns a review into a case, once. ADR 0043.';
comment on function public.incident_from_feedback is 'Turns an after-meal comment into a case, once. ADR 0043.';
comment on function public.update_incident is 'Saves status, severity, cause and what the customer got on an unresolved case. ADR 0043.';
comment on function public.add_incident_action is 'Adds a corrective action or a note to an unresolved case. ADR 0043.';
comment on function public.complete_incident_action is 'Marks a corrective action done. ADR 0043.';
comment on function public.resolve_incident is 'Closes a case; needs a cause, a resolution and every corrective action done. ADR 0043.';
comment on function public.reopen_incident is 'Reopens a resolved case with a reason. ADR 0043.';
comment on function public.metric_incidents is 'incident.list: unresolved cases and those resolved in 30 days (owner and manager; includes customer contact). ADR 0043.';
comment on function public.metric_incident_summary is 'incident.summary: open, overdue, resolved, median hours to resolve, by kind and source; no PII. ADR 0043.';
